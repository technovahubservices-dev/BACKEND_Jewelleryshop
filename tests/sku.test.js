const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const bcrypt = require('bcryptjs');

const createAdminUser = async (email, password) => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const user = await User.create({
    name: 'Admin',
    email,
    password: hashedPassword,
    isAdmin: true,
  });
  return user;
};

const baseProductData = {
  name: 'Test Gold Ring',
  sku: 'TEST-SKU-001',
  category: 'Rings',
  metal: 'Gold',
  price: 5000,
  stock: 10,
  status: 'active',
  imageUrls: 'https://example.com/image.jpg',
};

describe('SKU Validation & Safe Product Creation', () => {
  let adminToken;

  beforeAll(connect);
  afterAll(close);

  beforeAll(async () => {
    const admin = await createAdminUser(`sku_admin_${Date.now()}@test.com`, 'admin123');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = loginRes.body.token;
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  describe('GET /api/products/check-sku', () => {
    it('should return available=true when SKU does not exist', async () => {
      const res = await request(app)
        .get('/api/products/check-sku')
        .query({ sku: 'NONEXISTENT-SKU-999' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.available).toBe(true);
      expect(res.body.sku).toBe('NONEXISTENT-SKU-999');
    });

    it('should return available=false when SKU already exists', async () => {
      await Product.create({
        ...baseProductData,
        sku: 'DUPLICATE-SKU-001',
        images: ['https://example.com/img.jpg'],
      });

      const res = await request(app)
        .get('/api/products/check-sku')
        .query({ sku: 'DUPLICATE-SKU-001' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.available).toBe(false);
    });

    it('should be accessible without authentication (public endpoint)', async () => {
      const res = await request(app)
        .get('/api/products/check-sku')
        .query({ sku: 'PUBLIC-CHECK-SKU' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('available');
    });

    it('should return 400 when SKU query parameter is missing', async () => {
      const res = await request(app)
        .get('/api/products/check-sku');

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('SKU query parameter is required');
    });

    it('should return 400 when SKU query parameter is empty', async () => {
      const res = await request(app)
        .get('/api/products/check-sku')
        .query({ sku: '   ' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should trim whitespace from the SKU before checking', async () => {
      const res = await request(app)
        .get('/api/products/check-sku')
        .query({ sku: '  TRIMMED-SKU-001  ' });

      expect(res.statusCode).toBe(200);
      expect(res.body.sku).toBe('TRIMMED-SKU-001');
    });
  });

  describe('POST /api/products — SKU checked before drive upload', () => {
    it('should reject duplicate SKU with 400 BEFORE uploading images', async () => {
      await Product.create({
        ...baseProductData,
        images: ['https://example.com/img.jpg'],
      });

      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Duplicate SKU Product')
        .field('sku', 'TEST-SKU-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '5000')
        .field('stock', '10')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/image.jpg');

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('A product with this SKU already exists');
    });

    it('should create a product when SKU is unique', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Unique SKU Product')
        .field('sku', 'UNIQUE-SKU-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '5000')
        .field('stock', '10')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/image.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sku).toBe('UNIQUE-SKU-001');
    });

    it('should reject missing name before SKU check', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('category', 'Rings')
        .field('price', '5000');

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Product name is required');
    });

    it('should reject missing category before SKU check', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'No Category Product')
        .field('price', '5000');

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Category is required');
    });

    it('should auto-generate SKU when not provided (no duplicate)', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Auto SKU Product')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '5000')
        .field('stock', '10')
        .field('imageUrls', 'https://example.com/image.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sku).toMatch(/^GOLD-RNG-\d{3}$/);
    });
  });
});
