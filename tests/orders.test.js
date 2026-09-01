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

describe('Order Creation & Stock Validation', () => {
  beforeAll(connect);
  afterAll(close);

  let userToken;
  let adminToken;
  let productId;

  const user = {
    name: 'Order User',
    email: `order_${Date.now()}@test.com`,
    password: 'password123',
  };

  const product = {
    name: 'Stock Test Product',
    sku: 'STOCK-001',
    category: 'Rings',
    metal: 'Gold',
    price: 10000,
    stock: 5,
    status: 'active',
  };

  beforeAll(async () => {
    const userRes = await request(app)
      .post('/api/auth/register')
      .send(user);
    userToken = userRes.body.token;

    const admin = await createAdminUser(`admin_order_${Date.now()}@test.com`, 'admin123');
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

  it('should create order and reduce stock', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [
          {
            product: productId,
            name: 'Stock Test Product',
            price: 10000,
            quantity: 2,
          },
        ],
        shippingAddress: {
          fullName: 'Test User',
          address: '123 Test St',
          city: 'Chennai',
          state: 'Tamil Nadu',
        },
        paymentMethod: 'cod',
        itemsPrice: 20000,
        taxPrice: 600,
        shippingPrice: 0,
        totalPrice: 20600,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('new');
  });

  it('should reduce product stock after order', async () => {
    const productRes = await request(app)
      .get(`/api/products/${productId}`);

    expect(productRes.statusCode).toBe(200);
    expect(productRes.body.data.stock).toBe(3);
  });

  it('should reject order with invalid product id', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [
          {
            product: new mongoose.Types.ObjectId(),
            name: 'Fake Product',
            price: 1000,
            quantity: 1,
          },
        ],
        shippingAddress: {
          fullName: 'Test User',
          address: '123 Test St',
          city: 'Chennai',
          state: 'Tamil Nadu',
        },
        paymentMethod: 'cod',
        itemsPrice: 1000,
        taxPrice: 30,
        shippingPrice: 0,
        totalPrice: 1030,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Product not found/);
  });
});
