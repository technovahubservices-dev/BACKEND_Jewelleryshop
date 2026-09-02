const mongoose = require('mongoose');

let mongoServer;

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('MONGO_URI is not defined in environment variables');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.warn('MongoDB connection failed:', error.message);

    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      try {
        if (!mongoServer) {
          mongoServer = await MongoMemoryServer.create({
            instance: {
              timeoutSeconds: 120,
              port: 27018,
            },
            binary: {
              spawnWithDbPath: true,
            },
          });
        }
        const uri = mongoServer.getUri();
        const conn = await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 60000,
          socketTimeoutMS: 45000,
        });
        console.log(`MongoDB Connected (in-memory): ${conn.connection.host}`);
        return conn;
      } catch (memError) {
        console.error('In-memory MongoDB connection error:', memError.message);
        process.exit(1);
      }
    } else {
      console.error('MongoDB connection error:', error.message);
      process.exit(1);
    }
  }
};

const closeMemoryServer = async () => {
  if (mongoServer) {
    await mongoose.disconnect();
    await mongoServer.stop();
    mongoServer = null;
    console.log('In-memory MongoDB server stopped');
  }
};

module.exports = connectDB;
module.exports.closeMemoryServer = closeMemoryServer;
