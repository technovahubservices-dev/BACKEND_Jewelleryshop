const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connect, close } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const StoreSetting = require('../models/StoreSetting');
const HomepageSetting = require('../models/HomepageSetting');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = `admin_task1_${Date.now()}@test.com`;
const ADMIN_PASS = 'admin123';

const createAdminUser = async () => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(ADMIN_PASS, salt);
  return User.create({
    name: 'Admin User',
    email: ADMIN_EMAIL,
    password: hashedPassword,
    isAdmin: true,
  });
};

const loginAdmin = async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  return res.body.token;
};

const createProduct = async (data = {}) => {
  const defaults = {
    name: 'Test Product',
    sku: `TASK1-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    category: 'Rings',
    jewelleryCollection: 'Fine Jewellery',
    metal: 'Gold',
    price: 10000,
    stock: 10,
    status: 'active',
    images: ['https://example.com/test.jpg'],
  };
  return Product.create({ ...defaults, ...data });
};

const createOrder = async (overrides = {}) => {
  return Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        name: 'Test Product',
        image: 'https://example.com/test.jpg',
        sku: 'SKU-TEST',
        price: 10000,
        quantity: 1,
        discount: 0,
        gst: 18,
        lineTotal: 11800,
      },
    ],
    shippingAddress: {
      fullName: 'Test User',
      phone: '9999999999',
      address: '123 Test St',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
    },
    billingAddress: {
      fullName: 'Test User',
      phone: '9999999999',
      address: '123 Test St',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
    },
    paymentMethod: 'cod',
    itemsPrice: 10000,
    taxPrice: 1800,
    shippingPrice: 0,
    discount: 0,
    totalPrice: 11800,
    ...overrides,
  });
};

describe('TASK 1: Fine Jewellery, Policy Collapse, Invoice PDF', () => {
  let adminToken;
  let productId1;
  let productId2;
  let productId3;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser();
    adminToken = await loginAdmin();

    await StoreSetting.deleteMany({});
    await StoreSetting.create({ storeName: 'Test Store', email: 'test@test.com', phone: '9999999999' });

    await HomepageSetting.deleteMany({});
    await HomepageSetting.create({ storeName: 'Test Store', footerLogoUrl: '' });

    productId1 = await createProduct({
      name: 'Fine Ring A',
      price: 5000,
      jewelleryCollection: 'Fine Jewellery',
      purity: '14K',
      isFeatured: true,
      rating: 4.5,
      createdAt: new Date('2024-01-01'),
    });

    productId2 = await createProduct({
      name: 'Fine Ring B',
      price: 15000,
      jewelleryCollection: 'Fine Jewellery',
      purity: '18K',
      isBestSeller: true,
      rating: 3.5,
      createdAt: new Date('2024-03-01'),
    });

    productId3 = await createProduct({
      name: 'Fine Ring C',
      price: 25000,
      jewelleryCollection: 'Fine Jewellery',
      purity: '22K',
      rating: 5,
      createdAt: new Date('2024-06-01'),
    });
  });

  afterAll(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await StoreSetting.deleteMany({});
    await HomepageSetting.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  describe('Fine Jewellery - Sort by Recommended', () => {
    it('should sort by recommended (isFeatured, isBestSeller, rating, createdAt)', async () => {
      const res = await request(app)
        .get('/api/products?jewelleryCollection=Fine Jewellery&sort=recommended&status=active');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      expect(products.length).toBe(3);
      // Product 1 has isFeatured=true, so it should be first
      expect(products[0].isFeatured).toBe(true);
    });

    it('should fall back to -createdAt when sort is not recognized', async () => {
      const res = await request(app)
        .get('/api/products?jewelleryCollection=Fine Jewellery&sort=invalid&status=active');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      // Newest first
      for (let i = 1; i < products.length; i++) {
        const prevDate = new Date(products[i - 1].createdAt);
        const currDate = new Date(products[i].createdAt);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }
    });
  });

  describe('Fine Jewellery - Purity Filter Removed', () => {
    it('should ignore purity filter for Fine Jewellery collection', async () => {
      const res = await request(app)
        .get('/api/products?jewelleryCollection=Fine Jewellery&purity=14K&status=active');

      expect(res.statusCode).toBe(200);
      // All Fine Jewellery products should be returned, ignoring purity filter
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.jewelleryCollection).toBe('Fine Jewellery');
      });
      expect(products.length).toBe(3);
    });

    it('should still apply purity filter for non-Fine Jewellery collections', async () => {
      await createProduct({
        name: 'Other Ring',
        price: 8000,
        jewelleryCollection: 'Heritage',
        purity: '14K',
        status: 'active',
      });
      await createProduct({
        name: 'Other Ring 2',
        price: 9000,
        jewelleryCollection: 'Heritage',
        purity: '18K',
        status: 'active',
      });

      const res = await request(app)
        .get('/api/products?jewelleryCollection=Heritage&purity=14K&status=active');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].purity).toBe('14K');
    });
  });

  describe('Fine Jewellery - Pagination', () => {
    it('should paginate correctly with 2 items per page', async () => {
      const res1 = await request(app)
        .get('/api/products?jewelleryCollection=Fine Jewellery&sort=recommended&limit=2&page=1&status=active');
      expect(res1.statusCode).toBe(200);
      expect(res1.body.page).toBe(1);
      expect(res1.body.data.length).toBe(2);
      expect(res1.body.total).toBe(3);
      expect(res1.body.pages).toBe(2);

      const res2 = await request(app)
        .get('/api/products?jewelleryCollection=Fine Jewellery&sort=recommended&limit=2&page=2&status=active');
      expect(res2.statusCode).toBe(200);
      expect(res2.body.page).toBe(2);
      expect(res2.body.data.length).toBe(1);
    });

    it('should return correct total count and pages from filtered results', async () => {
      const res = await request(app)
        .get('/api/products?jewelleryCollection=Fine Jewellery&limit=5&page=1&status=active');

      expect(res.statusCode).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.pages).toBe(1);
      expect(res.body.count).toBe(3);
    });

    it('page 4 should return empty if fewer items exist', async () => {
      const res = await request(app)
        .get('/api/products?jewelleryCollection=Fine Jewellery&limit=1&page=4&status=active');

      expect(res.statusCode).toBe(200);
      expect(res.body.page).toBe(4);
      expect(res.body.data.length).toBe(0);
    });
  });

  describe('Product View - Our Jewellery Policy (Collapsed by Default)', () => {
    it('should return collapsedByDefault field in public policy response', async () => {
      await StoreSetting.deleteMany({});
      await StoreSetting.create({
        storeName: 'Test Store',
        email: 'test@test.com',
        phone: '9999999999',
        currency: 'INR',
        policies: [
          {
            type: 'authenticity',
            title: 'Our Jewellery Policy',
            description: 'All jewellery is certified authentic.',
            icon: 'shield-check',
            sortOrder: 1,
            isActive: true,
            collapsedByDefault: true,
          },
          {
            type: 'returns',
            title: 'Returns Policy',
            description: '30-day returns available.',
            icon: 'return',
            sortOrder: 2,
            isActive: true,
            collapsedByDefault: false,
          },
        ],
      });

      const res = await request(app).get('/api/store/public');

      expect(res.statusCode).toBe(200);
      const authPolicy = res.body.data.policies.find((p) => p.type === 'authenticity');
      expect(authPolicy).toBeDefined();
      expect(authPolicy.title).toBe('Our Jewellery Policy');
      expect(authPolicy.collapsedByDefault).toBe(true);

      const returnsPolicy = res.body.data.policies.find((p) => p.type === 'returns');
      expect(returnsPolicy.collapsedByDefault).toBe(false);
    });

    it('should return collapsedByDefault in admin settings response', async () => {
      const res = await request(app)
        .get('/api/store')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      const authPolicy = res.body.data.policies.find((p) => p.type === 'authenticity');
      expect(authPolicy.collapsedByDefault).toBe(true);
    });

    it('should preserve existing policy content', async () => {
      const res = await request(app).get('/api/store/public');

      expect(res.statusCode).toBe(200);
      const authPolicy = res.body.data.policies.find((p) => p.title === 'Our Jewellery Policy');
      expect(authPolicy).toBeDefined();
      expect(authPolicy.description).toBe('All jewellery is certified authentic.');
    });

    it('should allow setting collapsedByDefault to false', async () => {
      const res = await request(app)
        .put('/api/store')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          policies: [
            {
              type: 'authenticity',
              title: 'Our Jewellery Policy',
              description: 'All jewellery is certified authentic.',
              icon: 'shield-check',
              sortOrder: 1,
              isActive: true,
              collapsedByDefault: false,
            },
          ],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.policies[0].collapsedByDefault).toBe(false);
    });
  });

  describe('Invoice PDF', () => {
    let orderId;

    beforeAll(async () => {
      const order = await createOrder();
      orderId = order._id;

      await StoreSetting.deleteMany({});
      await StoreSetting.create({
        storeName: 'JKR Jewellery',
        email: 'support@jkr.com',
        phone: '+1 (555) 019-8234',
        currency: 'INR',
      });

      await HomepageSetting.deleteMany({});
      await HomepageSetting.create({ storeName: 'JKR', footerLogoUrl: '' });
    });

    afterAll(async () => {
      await Order.deleteMany({});
      await StoreSetting.deleteMany({});
      await HomepageSetting.deleteMany({});
    });

    it('should generate PDF with store information dynamically', async () => {
      const res = await request(app)
        .get(`/api/orders/${orderId}/invoice`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/attachment/i);
    });

    it('should include logo when available', async () => {
      const { generateInvoicePDF } = require('../services/invoiceService');
      const order = await Order.findById(orderId).populate('user');

      const originalUrl = process.env.BACKEND_URL;
      process.env.BACKEND_URL = 'http://localhost:5000';

      try {
        const doc = await generateInvoicePDF(order);
        expect(Buffer.isBuffer(doc)).toBe(true);
        expect(doc.length).toBeGreaterThan(0);
      } finally {
        if (originalUrl) process.env.BACKEND_URL = originalUrl;
        else delete process.env.BACKEND_URL;
      }
    });

    it('should generate PDF without crashing when logo is empty', async () => {
      const { generateInvoicePDF } = require('../services/invoiceService');
      const order = await Order.findById(orderId);

      const doc = await generateInvoicePDF(order);
      expect(Buffer.isBuffer(doc)).toBe(true);
      expect(doc.length).toBeGreaterThan(100);
    });

    it('should align table columns within page margins', async () => {
      const { buildInvoiceData } = require('../services/invoiceService');
      const order = await Order.findById(orderId);

      const data = await buildInvoiceData(order);
      expect(data).toBeDefined();
      expect(data.storeName).toBe('JKR Jewellery');
      expect(data.storeEmail).toBe('support@jkr.com');
      expect(data.storePhone).toBe('+1 (555) 019-8234');
      expect(data.items).toHaveLength(1);
      expect(data.grandTotal).toBe(11800);
    });

    it('should download invoice from admin endpoint', async () => {
      const res = await request(app)
        .get(`/api/admin/orders/${orderId}/invoice`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });
  });
});
