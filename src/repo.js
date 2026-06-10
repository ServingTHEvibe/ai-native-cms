'use strict';
const crypto = require('crypto');
const { getStore } = require('./storage');

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function slugify(name) {
  return String(name || 'site')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'site';
}

/* ----------------------------- Sites ----------------------------- */

async function listSites() {
  const store = await getStore();
  const sites = await store.find('sites', {});
  return sites.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function getSite(siteId) {
  const store = await getStore();
  return store.findOne('sites', { id: siteId });
}

async function getSiteBySlug(slug) {
  const store = await getStore();
  return store.findOne('sites', { slug });
}

async function createSite({ name, clientPasswordHash = null, host = null }) {
  const store = await getStore();
  let slug = slugify(name);
  // Ensure unique slug.
  let n = 1;
  while (await store.findOne('sites', { slug })) slug = `${slugify(name)}-${++n}`;
  const site = {
    id: uid(), name: name || 'Untitled site', slug,
    clientPasswordHash, host,
    createdAt: now(), updatedAt: now(),
  };
  await store.insert('sites', site);
  return site;
}

async function updateSite(siteId, patch) {
  const store = await getStore();
  const site = await store.findOne('sites', { id: siteId });
  if (!site) return null;
  const updated = { ...site, ...patch, id: site.id, updatedAt: now() };
  await store.update('sites', { id: siteId }, updated);
  return updated;
}

async function deleteSite(siteId) {
  const store = await getStore();
  await store.remove('pages', { siteId });
  await store.remove('versions', { siteId });
  await store.remove('snapshots', { siteId });
  return store.remove('sites', { id: siteId });
}

/* ----------------------------- Pages ----------------------------- */

async function createPage(siteId, { name, path, template, slots, content }) {
  const store = await getStore();
  const page = {
    id: uid(), siteId,
    name: name || 'Home',
    path: path || '/',
    template, slots, content,
    updatedAt: now(),
  };
  await store.insert('pages', page);
  await addVersion(siteId, page.id, content, 'Ingested');
  return page;
}

async function listPages(siteId) {
  const store = await getStore();
  const pages = await store.find('pages', { siteId });
  return pages.sort((a, b) => (a.path > b.path ? 1 : -1));
}

async function getPage(pageId) {
  const store = await getStore();
  return store.findOne('pages', { id: pageId });
}

async function getPageByPath(siteId, path) {
  const store = await getStore();
  return store.findOne('pages', { siteId, path });
}

/** Replace the page's current content (already Guardian-validated) and snapshot a version. */
async function savePageContent(pageId, content, label = 'Edit') {
  const store = await getStore();
  const page = await store.findOne('pages', { id: pageId });
  if (!page) return null;
  const updated = { ...page, content, updatedAt: now() };
  await store.update('pages', { id: pageId }, updated);
  await addVersion(page.siteId, pageId, content, label);
  return updated;
}

async function deletePage(pageId) {
  const store = await getStore();
  await store.remove('versions', { pageId });
  return store.remove('pages', { id: pageId });
}

/* --------------------------- Versions ---------------------------- */

async function addVersion(siteId, pageId, content, label) {
  const store = await getStore();
  const version = { id: uid(), siteId, pageId, label: label || 'Version', content, createdAt: now() };
  await store.insert('versions', version);
  return version;
}

async function listVersions(pageId) {
  const store = await getStore();
  const versions = await store.find('versions', { pageId });
  return versions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function getVersion(versionId) {
  const store = await getStore();
  return store.findOne('versions', { id: versionId });
}

/** One-click rollback: re-apply a past version's content as the new current. */
async function rollback(pageId, versionId) {
  const version = await getVersion(versionId);
  if (!version || version.pageId !== pageId) return null;
  return savePageContent(pageId, version.content, `Rollback to ${version.createdAt}`);
}

/* --------------------------- Snapshots --------------------------- */
/* Immutable record of each publish. */

async function createSnapshot(siteId, { label, pages, deployment }) {
  const store = await getStore();
  const snap = {
    id: uid(), siteId,
    label: label || 'Publish',
    pages,            // [{ path, html }] — frozen bytes that were shipped
    deployment,       // { provider, url, id } or null
    createdAt: now(),
  };
  await store.insert('snapshots', snap);
  return snap;
}

async function listSnapshots(siteId) {
  const store = await getStore();
  const snaps = await store.find('snapshots', { siteId });
  return snaps.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function getSnapshot(snapshotId) {
  const store = await getStore();
  return store.findOne('snapshots', { id: snapshotId });
}

module.exports = {
  slugify,
  listSites, getSite, getSiteBySlug, createSite, updateSite, deleteSite,
  createPage, listPages, getPage, getPageByPath, savePageContent, deletePage,
  addVersion, listVersions, getVersion, rollback,
  createSnapshot, listSnapshots, getSnapshot,
};
