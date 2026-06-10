'use strict';
const crypto = require('crypto');
const config = require('./config');
const repo = require('./repo');
const { renderClean } = require('./renderer');

/**
 * PUBLISH
 * Render every page of a site into a static bundle (clean HTML, no editor
 * attributes), deploy it to the site's host (Vercel REST API), and keep the
 * exact bytes as an immutable snapshot. If no Vercel token is available the
 * bundle is still built and snapshotted so nothing is lost.
 */

function buildBundle(pages) {
  // pages: [{ path, template, slots, content }]
  const files = [];
  for (const page of pages) {
    let p = page.path || '/';
    if (p === '/' || p === '') p = '/index.html';
    if (!/\.html?$/i.test(p)) p = p.replace(/\/$/, '') + '/index.html';
    p = p.replace(/^\//, ''); // relative path inside the bundle
    const html = renderClean(page.template, page.slots, page.content);
    files.push({ path: p, html });
  }
  if (!files.some((f) => f.path === 'index.html')) {
    // Guarantee an index so the deployment has a root document.
    if (files[0]) files.push({ path: 'index.html', html: files[0].html });
  }
  return files;
}

/**
 * Deploy a set of {path, html} files to Vercel using the v13 deployments API
 * with inline file contents.
 */
async function deployToVercel(files, { token, projectName, teamId }) {
  if (!token) throw new Error('No Vercel token configured for this site.');
  const vfiles = files.map((f) => ({ file: f.path, data: f.html }));
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const body = {
    name: projectName || 'ai-cms-site',
    files: vfiles,
    projectSettings: { framework: null },
    target: 'production',
  };
  const res = await fetch(`https://api.vercel.com/v13/deployments${qs}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Vercel deploy failed (${res.status}): ${data.error ? data.error.message : JSON.stringify(data)}`);
  }
  const url = data.url ? `https://${data.url}` : null;
  return { provider: 'vercel', id: data.id || null, url, raw: { alias: data.alias || [] } };
}

/**
 * Publish a site. Returns { snapshot, deployment }.
 */
async function publishSite(siteId, { label } = {}) {
  const site = await repo.getSite(siteId);
  if (!site) throw new Error('Site not found');
  const pages = await repo.listPages(siteId);
  if (!pages.length) throw new Error('Nothing to publish — this site has no pages.');

  const files = buildBundle(pages);

  let deployment = null;
  const host = site.host || {};
  const token = host.token || config.vercelToken;
  if (token) {
    deployment = await deployToVercel(files, {
      token,
      projectName: host.projectName || `cms-${site.slug}`,
      teamId: host.teamId || config.vercelTeamId,
    });
  }

  // Immutable snapshot of exactly what was shipped.
  const snapshot = await repo.createSnapshot(siteId, {
    label: label || `Publish ${new Date().toISOString()}`,
    pages: files.map((f) => ({ path: f.path, html: f.html, hash: sha(f.html) })),
    deployment,
  });

  return { snapshot, deployment, fileCount: files.length };
}

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

module.exports = { publishSite, buildBundle, deployToVercel };
