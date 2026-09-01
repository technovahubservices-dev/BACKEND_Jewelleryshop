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
