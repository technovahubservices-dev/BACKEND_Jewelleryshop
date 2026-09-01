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

describe('Authorization', () => {
  beforeAll(connect);
  afterAll(close);

  let userToken;
  let adminToken;
  let userId;
  let adminId;

  const user = {
    name: 'Normal User',
    email: `user_${Date.now()}@test.com`,
    password: 'password123',
    isAdmin: false,
  };

  beforeAll(async () => {
    const userRes = await request(app)
      .post('/api/auth/register')
      .send(user);
    userToken = userRes.body.token;
    userId = userRes.body._id;

    const admin = await createAdminUser(`admin_auth_${Date.now()}@test.com`, 'admin123');
    adminId = admin._id;
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = adminRes.body.token;
  });

  it('should allow admin to access admin routes', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
  });

  it('should allow public access to public routes', async () => {
    const res = await request(app)
      .get('/api/products');

    expect(res.statusCode).toBe(200);
  });

  it('should reject unauthenticated access to protected routes', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ name: 'Test Product' });

    expect(res.statusCode).toBe(401);
  });

  it('should reject non-admin from admin-only routes', async () => {
    const res = await request(app)
      .get('/api/quotations')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(403);
  });

  it('should validate admin role from database, not client-side state', async () => {
    await User.findByIdAndUpdate(userId, { isAdmin: true });

    const res = await request(app)
      .get('/api/quotations')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);

    await User.findByIdAndUpdate(userId, { isAdmin: false });
  });

  it('should revoke admin access when isAdmin is changed to false in database', async () => {
    await User.findByIdAndUpdate(adminId, { isAdmin: false });

    const res = await request(app)
      .get('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(403);

    await User.findByIdAndUpdate(adminId, { isAdmin: true });
  });

  it('should not trust isAdmin claim from manipulated JWT payload', async () => {
    const [header, payload, signature] = adminToken.split('.');
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64').toString());
    decodedPayload.isAdmin = false;
    const manipulatedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64');
    const manipulatedToken = `${header}.${manipulatedPayload}.${signature}`;

    const res = await request(app)
      .get('/api/quotations')
      .set('Authorization', `Bearer ${manipulatedToken}`);

    expect(res.statusCode).toBe(401);
  });
});
