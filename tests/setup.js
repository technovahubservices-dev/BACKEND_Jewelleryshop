const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const fs = require('fs');

let mongoServer;
let tmpDbDir;

const connect = async () => {
  if (process.env.MONGO_DB_DIR) {
    tmpDbDir = process.env.MONGO_DB_DIR;
    fs.mkdirSync(tmpDbDir, { recursive: true });
  }
  mongoServer = await MongoMemoryServer.create(
    tmpDbDir
      ? { instance: { dbPath: tmpDbDir, storageEngine: 'wiredTiger' } }
      : { instance: { storageEngine: 'wiredTiger' } }
  );
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
};

const close = async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  if (tmpDbDir && fs.existsSync(tmpDbDir)) {
    try {
      fs.rmSync(tmpDbDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Could not remove tmp db dir:', e.message);
    }
  }
};

module.exports = { connect, close };
