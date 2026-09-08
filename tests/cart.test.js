const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
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

describe('Cart Operations', () => {
  beforeAll(connect);
  afterAll(close);

  let userToken;
  let adminToken;
  let productId;

  const user = {
    name: 'Cart User',
    email: `cart_${Date.now()}@test.com`,
    password: 'password123',
  };

  const product = {
    name: 'Cart Test Product',
    sku: 'CART-001',
    category: 'Rings',
    metal: 'Gold',
    price: 10000,
    stock: 10,
    status: 'active',
  };

  const testAddress = {
    fullName: 'Test User',
    phone: '1234567890',
    address: '123 Test St',
    landmark: 'Near park',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
  };

  beforeAll(async () => {
    const userRes = await request(app)
      .post('/api/auth/register')
      .send(user);
    userToken = userRes.body.token;

    const admin = await createAdminUser(`admin_cart_${Date.now()}@test.com`, 'admin123');
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = adminRes.body.token;

    const productRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', product.name)
      .field('sku', product.sku)
      .field('category', product.category)
      .field('metal', product.metal)
      .field('price', String(product.price))
      .field('stock', String(product.stock))
      .field('status', product.status)
      .field('imageUrls', 'https://example.com/image.jpg');
    productId = productRes.body.data._id;
  });

  afterEach(async () => {
    await Cart.deleteMany({});
    await Order.deleteMany({});
    await Product.findByIdAndUpdate(productId, { stock: product.stock });
  });

  describe('GET /api/cart', () => {
    it('should return empty cart for new user', async () => {
      const res = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.totalItems).toBe(0);
      expect(res.body.data.totalPrice).toBe(0);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/api/cart');

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/cart (add to cart)', () => {
    it('should add a product to cart', async () => {
      const res = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 2 });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].product._id).toBe(productId);
      expect(res.body.data.items[0].quantity).toBe(2);
      expect(res.body.data.totalItems).toBe(2);
      expect(res.body.data.totalPrice).toBe(20000);
    });

    it('should increment quantity when adding same product again', async () => {
      await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 1 });

      const res = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 2 });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(3);
      expect(res.body.data.totalItems).toBe(3);
    });

    it('should reject invalid product ID', async () => {
      const res = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: 'invalid-id', quantity: 1 });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject product that does not exist', async () => {
      const res = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: new mongoose.Types.ObjectId().toString(), quantity: 1 });

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Product not found/);
    });

    it('should reject insufficient stock', async () => {
      const res = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 100 });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Insufficient stock/);
    });
  });

  describe('PUT /api/cart/:itemId (update quantity)', () => {
    it('should update cart item quantity', async () => {
      const addRes = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 1 });

      const itemId = addRes.body.data.items[0]._id;

      const res = await request(app)
        .put(`/api/cart/${itemId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ quantity: 5 });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items[0].quantity).toBe(5);
      expect(res.body.data.totalItems).toBe(5);
    });

    it('should reject invalid item ID', async () => {
      const res = await request(app)
        .put('/api/cart/invalid-id')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ quantity: 1 });

      expect(res.statusCode).toBe(400);
    });

    it('should reject quantity less than 1', async () => {
      const addRes = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 1 });

      const itemId = addRes.body.data.items[0]._id;

      const res = await request(app)
        .put(`/api/cart/${itemId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ quantity: 0 });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/cart/:itemId (remove from cart)', () => {
    it('should remove item from cart', async () => {
      const addRes = await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 3 });

      const itemId = addRes.body.data.items[0]._id;

      const res = await request(app)
        .delete(`/api/cart/${itemId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
      expect(res.body.data.totalItems).toBe(0);
    });

    it('should return 404 for non-existent item', async () => {
      const res = await request(app)
        .delete(`/api/cart/${new mongoose.Types.ObjectId().toString()}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/cart (clear cart)', () => {
    it('should clear all items from cart', async () => {
      await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 2 });

      const res = await request(app)
        .delete('/api/cart')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
      expect(res.body.data.totalItems).toBe(0);
    });
  });

  describe('POST /api/cart/buy-now', () => {
    it('should create order with COD payment method', async () => {
      const res = await request(app)
        .post('/api/cart/buy-now')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId,
          quantity: 1,
          paymentMethod: 'cod',
          shippingAddress: testAddress,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('new');
      expect(res.body.data.isPaid).toBe(false);
      expect(res.body.data.paymentMethod).toBe('cod');

      const order = await Order.findById(res.body.data._id);
      expect(order.items[0].price).toBe(10000);
      expect(order.itemsPrice).toBe(10000);
    });

    it('should create order with prepayment and pending_payment status', async () => {
      const res = await request(app)
        .post('/api/cart/buy-now')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId,
          quantity: 2,
          paymentMethod: 'upi',
          shippingAddress: testAddress,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.status).toBe('pending_payment');
      expect(res.body.data.paymentStatus).toBe('pending');
      expect(res.body.data.itemsPrice).toBe(20000);
    });

    it('should not deduct stock for prepaid orders', async () => {
      await request(app)
        .post('/api/cart/buy-now')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId,
          quantity: 1,
          paymentMethod: 'upi',
          shippingAddress: testAddress,
        });

      const productRes = await request(app).get(`/api/products/${productId}`);
      expect(productRes.body.data.stock).toBe(10);
    });

    it('should deduct stock for COD orders', async () => {
      await request(app)
        .post('/api/cart/buy-now')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId,
          quantity: 3,
          paymentMethod: 'cod',
          shippingAddress: testAddress,
        });

      const productRes = await request(app).get(`/api/products/${productId}`);
      expect(productRes.body.data.stock).toBe(7);
    });

    it('should reject buy now with insufficient stock', async () => {
      const res = await request(app)
        .post('/api/cart/buy-now')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId,
          quantity: 100,
          paymentMethod: 'cod',
          shippingAddress: testAddress,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Insufficient stock/);
    });

    it('should reject buy now without shipping address', async () => {
      const res = await request(app)
        .post('/api/cart/buy-now')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId,
          quantity: 1,
          paymentMethod: 'cod',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/address/i);
    });

    it('should use saved address when addressId is provided', async () => {
      const userRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Address User',
          email: `addr_${Date.now()}@test.com`,
          password: 'password123',
        });

      const addrRes = await request(app)
        .post('/api/users/addresses')
        .set('Authorization', `Bearer ${userRes.body.token}`)
        .send(testAddress);

      const addressId = addrRes.body.data[0]._id;

      const buyNowRes = await request(app)
        .post('/api/cart/buy-now')
        .set('Authorization', `Bearer ${userRes.body.token}`)
        .send({
          productId,
          quantity: 1,
          paymentMethod: 'cod',
          addressId,
        });

      expect(buyNowRes.statusCode).toBe(201);
      expect(buyNowRes.body.data.shippingAddress.fullName).toBe(testAddress.fullName);
      expect(buyNowRes.body.data.shippingAddress.city).toBe(testAddress.city);
    });
  });

  describe('POST /api/cart/checkout', () => {
    it('should create order from cart items', async () => {
      await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 2 });

      const res = await request(app)
        .post('/api/cart/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          paymentMethod: 'cod',
          shippingAddress: testAddress,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('new');
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.itemsPrice).toBe(20000);

      const cartRes = await request(app)
        .get('/api/cart')
        .set('Authorization', `Bearer ${userToken}`);
      expect(cartRes.body.data.items).toHaveLength(0);
    });

    it('should create order with prepayment from cart', async () => {
      await request(app)
        .post('/api/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 1 });

      const res = await request(app)
        .post('/api/cart/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          paymentMethod: 'card',
          shippingAddress: testAddress,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.status).toBe('pending_payment');
      expect(res.body.data.itemsPrice).toBe(10000);
    });

    it('should reject checkout with empty cart', async () => {
      const res = await request(app)
        .post('/api/cart/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          paymentMethod: 'cod',
          shippingAddress: testAddress,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/empty/i);
    });
  });
});
