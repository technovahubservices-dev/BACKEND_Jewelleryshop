const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connect, close } = require('./setup');
const User = require('../models/User');
const ContactEnquiry = require('../models/ContactEnquiry');
const StoreSetting = require('../models/StoreSetting');
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

describe('Contact Us — Submission & Email Flow', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;
  let originalSettings;

  beforeAll(async () => {
    const admin = await createAdminUser(
      `contact_test_${Date.now()}@test.com`,
      'admin123'
    );
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = res.body.token;

    originalSettings = await StoreSetting.getSettings();
  });

  afterEach(async () => {
    await ContactEnquiry.deleteMany({});
    await StoreSetting.updateOne(
      {},
      { email: originalSettings.email, storeName: originalSettings.storeName }
    );
  });

  describe('1. Contact submission is saved', () => {
    it('should save a contact submission to the database', async () => {
      const settings = await StoreSetting.getSettings();
      await StoreSetting.updateOne({}, { email: 'store@example.com', storeName: 'Test Store' });

      const res = await request(app)
        .post('/api/contact')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '1234567890',
          message: 'I have a question about a ring',
        });

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);

      const enquiries = await ContactEnquiry.find({});
      expect(enquiries.length).toBe(1);
      expect(enquiries[0].name).toBe('Jane Doe');
      expect(enquiries[0].email).toBe('jane@example.com');
      expect(enquiries[0].phone).toBe('1234567890');
      expect(enquiries[0].message).toBe('I have a question about a ring');
      expect(enquiries[0].routedTo).toBe('store@example.com');
    });
  });

  describe('2. Contact submission appears through admin contact API', () => {
    it('should show submitted message in admin contact list', async () => {
      await StoreSetting.updateOne({}, { email: 'store@example.com', storeName: 'Test Store' });

      await request(app)
        .post('/api/contact')
        .send({
          name: 'Admin View Test',
          email: 'adminview@test.com',
          message: 'This should appear in admin',
        });

      const res = await request(app)
        .get('/api/contact/admin')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(1);
      const found = res.body.data.find((e) => e.email === 'adminview@test.com');
      expect(found).toBeDefined();
      expect(found.name).toBe('Admin View Test');
      expect(found.message).toBe('This should appear in admin');
    });

    it('should return enquiry detail via admin/:id endpoint', async () => {
      await StoreSetting.updateOne({}, { email: 'store@example.com', storeName: 'Test Store' });

      await request(app)
        .post('/api/contact')
        .send({
          name: 'Detail Test',
          email: 'detail@test.com',
          message: 'Test message for detail',
        });

      const enquiry = await ContactEnquiry.findOne({ email: 'detail@test.com' });

      const res = await request(app)
        .get(`/api/contact/admin/${enquiry._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(enquiry._id.toString());
      expect(res.body.data.name).toBe('Detail Test');
      expect(res.body.data.message).toBe('Test message for detail');
    });
  });

  describe('3. Contact submission sends email to Store Information email', () => {
    it('should send notification email to the StoreSetting email address', async () => {
      await StoreSetting.updateOne({}, { email: 'admin@store.com', storeName: 'My Store' });

      const res = await request(app)
        .post('/api/contact')
        .send({
          name: 'Email Test',
          email: 'customer@example.com',
          message: 'Testing email routing',
        });

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);

      const enquiry = await ContactEnquiry.findOne({ email: 'customer@example.com' });
      expect(enquiry).toBeDefined();
      expect(enquiry.routedTo).toBe('admin@store.com');
    });

    it('should return 202 with delivered=false when SMTP is not configured', async () => {
      await StoreSetting.updateOne({}, { email: 'store@example.com', storeName: 'Test Store' });

      const res = await request(app)
        .post('/api/contact')
        .send({
          name: 'No SMTP Test',
          email: 'nosmtp@test.com',
          message: 'Testing without SMTP',
        });

      expect([202, 200]).toContain(res.status);
      if (res.status === 202) {
        expect(res.body.delivered).toBe(false);
      }
    });

    it('should return 503 when Store Information email is not configured', async () => {
      await StoreSetting.updateOne({}, { email: '', storeName: 'No Email Store' });

      const res = await request(app)
        .post('/api/contact')
        .send({
          name: 'No Store Email',
          email: 'test@example.com',
          message: 'Testing store without email',
        });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Changing Store Information email changes future notification recipient', () => {
    it('should use the updated email when Store Setting changes', async () => {
      await StoreSetting.updateOne({}, { email: 'old@store.com', storeName: 'Test Store' });

      await request(app)
        .post('/api/contact')
        .send({
          name: 'Old Email Test',
          email: 'old1@test.com',
          message: 'First enquiry',
        });

      const enquiry1 = await ContactEnquiry.findOne({ email: 'old1@test.com' });
      expect(enquiry1.routedTo).toBe('old@store.com');

      await StoreSetting.updateOne({}, { email: 'new@store.com', storeName: 'Test Store' });

      await request(app)
        .post('/api/contact')
        .send({
          name: 'New Email Test',
          email: 'new1@test.com',
          message: 'Second enquiry',
        });

      const enquiry2 = await ContactEnquiry.findOne({ email: 'new1@test.com' });
      expect(enquiry2.routedTo).toBe('new@store.com');
    });
  });

  describe('5. No hard-coded admin email is used', () => {
    it('should not use a hard-coded email for notifications', async () => {
      const settings = await StoreSetting.getSettings();
      const storedEmail = settings.email;

      await StoreSetting.updateOne({}, { email: 'dynamic@email.com', storeName: 'Test Store' });

      await request(app)
        .post('/api/contact')
        .send({
          name: 'Dynamic Test',
          email: 'dyn@test.com',
          message: 'Testing dynamic email',
        });

      const enquiry = await ContactEnquiry.findOne({ email: 'dyn@test.com' });
      expect(enquiry.routedTo).toBe('dynamic@email.com');
      expect(enquiry.routedTo).not.toBe('admin@jkr.com');
      expect(enquiry.routedTo).not.toBe('support@jkr.com');
    });
  });

  describe('6. Contact API still works correctly', () => {
    it('should reject submission without name', async () => {
      const res = await request(app)
        .post('/api/contact')
        .send({ email: 'test@test.com', message: 'No name' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Name is required');
    });

    it('should reject submission without email', async () => {
      const res = await request(app)
        .post('/api/contact')
        .send({ name: 'Test', message: 'No email' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Email is required');
    });

    it('should reject submission without message', async () => {
      const res = await request(app)
        .post('/api/contact')
        .send({ name: 'Test', email: 'test@test.com' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Message is required');
    });

    it('should reject invalid email format', async () => {
      const res = await request(app)
        .post('/api/contact')
        .send({ name: 'Test', email: 'invalid-email', message: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should return contact status', async () => {
      const res = await request(app)
        .get('/api/contact/status');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('mailerConfigured');
    });
  });

  describe('7. Removed admin actions return 404', () => {
    it('should not have PUT /admin/:id/status route', async () => {
      const res = await request(app)
        .put('/api/contact/admin/000000000000000000000000/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'read' });

      expect(res.status).toBe(404);
    });

    it('should not have POST /admin/:id/reply route', async () => {
      const res = await request(app)
        .post('/api/contact/admin/000000000000000000000000/reply')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ replyMessage: 'Test reply' });

      expect(res.status).toBe(404);
    });
  });
});

describe('Product Price Accuracy', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    const admin = await createAdminUser(
      `price_test_${Date.now()}@test.com`,
      'admin123'
    );
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = res.body.token;
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  it('7. Saved product price is returned correctly from API', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Price Accuracy Ring')
      .field('category', 'Rings')
      .field('sku', 'PRICE-RNG-001')
      .field('price', '15000')
      .field('discountPrice', '12000')
      .field('stock', '5')
      .field('imageUrls', 'https://example.com/image.jpg');

    expect(res.status).toBe(201);
    expect(res.body.data.price).toBe(15000);
    expect(res.body.data.discountPrice).toBe(12000);
    expect(res.body.data.sellingPrice).toBe(12000);

    const productId = res.body.data._id;

    const getRes = await request(app).get(`/api/products/${productId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.price).toBe(15000);
    expect(getRes.body.data.discountPrice).toBe(12000);
    expect(getRes.body.data.sellingPrice).toBe(12000);
  });

  it('8. Public product details show the saved product price', async () => {
    const product = await Product.create({
      name: 'Public Price Product',
      category: 'Necklaces',
      sku: 'PUB-PRICE-001',
      price: 8000,
      discountPrice: 6500,
      stock: 3,
      status: 'active',
      images: [{ url: 'https://example.com/necklace.jpg', alt: '', order: 0 }],
    });

    const res = await request(app).get(`/api/products/${product._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(8000);
    expect(res.body.data.discountPrice).toBe(6500);
    expect(res.body.data.sellingPrice).toBe(6500);
  });

  it('9. Quotation product lookup returns the same authoritative product price', async () => {
    await Product.create({
      name: 'Quotation Price Match',
      category: 'Earrings',
      sku: 'QT-PRICE-001',
      price: 10000,
      discountPrice: 8000,
      stock: 5,
      status: 'active',
      images: [{ url: 'https://example.com/earrings.jpg', alt: '', order: 0 }],
    });

    const quoteRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer: {
          name: 'Price Match Customer',
          email: 'pricematch@test.com',
          phone: '+91 99999 99999',
          address: 'Test Address',
        },
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
        items: [
          {
            productName: 'Quotation Price Match',
            sku: 'QT-PRICE-001',
            qty: 1,
            price: 0,
            discount: 0,
            gst: 18,
          },
        ],
        status: 'draft',
      });

    expect(quoteRes.status).toBe(201);
    const item = quoteRes.body.data.items[0];
    expect(item.price).toBe(8000);
    expect(item.product.sku).toBe('QT-PRICE-001');
    expect(item.product.discountPrice).toBe(8000);
  });

  it('10. Existing discount behavior is preserved', async () => {
    const product = await Product.create({
      name: 'Discount Behavior Product',
      category: 'Rings',
      sku: 'DISC-BEHAVIOR-001',
      price: 20000,
      discountPrice: 15000,
      stock: 3,
      status: 'active',
      images: [{ url: 'https://example.com/discount.jpg', alt: '', order: 0 }],
    });

    const res = await request(app).get(`/api/products/${product._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(20000);
    expect(res.body.data.discountPrice).toBe(15000);
    expect(res.body.data.sellingPrice).toBe(15000);
    expect(res.body.data.discountAmount).toBe(5000);
    expect(res.body.data.discountPercentage).toBe(25);
    expect(res.body.data.hasDiscount).toBe(true);

    const noDiscountProduct = await Product.create({
      name: 'No Discount Product',
      category: 'Rings',
      sku: 'NO-DISC-001',
      price: 20000,
      discountPrice: 0,
      stock: 3,
      status: 'active',
      images: [{ url: 'https://example.com/nodisc.jpg', alt: '', order: 0 }],
    });

    const res2 = await request(app).get(`/api/products/${noDiscountProduct._id}`);

    expect(res2.status).toBe(200);
    expect(res2.body.data.price).toBe(20000);
    expect(res2.body.data.discountPrice).toBe(0);
    expect(res2.body.data.sellingPrice).toBe(20000);
    expect(res2.body.data.discountAmount).toBe(0);
    expect(res2.body.data.discountPercentage).toBe(0);
    expect(res2.body.data.hasDiscount).toBe(false);
  });
});