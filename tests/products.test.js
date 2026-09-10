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

describe('Product CRUD', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;
  let createdProductId;

  const productData = {
    name: 'Test Gold Ring',
    sku: 'GOLD-RNG-001',
    category: 'Rings',
    metal: 'Gold',
    price: 25000,
    stock: 10,
    status: 'active',
  };

  beforeAll(async () => {
    const admin = await createAdminUser(`admin_${Date.now()}@test.com`, 'admin123');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = loginRes.body.token;
  });

  it('should create a product', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', productData.name)
      .field('sku', productData.sku)
      .field('category', productData.category)
      .field('metal', productData.metal)
      .field('price', String(productData.price))
      .field('stock', String(productData.stock))
      .field('status', productData.status)
      .field('imageUrls', 'https://example.com/image.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(productData.name);
    createdProductId = res.body.data._id;
  });

  it('should get all products', async () => {
    const res = await request(app)
      .get('/api/products');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should get single product by id', async () => {
    const res = await request(app)
      .get(`/api/products/${createdProductId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data._id).toBe(createdProductId);
  });

  it('should update product', async () => {
    const res = await request(app)
      .put(`/api/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('price', '26000');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.price).toBe(26000);
  });

  it('should delete product', async () => {
    const res = await request(app)
      .delete(`/api/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Product SKU Lookup', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    const admin = await createAdminUser(`sku_test_${Date.now()}@test.com`, 'admin123');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = res.body.token;
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  it('should check SKU availability - available', async () => {
    const res = await request(app)
      .get('/api/products/check-sku')
      .query({ sku: 'NEW-SKU-001' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.available).toBe(true);
  });

  it('should check SKU availability - taken', async () => {
    await Product.create({
      name: 'Check SKU Product',
      category: 'Rings',
      sku: 'TAKEN-SKU-001',
      price: 10000,
      status: 'active',
    });

    const res = await request(app)
      .get('/api/products/check-sku')
      .query({ sku: 'TAKEN-SKU-001' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.available).toBe(false);
  });

  it('should check SKU availability - missing param', async () => {
    const res = await request(app)
      .get('/api/products/check-sku');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should get product by SKU', async () => {
    const product = await Product.create({
      name: 'SKU Lookup Product',
      category: 'Earrings',
      sku: 'EAR-SKU-001',
      price: 5000,
      discountPrice: 4000,
      stock: 20,
      status: 'active',
      images: [{ url: 'https://example.com/earring.jpg', alt: '', order: 0 }],
    });

    const res = await request(app)
      .get('/api/products/sku/EAR-SKU-001');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe(product._id.toString());
    expect(res.body.data.sku).toBe('EAR-SKU-001');
    expect(res.body.data.discountPrice).toBe(4000);
    expect(res.body.data.sellingPrice).toBe(4000);
  });

  it('should return 404 for non-existent SKU', async () => {
    const res = await request(app)
      .get('/api/products/sku/NONEXISTENT-999');

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 for empty SKU param', async () => {
    const res = await request(app)
      .get('/api/products/sku/');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
