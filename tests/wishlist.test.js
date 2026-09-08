const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const Wishlist = require('../models/Wishlist');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
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

describe('Sprint 2 - Wishlist', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;
  let userToken;
  let userToken2;
  let productId1;
  let productId2;

  beforeAll(async () => {
    const admin = await createAdminUser(`admin_wish_${Date.now()}@test.com`, 'admin123');
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = adminRes.body.token;

    const userRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Wishlist User',
        email: `wish_${Date.now()}@test.com`,
        password: 'password123',
      });
    userToken = userRes.body.token;

    const userRes2 = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Wishlist User 2',
        email: `wish2_${Date.now()}@test.com`,
        password: 'password123',
      });
    userToken2 = userRes2.body.token;
  });

  beforeEach(async () => {
    await Product.deleteMany({});
    await Wishlist.deleteMany({});
    await Cart.deleteMany({});
    await Order.deleteMany({});

    const p1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Gold Ring')
      .field('sku', 'WISH-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '10000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/ring.jpg');
    productId1 = p1.body.data._id;

    const p2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Silver Necklace')
      .field('sku', 'WISH-002')
      .field('category', 'Necklaces')
      .field('metal', 'Silver')
      .field('price', '5000')
      .field('stock', '5')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/necklace.jpg');
    productId2 = p2.body.data._id;
  });

  afterEach(async () => {
    await Wishlist.deleteMany({});
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await Wishlist.deleteMany({});
    await Cart.deleteMany({});
    await Order.deleteMany({});
  });

  describe('GET /api/wishlist', () => {
    it('should return empty wishlist for new user', async () => {
      const res = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(0);
      expect(res.body.data).toEqual([]);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/api/wishlist');

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/wishlist', () => {
    it('should add product to wishlist', async () => {
      const res = await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/added to wishlist/);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].product._id).toBe(productId1);
    });

    it('should reject duplicate wishlist entries', async () => {
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });

      const res = await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/already in wishlist/);
    });

    it('should reject invalid product ID', async () => {
      const res = await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: 'invalid-id' });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/product ID/i);
    });

    it('should reject non-existent product', async () => {
      const res = await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: new mongoose.Types.ObjectId().toString() });

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  describe('DELETE /api/wishlist/:productId', () => {
    beforeEach(async () => {
      await Wishlist.deleteMany({});
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });
    });

    it('should remove product from wishlist', async () => {
      const res = await request(app)
        .delete(`/api/wishlist/${productId1}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/removed/i);
      expect(res.body.data).toHaveLength(0);
    });

    it('should return 404 for product not in wishlist', async () => {
      const res = await request(app)
        .delete(`/api/wishlist/${productId2}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/not found in wishlist/i);
    });

    it('should reject invalid product ID', async () => {
      const res = await request(app)
        .delete('/api/wishlist/invalid-id')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/wishlist/check/:productId', () => {
    beforeEach(async () => {
      await Wishlist.deleteMany({});
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });
    });

    it('should return true for product in wishlist', async () => {
      const res = await request(app)
        .get(`/api/wishlist/check/${productId1}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.inWishlist).toBe(true);
    });

    it('should return false for product not in wishlist', async () => {
      const res = await request(app)
        .get(`/api/wishlist/check/${productId2}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.inWishlist).toBe(false);
    });

    it('should reject invalid product ID', async () => {
      const res = await request(app)
        .get('/api/wishlist/check/invalid-id')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/wishlist (clear)', () => {
    it('should clear entire wishlist', async () => {
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });

      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId2 });

      const res = await request(app)
        .delete('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/cleared/i);
      expect(res.body.data).toEqual([]);
    });

    it('should handle clearing empty wishlist', async () => {
      const res = await request(app)
        .delete('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/already empty/i);
    });
  });

  describe('Security', () => {
    it('should prevent cross-user wishlist access', async () => {
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });

      const res = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${userToken2}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should not allow user to remove from another user wishlist', async () => {
      await request(app)
        .post('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: productId1 });

      const res = await request(app)
        .delete(`/api/wishlist/${productId1}`)
        .set('Authorization', `Bearer ${userToken2}`);

      expect(res.statusCode).toBe(404);
    });

    it('should require authentication for all operations', async () => {
      const res = await request(app).post('/api/wishlist').send({ productId: productId1 });
      expect(res.statusCode).toBe(401);

      const res2 = await request(app).delete(`/api/wishlist/${productId1}`);
      expect(res2.statusCode).toBe(401);

      const res3 = await request(app).get(`/api/wishlist/check/${productId1}`);
      expect(res3.statusCode).toBe(401);

      const res4 = await request(app).delete('/api/wishlist');
      expect(res4.statusCode).toBe(401);
    });
  });
});
