'use strict';
const path = require('path');
const express = require('express');
const auth = require('./auth');
const apiRouter = require('./routes');
const repo = require('./repo');

const app = express();
app.use(express.json({ limit: '6mb' }));
app.use(auth.authContext);

// API
app.use('/api', apiRouter);

// Serve immutable published snapshots (public — published content is public).
// /s/:snapshotId/            -> index.html of the snapshot
// /s/:snapshotId/<path>      -> a specific file from the snapshot
app.get(/^\/s\/([^/]+)(\/.*)?$/, async (req, res) => {
  try {
    const snapshotId = req.params[0];
    let rel = (req.params[1] || '/').replace(/^\//, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const snap = await repo.getSnapshot(snapshotId);
    if (!snap) return res.status(404).send('Snapshot not found');
    const file = snap.pages.find((f) => f.path === rel)
      || (rel === 'index.html' ? snap.pages.find((f) => f.path === 'index.html') : null);
    if (!file) return res.status(404).send('File not found in snapshot');
    res.set('content-type', 'text/html; charset=utf-8').send(file.html);
  } catch (e) {
    res.status(500).send('Error loading snapshot');
  }
});

// Static UI (dashboard + editor)
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA-ish fallback to the dashboard for unknown non-API routes.
app.get(/^(?!\/api|\/s\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
