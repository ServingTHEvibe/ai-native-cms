'use strict';
const { MongoClient } = require('mongodb');

/**
 * MongoDB store. Mirrors the FsStore interface. The Mongo client is cached on
 * the module/global scope so it survives across serverless invocations.
 */
let cached = global.__aiCmsMongo;
if (!cached) cached = global.__aiCmsMongo = { client: null, promise: null };

class MongoStore {
  constructor(uri, dbName) {
    this.uri = uri;
    this.dbName = dbName;
    this.db = null;
  }

  async connect() {
    if (!cached.promise) {
      cached.promise = MongoClient.connect(this.uri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 8000,
      }).then((client) => {
        cached.client = client;
        return client;
      });
    }
    const client = await cached.promise;
    this.db = client.db(this.dbName);
    return this;
  }

  _col(name) {
    if (!this.db) throw new Error('MongoStore not connected');
    return this.db.collection(name);
  }

  async find(collection, query = {}) {
    return this._col(collection).find(query, { projection: { _id: 0 } }).toArray();
  }

  async findOne(collection, query = {}) {
    return this._col(collection).findOne(query, { projection: { _id: 0 } });
  }

  async insert(collection, doc) {
    await this._col(collection).insertOne({ ...doc });
    return doc;
  }

  async update(collection, query, doc) {
    await this._col(collection).replaceOne(query, doc, { upsert: true });
    return doc;
  }

  async remove(collection, query) {
    const res = await this._col(collection).deleteMany(query);
    return res.deletedCount;
  }
}

module.exports = MongoStore;
