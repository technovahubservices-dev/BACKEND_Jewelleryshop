const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connect = async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: {
      launchTimeout: 60000,
    },
  });
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
};

const close = async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
};

module.exports = { connect, close };
