'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Filesystem store. Each collection is a JSON file holding an array of docs.
 * Good for local development. NOTE: Vercel's serverless filesystem is ephemeral,
 * so use MongoDB (set MONGODB_URI) for any deployed, persistent install.
 */
class FsStore {
  constructor(dir) {
    this.dir = dir || path.join(process.cwd(), 'data');
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this._locks = Promise.resolve();
  }

  async connect() { return this; }

  _file(collection) {
    return path.join(this.dir, `${collection}.json`);
  }

  async _read(collection) {
    try {
      const raw = await fsp.readFile(this._file(collection), 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  async _write(collection, docs) {
    const tmp = this._file(collection) + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(docs, null, 2));
    await fsp.rename(tmp, this._file(collection));
  }

  // Serialize writes to avoid races on the same process.
  _withLock(fn) {
    const run = this._locks.then(fn, fn);
    this._locks = run.then(() => {}, () => {});
    return run;
  }

  _match(doc, query) {
    return Object.keys(query).every((k) => doc[k] === query[k]);
  }

  async find(collection, query = {}) {
    const docs = await this._read(collection);
    return docs.filter((d) => this._match(d, query));
  }

  async findOne(collection, query = {}) {
    const docs = await this._read(collection);
    return docs.find((d) => this._match(d, query)) || null;
  }

  async insert(collection, doc) {
    return this._withLock(async () => {
      const docs = await this._read(collection);
      docs.push(doc);
      await this._write(collection, docs);
      return doc;
    });
  }

  async update(collection, query, doc) {
    return this._withLock(async () => {
      const docs = await this._read(collection);
      const idx = docs.findIndex((d) => this._match(d, query));
      if (idx === -1) {
        docs.push(doc);
      } else {
        docs[idx] = doc;
      }
      await this._write(collection, docs);
      return doc;
    });
  }

  async remove(collection, query) {
    return this._withLock(async () => {
      const docs = await this._read(collection);
      const kept = docs.filter((d) => !this._match(d, query));
      const removed = docs.length - kept.length;
      await this._write(collection, kept);
      return removed;
    });
  }
}

module.exports = FsStore;
