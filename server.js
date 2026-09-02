const path = require('path');
const express = require('express');
const dotenv = require('dotenv').config();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const sanitize = require('./middleware/sanitize');
const connectDB = require('./config/db');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.CLIENT_URL || /https:\/\/.*\.vercel\.app$/)
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000','https://frontend-jewelleryshop-fqjt.vercel.app'],
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(sanitize);

const isDevelopment = process.env.NODE_ENV !== 'production';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 1000 : 10,
  message: { success: false, message: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isDevelopment ? () => true : undefined,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 10000 : 200,
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const authHeader = req.headers.authorization || ''
    return authHeader.startsWith('Bearer ')
  },
});

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/', (req, res) => {
  res.send('API is running...');
});

app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api', apiLimiter);

app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/quotations', require('./routes/quotationRoutes'));
app.use('/api/content', require('./routes/contentRoutes'));
app.use('/api/store', require('./routes/storeRoutes'));
app.use('/api/admin/settings', require('./routes/adminSettingsRoutes'));
app.use('/api/contact', require('./routes/contactRoutes'));

app.use((err, req, res, next) => {
  console.error(err.stack || err.message);
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
    });
  }
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: messages.join(', '),
    });
  }
  res.status(err.statusCode || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error'),
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  if (process.env.NODE_ENV !== 'test') {
    await connectDB();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  }
};

startServer();

module.exports = { app };
