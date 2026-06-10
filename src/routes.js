'use strict';
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const repo = require('./repo');
const guardian = require('./guardian');
const ingest = require('./ingest');
const renderer = require('./renderer');
const ai = require('./ai');
const publish = require('./publish');

const router = express.Router();

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

/* ----------------------------- Auth ------------------------------ */

router.post('/auth/owner', wrap(async (req, res) => {
  const { key } = req.body || {};
  if (!key || key !== config.ownerMasterKey) {
    return res.status(401).json({ error: 'Invalid owner key' });
  }
  const token = auth.signToken({ role: 'owner' });
  res.cookie?.('cms_token', token);
  res.json({ token, role: 'owner' });
}));

router.post('/auth/client', wrap(async (req, res) => {
  const { slug, siteId, password } = req.body || {};
  const site = siteId ? await repo.getSite(siteId) : (slug ? await repo.getSiteBySlug(slug) : null);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (!site.clientPasswordHash || !auth.verifyPassword(password, site.clientPasswordHash)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = auth.signToken({ role: 'client', siteId: site.id });
  res.json({ token, role: 'client', siteId: site.id, siteName: site.name });
}));

router.get('/me', wrap(async (req, res) => {
  res.json({ auth: req.auth || null, aiEnabled: config.aiEnabled, usingMongo: config.usingMongo });
}));

/* ----------------------------- Sites ----------------------------- */

router.get('/sites', auth.requireOwner, wrap(async (_req, res) => {
  const sites = await repo.listSites();
  const withCounts = await Promise.all(sites.map(async (s) => ({
    id: s.id, name: s.name, slug: s.slug,
    hasClientPassword: Boolean(s.clientPasswordHash),
    host: s.host ? { provider: s.host.provider, projectName: s.host.projectName, hasToken: Boolean(s.host.token) } : null,
    pageCount: (await repo.listPages(s.id)).length,
    createdAt: s.createdAt,
  })));
  res.json({ sites: withCounts });
}));

router.post('/sites', auth.requireOwner, wrap(async (req, res) => {
  const { name, url, clientPassword, host } = req.body || {};
  const site = await repo.createSite({
    name: name || (url ? new URL(url).hostname : 'New site'),
    clientPasswordHash: clientPassword ? auth.hashPassword(clientPassword) : null,
    host: host || null,
  });
  let page = null;
  if (url) {
    const ing = await ingest.ingestUrl(url);
    page = await repo.createPage(site.id, {
      name: ing.meta.title, path: '/',
      template: ing.template, slots: ing.slots, content: ing.content,
    });
  }
  res.json({ site, page: page ? pageSummary(page) : null });
}));

router.get('/sites/:siteId', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const site = await repo.getSite(req.params.siteId);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  const pages = await repo.listPages(site.id);
  res.json({
    site: {
      id: site.id, name: site.name, slug: site.slug,
      hasClientPassword: Boolean(site.clientPasswordHash),
      host: site.host ? { provider: site.host.provider, projectName: site.host.projectName, teamId: site.host.teamId, hasToken: Boolean(site.host.token) } : null,
    },
    pages: pages.map(pageSummary),
  });
}));

router.patch('/sites/:siteId', auth.requireOwner, wrap(async (req, res) => {
  const { name, clientPassword, host } = req.body || {};
  const patch = {};
  if (name != null) patch.name = name;
  if (clientPassword != null) patch.clientPasswordHash = clientPassword ? auth.hashPassword(clientPassword) : null;
  if (host !== undefined) patch.host = host;
  const updated = await repo.updateSite(req.params.siteId, patch);
  if (!updated) return res.status(404).json({ error: 'Site not found' });
  res.json({ ok: true });
}));

router.delete('/sites/:siteId', auth.requireOwner, wrap(async (req, res) => {
  await repo.deleteSite(req.params.siteId);
  res.json({ ok: true });
}));

/* ----------------------------- Pages ----------------------------- */

router.post('/sites/:siteId/pages', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const { name, url, html, path } = req.body || {};
  if (!url && !html) return res.status(400).json({ error: 'Provide a url or html to ingest' });
  const ing = url ? await ingest.ingestUrl(url) : ingest.ingestHtml(html, '');
  const page = await repo.createPage(req.params.siteId, {
    name: name || ing.meta.title, path: path || '/',
    template: ing.template, slots: ing.slots, content: ing.content,
  });
  res.json({ page: pageSummary(page), meta: ing.meta });
}));

router.get('/sites/:siteId/pages/:pageId', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const page = await repo.getPage(req.params.pageId);
  if (!page || page.siteId !== req.params.siteId) return res.status(404).json({ error: 'Page not found' });
  res.json({ page: { id: page.id, name: page.name, path: page.path, slots: page.slots, content: page.content } });
}));

router.delete('/sites/:siteId/pages/:pageId', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  await repo.deletePage(req.params.pageId);
  res.json({ ok: true });
}));

/** Apply a manual change set — Guardian validates before anything is saved. */
router.post('/sites/:siteId/pages/:pageId/apply', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const page = await repo.getPage(req.params.pageId);
  if (!page || page.siteId !== req.params.siteId) return res.status(404).json({ error: 'Page not found' });
  const changes = (req.body && req.body.changes) || {};
  const verdict = guardian.validate(page.slots, page.content, changes);
  if (!verdict.ok) return res.status(422).json({ ok: false, errors: verdict.errors });
  const updated = await repo.savePageContent(page.id, verdict.content, req.body.label || 'Inline edit');
  res.json({ ok: true, content: updated.content });
}));

/* --------------------------- AI chat ----------------------------- */

router.post('/sites/:siteId/pages/:pageId/chat', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const page = await repo.getPage(req.params.pageId);
  if (!page || page.siteId !== req.params.siteId) return res.status(404).json({ error: 'Page not found' });
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  let proposal;
  try {
    proposal = await ai.proposeChanges(message, page.slots, page.content);
  } catch (err) {
    if (err.code === 'AI_DISABLED') return res.status(400).json({ error: err.message, aiDisabled: true });
    throw err;
  }

  // Every AI proposal is funnelled through the SAME Guardian as manual edits.
  const verdict = guardian.validate(page.slots, page.content, proposal.changes);
  if (!verdict.ok) {
    return res.json({ ok: false, applied: false, note: proposal.note, changes: proposal.changes, errors: verdict.errors });
  }
  const updated = await repo.savePageContent(page.id, verdict.content, `AI: ${message.slice(0, 40)}`);
  res.json({ ok: true, applied: true, note: proposal.note, provider: proposal.provider, changes: proposal.changes, content: updated.content });
}));

/* --------------------------- Versions ---------------------------- */

router.get('/sites/:siteId/pages/:pageId/versions', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const versions = await repo.listVersions(req.params.pageId);
  res.json({ versions: versions.map((v) => ({ id: v.id, label: v.label, createdAt: v.createdAt })) });
}));

router.post('/sites/:siteId/pages/:pageId/rollback', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const { versionId } = req.body || {};
  const updated = await repo.rollback(req.params.pageId, versionId);
  if (!updated) return res.status(404).json({ error: 'Version not found for this page' });
  res.json({ ok: true, content: updated.content });
}));

/* --------------------------- Preview ----------------------------- */
/* Rendered editable HTML for the iframe. Token may come via cookie or ?token=. */

router.get('/preview/:pageId', wrap(async (req, res) => {
  const token = req.query.token || (req.auth ? null : null);
  const payload = token ? auth.verifyToken(token) : req.auth;
  const page = await repo.getPage(req.params.pageId);
  if (!page) return res.status(404).send('Not found');
  if (!payload || (payload.role !== 'owner' && payload.siteId !== page.siteId)) {
    return res.status(403).send('Forbidden');
  }
  const editable = req.query.editable !== '0';
  const html = renderer.render(page.template, page.slots, page.content, { editable });
  res.set('content-type', 'text/html; charset=utf-8').send(html);
}));

/* --------------------------- Publish ----------------------------- */

router.post('/sites/:siteId/publish', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const result = await publish.publishSite(req.params.siteId, { label: req.body && req.body.label });
  res.json({
    ok: true,
    snapshotId: result.snapshot.id,
    fileCount: result.fileCount,
    deployment: result.deployment,
    viewUrl: `/s/${result.snapshot.id}/`,
  });
}));

router.get('/sites/:siteId/snapshots', auth.requireSiteAccess((r) => r.params.siteId), wrap(async (req, res) => {
  const snaps = await repo.listSnapshots(req.params.siteId);
  res.json({
    snapshots: snaps.map((s) => ({
      id: s.id, label: s.label, createdAt: s.createdAt,
      fileCount: s.pages.length, deployment: s.deployment,
      viewUrl: `/s/${s.id}/`,
    })),
  });
}));

/* ---------------------------- helpers ---------------------------- */

function pageSummary(page) {
  return {
    id: page.id, name: page.name, path: page.path,
    slotCount: Object.keys(page.slots || {}).length,
    updatedAt: page.updatedAt,
  };
}

module.exports = router;
