const request = require('supertest');
const { app } = require('../server');
const { connect, close } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mock Google Drive upload to avoid needing real credentials
jest.mock('../utils/googleDriveStorage', () => {
  const actual = jest.requireActual('../utils/googleDriveStorage');
  return {
    ...actual,
    uploadRequestFilesToGoogleDrive: jest.fn(async (req, options = {}) => {
      if (!req.files || req.files.length === 0) return [];
      return req.files.map((file, idx) => ({
        id: `mock-drive-id-${Date.now()}-${idx}`,
        name: file.originalname,
        mimeType: file.mimetype,
        url: 'https://drive.google.com/thumbnail?id=mock-drive-id&sz=w2000',
        viewUrl: 'https://drive.google.com/uc?export=view&id=mock-drive-id',
      }));
    }),
    uploadRequestFileToGoogleDrive: jest.fn(async (req, options = {}) => {
      if (!req.file) return null;
      return {
        id: `mock-drive-id-${Date.now()}`,
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        url: 'https://drive.google.com/thumbnail?id=mock-drive-id&sz=w2000',
        viewUrl: 'https://drive.google.com/uc?export=view&id=mock-drive-id',
      };
    }),
  };
});

describe('End-to-End Product Creation with Image Upload', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);
    const admin = await User.create({
      name: 'Admin',
      email: `e2e_admin_${Date.now()}@test.com`,
      password: hashedPassword,
      isAdmin: true,
    });

    adminToken = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  });

  const smallPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  describe('Case 1: Product WITHOUT image upload (imageUrls only)', () => {
    it('should create product with image URL and save to MongoDB', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Gold Ring Without File')
        .field('sku', 'E2ECASE1-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '5000')
        .field('stock', '10')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/ring.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Gold Ring Without File');
      expect(res.body.data.sku).toBe('E2ECASE1-001');
      expect(res.body.data.images).toContain('https://example.com/ring.jpg');
      expect(res.body.data.primaryImage).toBe('https://example.com/ring.jpg');
      expect(res.body.data.slug).toBe('gold-ring-without-file');

      const dbProduct = await Product.findOne({ sku: 'E2ECASE1-001' });
      expect(dbProduct).toBeTruthy();
      expect(dbProduct.images).toContain('https://example.com/ring.jpg');
    });
  });

  describe('Case 2: Product WITH uploaded image file', () => {
    it('should upload image to Google Drive and save product to MongoDB', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Gold Ring With File')
        .field('sku', 'E2ECASE2-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '7500')
        .field('stock', '5')
        .field('status', 'active')
        .attach('images', smallPng, 'ring-image.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Gold Ring With File');
      expect(res.body.data.sku).toBe('E2ECASE2-001');
      expect(res.body.data.images.length).toBeGreaterThan(0);
      expect(res.body.data.primaryImage).toBeTruthy();
      expect(res.body.data.slug).toBe('gold-ring-with-file');

      const dbProduct = await Product.findOne({ sku: 'E2ECASE2-001' });
      expect(dbProduct).toBeTruthy();
      expect(dbProduct.images.length).toBeGreaterThan(0);
      expect(dbProduct.primaryImage).toBe(dbProduct.images[0]);
    });
  });

  describe('Case 3: Multer error handling (regression)', () => {
    it('should return 400 (not 500) for unexpected file field', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Bad Field Ring')
        .field('category', 'Rings')
        .field('imageUrls', 'https://example.com/test.jpg')
        .attach('image', smallPng, 'test.png');  // Wrong field name

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('Internal server error');
    });

    it('should return 413 (not 500) for file too large', async () => {
      const largeBuffer = Buffer.alloc(26 * 1024 * 1024, 0);

      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Large File Ring')
        .field('category', 'Rings')
        .attach('images', largeBuffer, 'large.png');

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('Internal server error');
    });
  });
});
