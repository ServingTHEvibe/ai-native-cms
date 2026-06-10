'use strict';
/* ============ AI-native CMS — front-end SPA ============ */

const S = {
  token: localStorage.getItem('cms_token') || '',
  role: localStorage.getItem('cms_role') || '',
  siteId: localStorage.getItem('cms_siteId') || '',
  aiEnabled: false,
  page: null,   // { id, slots, content, name }
};

const $ = (s, r = document) => r.querySelector(s);
const el = (id) => document.getElementById(id);
const view = () => el('view');

function tpl(id) { return el(id).content.cloneNode(true); }
function setView(node) { const v = view(); v.innerHTML = ''; v.appendChild(node); }

function saveSession(d) {
  S.token = d.token; S.role = d.role; S.siteId = d.siteId || '';
  localStorage.setItem('cms_token', S.token);
  localStorage.setItem('cms_role', S.role);
  localStorage.setItem('cms_siteId', S.siteId);
}
function clearSession() {
  S.token = ''; S.role = ''; S.siteId = '';
  ['cms_token', 'cms_role', 'cms_siteId'].forEach((k) => localStorage.removeItem(k));
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
  if (S.token) headers.authorization = 'Bearer ' + S.token;
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status, data });
  return data;
}

function toast(msg, kind = '') {
  const t = el('toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

function setChrome() {
  el('logoutBtn').hidden = !S.token;
  el('roleBadge').textContent = S.token ? (S.role === 'owner' ? 'Owner' : 'Client') : '';
}
function setCrumbs(parts) {
  const c = el('crumbs'); c.innerHTML = '';
  parts.forEach((p, i) => {
    if (i) c.appendChild(document.createTextNode('  /  '));
    if (p.go) { const a = document.createElement('a'); a.textContent = p.label; a.onclick = p.go; c.appendChild(a); }
    else c.appendChild(document.createTextNode(p.label));
  });
}

/* ----------------------------- Router ----------------------------- */

async function boot() {
  setChrome();
  el('logoutBtn').onclick = () => { clearSession(); routeLogin(); };
  el('brandHome').onclick = () => (S.token ? routeHome() : routeLogin());
  try { const me = await api('/me'); S.aiEnabled = me.aiEnabled; } catch (_) {}
  if (!S.token) return routeLogin();
  routeHome();
}

function routeHome() {
  if (S.role === 'client' && S.siteId) return routeSite(S.siteId);
  routeDashboard();
}

/* ----------------------------- Login ------------------------------ */

function routeLogin() {
  setChrome(); setCrumbs([]);
  const node = tpl('tpl-login');
  setView(node);
  const root = view();
  root.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
    root.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    root.querySelectorAll('.pane').forEach((p) => p.hidden = p.dataset.pane !== t.dataset.tab);
  });
  root.querySelector('[data-pane="owner"]').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const d = await api('/auth/owner', { method: 'POST', body: { key: e.target.key.value } });
      saveSession(d); setChrome(); routeHome();
    } catch (err) { toast(err.message, 'bad'); }
  };
  root.querySelector('[data-pane="client"]').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const d = await api('/auth/client', { method: 'POST', body: { slug: e.target.slug.value.trim(), password: e.target.password.value } });
      saveSession(d); setChrome(); routeHome();
    } catch (err) { toast(err.message, 'bad'); }
  };
}

/* --------------------------- Dashboard ---------------------------- */

async function routeDashboard() {
  setChrome(); setCrumbs([{ label: 'Sites' }]);
  setView(tpl('tpl-dashboard'));
  el('newSiteBtn').onclick = routeNewSite;
  try {
    const { sites } = await api('/sites');
    const list = el('sitesList');
    if (!sites.length) { list.innerHTML = '<p class="muted">No sites yet. Create your first one.</p>'; return; }
    list.innerHTML = '';
    sites.forEach((s) => {
      const c = document.createElement('div'); c.className = 'sitecard';
      c.innerHTML = `<h3>${esc(s.name)}</h3>
        <div class="meta">${s.pageCount} page${s.pageCount === 1 ? '' : 's'} · ${s.slug}</div>
        <div style="margin-top:10px">
          ${s.hasClientPassword ? '<span class="tag">client login</span>' : ''}
          ${s.host && s.host.hasToken ? '<span class="tag">vercel host</span>' : ''}
        </div>`;
      c.onclick = () => routeSite(s.id);
      list.appendChild(c);
    });
  } catch (err) { toast(err.message, 'bad'); if (err.status === 401) { clearSession(); routeLogin(); } }
}

function routeNewSite() {
  setCrumbs([{ label: 'Sites', go: routeDashboard }, { label: 'New' }]);
  setView(tpl('tpl-newsite'));
  el('cancelNew').onclick = routeDashboard;
  el('newSiteForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { name: f.name.value.trim(), url: f.url.value.trim(), clientPassword: f.clientPassword.value.trim() || undefined };
    const btn = f.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Ingesting…';
    try {
      const d = await api('/sites', { method: 'POST', body });
      toast('Site created', 'ok'); routeSite(d.site.id);
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; btn.textContent = 'Create & ingest'; }
  };
}

/* ----------------------------- Site ------------------------------- */

async function routeSite(siteId) {
  setChrome();
  setCrumbs(S.role === 'owner'
    ? [{ label: 'Sites', go: routeDashboard }, { label: '…' }]
    : [{ label: 'My site' }]);
  setView(tpl('tpl-site'));
  try {
    const { site, pages } = await api('/sites/' + siteId);
    el('siteTitle').textContent = site.name;
    if (S.role === 'owner') setCrumbs([{ label: 'Sites', go: routeDashboard }, { label: site.name }]);

    el('addPageBtn').onclick = () => addPage(siteId);
    el('settingsBtn').onclick = () => siteSettings(site);
    el('settingsBtn').hidden = S.role !== 'owner';
    el('publishBtn').onclick = () => doPublish(siteId);

    const pl = el('pagesList');
    pl.innerHTML = pages.length ? '' : '<p class="muted">No pages. Add one by ingesting a URL.</p>';
    pages.forEach((p) => {
      const item = document.createElement('div'); item.className = 'item';
      item.innerHTML = `<div><h4>${esc(p.name)}</h4><div class="sub">${esc(p.path)} · ${p.slotCount} slots</div></div>`;
      const b = document.createElement('button'); b.className = 'primary small'; b.textContent = 'Edit';
      b.onclick = () => routeEditor(siteId, p.id, p.name);
      item.appendChild(b); pl.appendChild(item);
    });

    const { snapshots } = await api('/sites/' + siteId + '/snapshots');
    const sl = el('snapsList');
    if (!snapshots.length) { sl.textContent = 'No publishes yet.'; }
    else {
      sl.className = 'list'; sl.innerHTML = '';
      snapshots.forEach((s) => {
        const item = document.createElement('div'); item.className = 'item';
        const live = s.deployment && s.deployment.url ? s.deployment.url : s.viewUrl;
        item.innerHTML = `<div><h4>${esc(s.label)}</h4><div class="sub">${new Date(s.createdAt).toLocaleString()} · ${s.fileCount} files</div></div>`;
        const a = document.createElement('a'); a.href = live; a.target = '_blank'; a.textContent = s.deployment && s.deployment.url ? 'View live' : 'View';
        a.className = 'tag'; item.appendChild(a); sl.appendChild(item);
      });
    }
  } catch (err) { toast(err.message, 'bad'); if (err.status === 401) { clearSession(); routeLogin(); } }
}

async function addPage(siteId) {
  const url = prompt('URL of the page to ingest:');
  if (!url) return;
  const name = prompt('Name for this page:', 'Page') || 'Page';
  const path = prompt('Path on the published site (e.g. /about):', '/about') || '/';
  try { await api('/sites/' + siteId + '/pages', { method: 'POST', body: { url, name, path } }); toast('Page ingested', 'ok'); routeSite(siteId); }
  catch (err) { toast(err.message, 'bad'); }
}

async function siteSettings(site) {
  const pw = prompt('Set/replace client password (blank = remove):', '');
  if (pw === null) return;
  try { await api('/sites/' + site.id, { method: 'PATCH', body: { clientPassword: pw } }); toast('Saved', 'ok'); }
  catch (err) { toast(err.message, 'bad'); }
}

async function doPublish(siteId) {
  const btn = el('publishBtn'); btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    const d = await api('/sites/' + siteId + '/publish', { method: 'POST', body: {} });
    if (d.deployment && d.deployment.url) toast('Published live: ' + d.deployment.url, 'ok');
    else toast('Snapshot saved (' + d.fileCount + ' files). Add a Vercel token to deploy live.', 'ok');
    routeSite(siteId);
  } catch (err) { toast(err.message, 'bad'); btn.disabled = false; btn.textContent = 'Publish'; }
}

/* ----------------------------- Editor ----------------------------- */

async function routeEditor(siteId, pageId, pageName) {
  _siteIdForEditor = siteId;
  setChrome();
  setCrumbs(S.role === 'owner'
    ? [{ label: 'Sites', go: routeDashboard }, { label: 'Site', go: () => routeSite(siteId) }, { label: pageName }]
    : [{ label: 'My site', go: () => routeSite(siteId) }, { label: pageName }]);
  setView(tpl('tpl-editor'));
  el('editorPageName').textContent = pageName;
  el('backToSite').onclick = () => routeSite(siteId);
  el('refreshPreview').onclick = () => loadPreview(pageId);
  el('versionsBtn').onclick = () => toggleVersions(siteId, pageId);

  const aiState = el('aiState');
  aiState.textContent = S.aiEnabled ? 'AI on' : 'AI off';
  aiState.className = 'pill ' + (S.aiEnabled ? 'on' : '');

  el('chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(siteId, pageId); };

  await loadPage(siteId, pageId);
}

async function loadPage(siteId, pageId) {
  const { page } = await api('/sites/' + siteId + '/pages/' + pageId);
  S.page = page;
  renderSlotList(siteId, pageId);
  loadPreview(pageId);
}

function renderSlotList(siteId, pageId) {
  const wrap = el('slotList'); wrap.innerHTML = '';
  Object.entries(S.page.slots).forEach(([id, slot]) => {
    const d = document.createElement('div');
    d.className = 'slot' + (slot.structural ? ' structural' : '');
    d.innerHTML = `<span class="stype">${slot.type}</span><span class="label">${esc(slot.label || id)}</span>`;
    d.onclick = () => openInlineEditorById(siteId, pageId, id);
    wrap.appendChild(d);
  });
}

function loadPreview(pageId) {
  const f = el('preview');
  f.src = '/api/preview/' + pageId + '?editable=1&token=' + encodeURIComponent(S.token) + '&t=' + Date.now();
  f.onload = () => wirePreview(pageId);
}

function wirePreview(pageId) {
  let doc;
  try { doc = el('preview').contentDocument; } catch (_) { return; }
  if (!doc) return;
  // Prevent navigation inside the preview; intercept slot clicks for editing.
  doc.addEventListener('click', (ev) => {
    const slotEl = ev.target.closest('[data-slot-editable]');
    const link = ev.target.closest('a');
    if (link) ev.preventDefault();
    if (slotEl) {
      ev.preventDefault();
      doc.querySelectorAll('.cms-active').forEach((n) => n.classList.remove('cms-active'));
      slotEl.classList.add('cms-active');
      const id = slotEl.getAttribute('data-slot-id');
      const siteId = S.role === 'client' ? S.siteId : (S.page && currentSiteId());
      openInlineEditor(currentSiteId(), pageId, id, slotEl);
    }
  }, true);
}

let _siteIdForEditor = '';
function currentSiteId() { return _siteIdForEditor; }

function openInlineEditorById(siteId, pageId, slotId) {
  let anchorEl = null;
  try { anchorEl = el('preview').contentDocument.querySelector('[data-slot-id="' + slotId + '"]'); } catch (_) {}
  openInlineEditor(siteId, pageId, slotId, anchorEl);
}

function openInlineEditor(siteId, pageId, slotId, anchorEl) {
  const slot = S.page.slots[slotId];
  const val = S.page.content[slotId] || {};
  const pop = el('inlineEditor');
  let fields = '';
  if (slot.type === 'text') fields = `<label>Text</label><textarea data-f="text">${esc(val.text || '')}</textarea>`;
  else if (slot.type === 'button') fields = `<label>Button text</label><input data-f="text" value="${esc(val.text || '')}">`;
  else if (slot.type === 'link') {
    if (slot.fields.includes('text')) fields += `<label>Link text</label><input data-f="text" value="${esc(val.text || '')}">`;
    fields += `<label>URL</label><input data-f="href" value="${esc(val.href || '')}">`;
  } else if (slot.type === 'image') {
    fields = `<label>Image URL</label><input data-f="src" value="${esc(val.src || '')}"><label>Alt text</label><input data-f="alt" value="${esc(val.alt || '')}">`;
  }
  pop.innerHTML = `<div class="row between"><strong>${slot.type}${slot.structural ? ' · structural' : ''}</strong>
    <button class="ghost small" data-x>✕</button></div>${fields}
    <div class="err" hidden></div>
    <div class="row"><button class="ghost small" data-cancel>Cancel</button><button class="primary small" data-save>Save</button></div>`;
  pop.hidden = false;
  positionPop(pop, anchorEl);

  const close = () => { pop.hidden = true; try { el('preview').contentDocument.querySelectorAll('.cms-active').forEach((n) => n.classList.remove('cms-active')); } catch (_) {} };
  pop.querySelector('[data-x]').onclick = close;
  pop.querySelector('[data-cancel]').onclick = close;
  pop.querySelector('[data-save]').onclick = async () => {
    const value = {};
    pop.querySelectorAll('[data-f]').forEach((i) => value[i.getAttribute('data-f')] = i.value);
    try {
      const d = await api('/sites/' + siteId + '/pages/' + pageId + '/apply', { method: 'POST', body: { changes: { [slotId]: value } } });
      S.page.content = d.content; close(); loadPreview(pageId); toast('Saved', 'ok');
    } catch (err) {
      const e = pop.querySelector('.err'); e.hidden = false;
      e.textContent = err.data && err.data.errors ? err.data.errors.map((x) => x.message).join('; ') : err.message;
    }
  };
}

function positionPop(pop, anchorEl) {
  const stage = el('preview').getBoundingClientRect();
  let top = stage.top + 60, left = stage.left + 40;
  if (anchorEl) {
    try {
      const r = anchorEl.getBoundingClientRect();
      top = stage.top + r.top + 8; left = stage.left + r.left;
    } catch (_) {}
  }
  const maxLeft = window.innerWidth - 340, maxTop = window.innerHeight - 240;
  pop.style.top = Math.max(60, Math.min(top, maxTop)) + 'px';
  pop.style.left = Math.max(8, Math.min(left, maxLeft)) + 'px';
}

/* ------------------------------ Chat ------------------------------ */

function addMsg(kind, text) {
  const log = el('chatLog');
  const m = document.createElement('div'); m.className = 'msg ' + kind; m.textContent = text;
  log.appendChild(m); log.scrollTop = log.scrollHeight;
}

async function sendChat(siteId, pageId) {
  const input = el('chatInput'); const message = input.value.trim();
  if (!message) return;
  addMsg('user', message); input.value = '';
  if (!S.aiEnabled) { addMsg('ai bad', 'AI is off. Add an ANTHROPIC_API_KEY or OPENROUTER_API_KEY to enable chat edits.'); return; }
  addMsg('ai', '…thinking');
  const thinking = el('chatLog').lastChild;
  try {
    const d = await api('/sites/' + siteId + '/pages/' + pageId + '/chat', { method: 'POST', body: { message } });
    thinking.remove();
    if (d.ok && d.applied) {
      addMsg('ai ok', (d.note || 'Done.') + ' ✓ (Guardian approved)');
      S.page.content = d.content; loadPreview(pageId);
    } else if (d.errors) {
      addMsg('ai bad', 'Guardian rejected this change: ' + d.errors.map((x) => x.message).join('; '));
    } else {
      addMsg('ai', d.note || 'No change made.');
    }
  } catch (err) { thinking.remove(); addMsg('ai bad', err.message); }
}

/* ---------------------------- Versions ---------------------------- */

async function toggleVersions(siteId, pageId) {
  const panel = el('versionsPanel');
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false; panel.innerHTML = '<h3>Versions</h3><p class="muted">Loading…</p>';
  try {
    const { versions } = await api('/sites/' + siteId + '/pages/' + pageId + '/versions');
    panel.innerHTML = '<div class="row between"><h3>Versions</h3><button class="ghost small" data-close>✕</button></div>';
    panel.querySelector('[data-close]').onclick = () => panel.hidden = true;
    versions.forEach((v) => {
      const row = document.createElement('div'); row.className = 'v';
      row.innerHTML = `<div><div>${esc(v.label)}</div><div class="sub muted">${new Date(v.createdAt).toLocaleString()}</div></div>`;
      const b = document.createElement('button'); b.className = 'ghost small'; b.textContent = 'Rollback';
      b.onclick = async () => {
        try { const d = await api('/sites/' + siteId + '/pages/' + pageId + '/rollback', { method: 'POST', body: { versionId: v.id } });
          S.page.content = d.content; loadPreview(pageId); toast('Rolled back', 'ok'); }
        catch (err) { toast(err.message, 'bad'); }
      };
      row.appendChild(b); panel.appendChild(row);
    });
  } catch (err) { panel.innerHTML = '<p class="err">' + esc(err.message) + '</p>'; }
}

/* ---------------------------- utils ------------------------------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

boot();
