'use strict';
const path = require('path');
const config = require('../config');
const FsStore = require('./fs-store');
const MongoStore = require('./mongo-store');

let storePromise = null;

/**
 * Returns a connected store singleton. Uses MongoDB when MONGODB_URI is set,
 * otherwise the filesystem (./data). The rest of the app only depends on the
 * small {find, findOne, insert, update, remove} interface — design vs. content
 * stays identical no matter where it is persisted.
 */
function getStore() {
  if (!storePromise) {
    const store = config.usingMongo
      ? new MongoStore(config.mongoUri, config.mongoDb)
      : new FsStore(path.join(process.cwd(), 'data'));
    storePromise = store.connect();
  }
  return storePromise;
}

module.exports = { getStore };
