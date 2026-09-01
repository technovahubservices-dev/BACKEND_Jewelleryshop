const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  try {
    if (mongoUri && !mongoUri.includes('mongodb://localhost') && !mongoUri.includes('mongodb+srv://')) {
      const conn = await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      console.log(`MongoDB Connected: ${conn.connection.host}`);
      return conn;
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'test') throw error;
    console.warn('MongoDB connection failed, falling back to in-memory server:', error.message);
  }

  if (process.env.NODE_ENV === 'test' && mongoServer) {
    return;
  }

  try {
    if (!mongoServer) {
      mongoServer = await MongoMemoryServer.create();
    }
    const uri = mongoServer.getUri();
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Connected (in-memory): ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
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
