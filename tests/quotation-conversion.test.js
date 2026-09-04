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

describe('Quotation Conversion to Order', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;
  let userToken;
  let quotationId;
  let productId;

  const product = {
    name: 'Convert Test Product',
    sku: 'CONV-001',
    category: 'Rings',
    metal: 'Gold',
    price: 10000,
    stock: 5,
    status: 'active',
  };

  const quotationData = {
    customer: {
      name: 'Convert Customer',
      email: 'convert@test.com',
      phone: '+91 98765 43210',
      address: '123 Convert Address, Chennai',
    },
    validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    items: [
      {
        product: productId || '',
        productName: 'Gold Ring',
        sku: 'GOLD-RNG-001',
        qty: 2,
        price: 25000,
        discount: 0,
        gst: 18,
      },
    ],
    notes: 'Conversion test quotation',
    status: 'accepted',
  };

  beforeAll(async () => {
    const admin = await createAdminUser(`convert_admin_${Date.now()}@test.com`, 'admin123');
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = adminRes.body.token;

    const userRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Convert User',
        email: `convert_user_${Date.now()}@test.com`,
        password: 'password123',
      });
    userToken = userRes.body.token;

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

    quotationData.items[0].product = productId;

    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(quotationData);
    quotationId = quoteRes.body.data._id;
  });

  it('should convert accepted quotation to order', async () => {
    const res = await request(app)
      .post(`/api/orders/convert-from-quotation/${quotationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        paymentMethod: 'cod',
        shippingAddress: {
          fullName: 'Convert Customer',
          address: '123 Convert Address, Chennai',
          city: 'Chennai',
          state: 'Tamil Nadu',
        },
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quotationId._id).toBe(quotationId);
  });

  it('should reduce stock after conversion', async () => {
    const productRes = await request(app)
      .get(`/api/products/${productId}`);

    expect(productRes.statusCode).toBe(200);
    expect(productRes.body.data.stock).toBe(3);
  });

  it('should reject double conversion', async () => {
    const res = await request(app)
      .post(`/api/orders/convert-from-quotation/${quotationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        paymentMethod: 'cod',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already been converted/);
  });

      it('should reject conversion with insufficient stock', async () => {
    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...quotationData,
        status: 'accepted',
        items: [
          {
            ...quotationData.items[0],
            qty: 100,
          },
        ],
      });
    const newQuoteId = quoteRes.body.data._id;

    const res = await request(app)
      .post(`/api/orders/convert-from-quotation/${newQuoteId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        paymentMethod: 'cod',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Insufficient stock/);
  });
});
