const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
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
