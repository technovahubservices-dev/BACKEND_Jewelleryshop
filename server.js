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

// Render terminates TLS and forwards the original client IP in this header.
app.set('trust proxy', 1);

// Security
app.use(helmet());

// CORS - allow all origins and HTTP methods
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization'
  ],
}));

// Preflight requests
app.options('*', cors());

app.use(morgan(
  process.env.NODE_ENV === 'production' ? 'combined' : 'dev'
));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use(sanitize);

const isDevelopment = process.env.NODE_ENV !== 'production';

// Auth rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 1000 : 10,
  message: {
    success: false,
    message: 'Too many login attempts, please try again after 15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isDevelopment ? () => true : undefined,
});

// API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 10000 : 200,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const authHeader = req.headers.authorization || '';
    return authHeader.startsWith('Bearer ');
  },
});

// Static uploads
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'))
);

// Health check
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Auth routes
app.use(
  '/api/auth',
  authLimiter,
  require('./routes/authRoutes')
);

// API rate limiting
app.use('/api', apiLimiter);

// API routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/quotations', require('./routes/quotationRoutes'));
app.use('/api/content', require('./routes/contentRoutes'));
app.use('/api/store', require('./routes/storeRoutes'));
app.use('/api/admin/settings', require('./routes/adminSettingsRoutes'));
app.use('/api/integrations', require('./routes/googleDriveRoutes'));
app.use('/api/contact', require('./routes/contactRoutes'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    statusCode: err.statusCode,
    errorName: err.name,
    errorCode: err.code,
    errorMessage: err.message,
    errorStack: err.stack,
  });

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
    });
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors)
      .map((e) => e.message);

    return res.status(400).json({
      success: false,
      message: messages.join(', '),
    });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : (err.message || 'Internal server error'),
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  if (process.env.NODE_ENV !== 'test') {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
};

startServer();

module.exports = { app };
