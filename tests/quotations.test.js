const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const Quotation = require('../models/Quotation');
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

describe('Quotations', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;
  let quotationId;

  const quotationData = {
    customer: {
      name: 'Test Customer',
      email: 'customer@test.com',
      phone: '+91 98765 43210',
      address: '123 Test Address, Chennai',
    },
    validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    items: [
      {
        productId: '',
        name: 'Gold Ring',
        sku: 'GOLD-RNG-001',
        metal: 'Gold',
        purity: '22K',
        grossWeight: '3.2',
        netWeight: '3.0',
        stoneWeight: '0.15',
        stoneType: 'Round',
        metalRate: 8500,
        makingCharges: 3500,
        wastage: 1200,
        stoneCharges: 8000,
        quantity: 1,
        discount: 0,
        gst: 18,
      },
    ],
    notes: 'Test quotation',
    status: 'draft',
  };

  beforeAll(async () => {
    const admin = await createAdminUser(`quote_admin_${Date.now()}@test.com`, 'admin123');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = res.body.token;
  });

  it('should create a quotation with auto-generated number', async () => {
    const res = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(quotationData);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quotationNumber).toMatch(/^QT-\d{4}-\d{5}$/);
    quotationId = res.body.data._id;
  });

  it('should update quotation status with valid transition', async () => {
    const res = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'sent' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('sent');
  });

  it('should reject invalid status transition', async () => {
    const res = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'converted' });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Invalid status transition/);
  });

  it('should get all quotations', async () => {
    const res = await request(app)
      .get('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('SKU-based Quotation Item Resolution', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    const admin = await createAdminUser(`sku_admin_${Date.now()}@test.com`, 'admin123');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = res.body.token;
  });

  afterEach(async () => {
    await Product.deleteMany({});
    await Quotation.deleteMany({});
  });

  it('should resolve SKU to product on quotation creation and populate discountPrice', async () => {
    const product = await Product.create({
      name: 'Diamond Pendant',
      category: 'Pendant Sets',
      sku: 'DIAM-PEND-007',
      price: 12000,
      discountPrice: 9500,
      stock: 10,
      status: 'active',
      images: [{ url: 'https://example.com/image.jpg', alt: '', order: 0 }],
    });

    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer: { name: 'SKU Customer', email: 'sku@test.com', phone: '+91 99999 99999', address: 'Test Addr' },
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
        items: [
          {
            productName: 'Diamond Pendant',
            sku: 'DIAM-PEND-007',
            qty: 1,
            price: 0,
            discount: 0,
            gst: 18,
          },
        ],
        status: 'draft',
      });

    expect(quoteRes.statusCode).toBe(201);
    expect(quoteRes.body.success).toBe(true);

    const item = quoteRes.body.data.items[0];
    expect(item.sku).toBe('DIAM-PEND-007');
    expect(item.product).toBeTruthy();
    expect(item.product._id).toBe(product._id.toString());
    expect(item.productName).toBe('Diamond Pendant');
    expect(item.price).toBe(9500);
    expect(item.product.discountPrice).toBe(9500);
  });

  it('should resolve SKU to product on quotation update', async () => {
    const product = await Product.create({
      name: 'Gold Bangle',
      category: 'Bangles',
      sku: 'GOLD-BNG-002',
      price: 8000,
      discountPrice: 7000,
      stock: 5,
      status: 'active',
      images: [{ url: 'https://example.com/image.jpg', alt: '', order: 0 }],
    });

    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer: { name: 'Update Customer', email: 'upd@test.com', phone: '+91 88888 88888', address: 'Upd Addr' },
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
        items: [
          {
            productName: 'Item 1',
            sku: 'GOLD-BNG-002',
            qty: 2,
            price: 0,
            discount: 0,
            gst: 18,
          },
        ],
        status: 'draft',
      });

    const quotationId = quoteRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [
          {
            productName: 'Item 1',
            sku: 'GOLD-BNG-002',
            qty: 3,
            price: 0,
            discount: 0,
            gst: 18,
          },
        ],
      });

    expect(updateRes.statusCode).toBe(200);
    const item = updateRes.body.data.items[0];
    expect(item.product._id).toBe(product._id.toString());
    expect(item.price).toBe(7000);
    expect(item.qty).toBe(3);
    expect(item.product.discountPrice).toBe(7000);
  });

  it('should use product list price when discountPrice is 0 or absent', async () => {
    await Product.create({
      name: 'Silver Ring',
      category: 'Rings',
      sku: 'SIL-RNG-099',
      price: 5000,
      discountPrice: 0,
      stock: 3,
      status: 'active',
    });

    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer: { name: 'List Price Customer', email: 'list@test.com', phone: '+91 77777 77777', address: 'List Addr' },
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
        items: [
          {
            productName: 'Silver Ring',
            sku: 'SIL-RNG-099',
            qty: 1,
            price: 0,
            discount: 0,
            gst: 18,
          },
        ],
        status: 'draft',
      });

    expect(quoteRes.statusCode).toBe(201);
    const item = quoteRes.body.data.items[0];
    expect(item.price).toBe(5000);
  });

  it('should preserve client-provided price and productName when SKU resolves', async () => {
    await Product.create({
      name: 'Custom Name Product',
      category: 'Bracelets',
      sku: 'CUSTOM-001',
      price: 3000,
      discountPrice: 2500,
      stock: 2,
      status: 'active',
    });

    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer: { name: 'Custom Customer', email: 'custom@test.com', phone: '+91 66666 66666', address: 'Custom Addr' },
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
        items: [
          {
            productName: 'Special Custom Name',
            sku: 'CUSTOM-001',
            qty: 1,
            price: 10000,
            discount: 0,
            gst: 18,
          },
        ],
        status: 'draft',
      });

    expect(quoteRes.statusCode).toBe(201);
    const item = quoteRes.body.data.items[0];
    expect(item.productName).toBe('Special Custom Name');
    expect(item.price).toBe(10000);
    expect(item.product.sku).toBe('CUSTOM-001');
  });

  it('should handle SKU that does not match any product', async () => {
    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer: { name: 'No Match Customer', email: 'nomatch@test.com', phone: '+91 55555 55555', address: 'No Match Addr' },
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
        items: [
          {
            productName: 'Unmatched Item',
            sku: 'NONEXISTENT-SKU',
            qty: 1,
            price: 100,
            discount: 0,
            gst: 18,
          },
        ],
        status: 'draft',
      });

    expect(quoteRes.statusCode).toBe(201);
    const item = quoteRes.body.data.items[0];
    expect(item.sku).toBe('NONEXISTENT-SKU');
    expect(item.productName).toBe('Unmatched Item');
    expect(item.price).toBe(100);
  });
});
