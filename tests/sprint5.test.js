const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connect, close } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const ContactEnquiry = require('../models/ContactEnquiry');
const StoreSetting = require('../models/StoreSetting');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = `admin_sprint5_${Date.now()}@test.com`;
const ADMIN_PASS = 'admin123';
const USER_EMAIL = `user_sprint5_${Date.now()}@test.com`;
const USER_PASS = 'password123';

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

const createRegularUser = async () => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(USER_PASS, salt);
  return User.create({
    name: 'Regular User',
    email: USER_EMAIL,
    password: hashedPassword,
  });
};

const loginAdmin = async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  return res.body.token;
};

const loginUser = async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: USER_EMAIL, password: USER_PASS });
  return res.body.token;
};

const createProduct = async (data = {}) => {
  const defaults = {
    name: 'Test Product',
    sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    category: 'Rings',
    metal: 'Gold',
    price: 10000,
    stock: 10,
    status: 'active',
    minimumStock: 5,
    imageUrls: 'https://example.com/test.jpg',
  };
  const merged = { ...defaults, ...data };
  return Product.create(merged);
};

const createOrder = async (userId, productId, overrides = {}) => {
  return Order.create({
    user: userId,
    items: [{
      product: productId,
      name: 'Test Product',
      image: 'https://example.com/test.jpg',
      sku: 'SKU-001',
      price: 10000,
      quantity: 1,
      discount: 0,
      gst: 18,
      lineTotal: 10000,
    }],
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

const createEnquiry = async (status = 'new') => {
  return ContactEnquiry.create({
    name: 'Test Enquiry',
    email: `enquiry_${Math.random().toString(36).slice(2, 8)}@test.com`,
    message: 'This is a test enquiry message',
    phone: '9999999999',
    status,
    delivered: true,
  });
};

afterAll(async () => {
  await mongoose.disconnect();
});

describe('Sprint 5: Admin Dashboard', () => {
  let adminToken;
  let userToken;
  let productId;
  let orderId;
  let enquiryId;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser();
    adminToken = await loginAdmin();

    await StoreSetting.deleteMany({});
    await StoreSetting.create({ storeName: 'Test Store' });

    productId = await createProduct();
    const user = await createRegularUser();
    userToken = await loginUser();

    orderId = await createOrder(user._id, productId);
    enquiryId = await createEnquiry();
  });

  afterAll(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await ContactEnquiry.deleteMany({});
    await User.deleteMany({});
    await StoreSetting.deleteMany({});
    await close();
  });

  describe('GET /api/admin/dashboard', () => {
    it('should return dashboard data when authenticated as admin', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.totalSales).toBeDefined();
      expect(res.body.data.totalOrders).toBeDefined();
      expect(res.body.data.totalProducts).toBeDefined();
      expect(res.body.data.totalCustomers).toBeDefined();
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard');

      expect(res.status).toBe(401);
    });

    it('should return order status counts', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.orderStatusCounts).toBeDefined();
      const counts = res.body.data.orderStatusCounts;
      expect(counts.new || counts.pending_payment).toBeGreaterThan(0);
    });

    it('should return payment status counts', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatusCounts).toBeDefined();
    });

    it('should return contact enquiry stats', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.contactEnquiries).toBeDefined();
      expect(res.body.data.contactEnquiries.total).toBeGreaterThan(0);
    });

    it('should return low stock products', async () => {
      await createProduct({ name: 'Low Stock Product', stock: 2, minimumStock: 5 });
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.lowStockProducts).toBeGreaterThan(0);
      expect(res.body.data.lowStockList).toBeDefined();
    });

    it('should support date range parameters', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard?dateRange=today')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.dateRange).toBeDefined();
    });

    it('should support custom date range', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 10);
      const end = new Date();

      const res = await request(app)
        .get(`/api/admin/dashboard?startDate=${start.toISOString()}&endDate=${end.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.dateRange).toBeDefined();
    });

    it('should return recent orders', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recentOrders).toBeDefined();
      expect(Array.isArray(res.body.data.recentOrders)).toBe(true);
    });

    it('should return sales trend data', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.salesTrend).toBeDefined();
    });

    it('should return top selling products', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.topSellingProducts).toBeDefined();
    });

    it('should return top categories', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.topCategories).toBeDefined();
    });
  });
});

describe('Sprint 5: Admin Order Management', () => {
  let adminToken;
  let userToken;
  let productId;
  let orderId;
  let otherOrderId;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser();
    adminToken = await loginAdmin();

    const user = await createRegularUser();
    userToken = await loginUser();

    await StoreSetting.deleteMany({});
    await StoreSetting.create({ storeName: 'Test Store' });

    productId = (await createProduct({ name: 'Admin Order Product', price: 50000 }))._id;
    orderId = (await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'new' }))._id;
    otherOrderId = (await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'delivered' }))._id;
  });

  afterAll(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await ContactEnquiry.deleteMany({});
    await User.deleteMany({});
    await StoreSetting.deleteMany({});
    await close();
  });

  describe('GET /api/admin/orders', () => {
    it('should return orders list for admin', async () => {
      const res = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.total).toBeGreaterThanOrEqual(res.body.count);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get('/api/admin/orders');

      expect(res.status).toBe(401);
    });

    it('should filter by order status', async () => {
      const res = await request(app)
        .get('/api/admin/orders?status=new')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const statuses = res.body.data.map(o => o.status);
      expect(statuses.every(s => s === 'new')).toBe(true);
    });

    it('should filter by payment status', async () => {
      const res = await request(app)
        .get('/api/admin/orders?paymentStatus=pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('should filter by shipping status', async () => {
      const res = await request(app)
        .get('/api/admin/orders?shippingStatus=not_shipped')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('should search by order number', async () => {
      const order = await Order.findById(orderId);
      const res = await request(app)
        .get(`/api/admin/orders?search=${order.orderNumber}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('should paginate results', async () => {
      const res = await request(app)
        .get('/api/admin/orders?page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
    });

    it('should sort by field', async () => {
      const res = await request(app)
        .get('/api/admin/orders?sortBy=-createdAt&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should return pagination metadata', async () => {
      const res = await request(app)
        .get('/api/admin/orders?page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pages).toBeDefined();
      expect(res.body.hasMore).toBeDefined();
    });
  });

  describe('GET /api/admin/orders/:id', () => {
    it('should return order details for admin', async () => {
      const res = await request(app)
        .get(`/api/admin/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.orderNumber).toBeDefined();
      expect(res.body.data.items).toBeDefined();
      expect(res.body.data.shippingAddress).toBeDefined();
    });

    it('should return 400 for invalid order ID', async () => {
      const res = await request(app)
        .get('/api/admin/orders/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent order', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/admin/orders/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get(`/api/admin/orders/${orderId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get(`/api/admin/orders/${orderId}`);

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/admin/orders/:id', () => {
    it('should update order status', async () => {
      const res = await request(app)
        .put(`/api/admin/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('confirmed');
    });

    it('should reject invalid status', async () => {
      const res = await request(app)
        .put(`/api/admin/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'invalid_status' });

      expect(res.status).toBe(400);
    });

    it('should auto-set shipping status when shipped', async () => {
      const order = await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'processing' });
      const res = await request(app)
        .put(`/api/admin/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'shipped', trackingNumber: 'TRK123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.shippingStatus).toBe('shipped');
      expect(res.body.data.trackingNumber).toBe('TRK123456');
    });

    it('should auto-set shipping status when delivered', async () => {
      const order = await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'shipped', shippingStatus: 'shipped' });
      const res = await request(app)
        .put(`/api/admin/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' });

      expect(res.status).toBe(200);
      expect(res.body.data.shippingStatus).toBe('delivered');
    });

    it('should add tracking number', async () => {
      const order = await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'processing' });
      const res = await request(app)
        .put(`/api/admin/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ trackingNumber: 'TRK999999' });

      expect(res.status).toBe(200);
      expect(res.body.data.trackingNumber).toBe('TRK999999');
    });

    it('should reject invalid order ID', async () => {
      const res = await request(app)
        .put('/api/admin/orders/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent order', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .put(`/api/admin/orders/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(404);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .put(`/api/admin/orders/${orderId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .put(`/api/admin/orders/${orderId}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/orders/:id/invoice', () => {
    it('should download invoice for admin', async () => {
      const res = await request(app)
        .get(`/api/admin/orders/${orderId}/invoice`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get(`/api/admin/orders/${orderId}/invoice`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get(`/api/admin/orders/${orderId}/invoice`);

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/admin/orders/:id', () => {
    it('should delete order with "new" status', async () => {
      const order = await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'new' });
      const res = await request(app)
        .delete(`/api/admin/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should delete order with "cancelled" status', async () => {
      const order = await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'cancelled' });
      const res = await request(app)
        .delete(`/api/admin/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject deletion of order with "delivered" status', async () => {
      const order = await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'delivered' });
      const res = await request(app)
        .delete(`/api/admin/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('should reject deletion of order with "processing" status', async () => {
      const order = await createOrder(new mongoose.Types.ObjectId(), productId, { status: 'processing' });
      const res = await request(app)
        .delete(`/api/admin/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('should reject invalid order ID', async () => {
      const res = await request(app)
        .delete('/api/admin/orders/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent order', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .delete(`/api/admin/orders/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .delete(`/api/admin/orders/${orderId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .delete(`/api/admin/orders/${orderId}`);

      expect(res.status).toBe(401);
    });
  });
});

describe('Sprint 5: Admin Contact Management', () => {
  let adminToken;
  let userToken;
  let enquiryId;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser();
    adminToken = await loginAdmin();

    const user = await createRegularUser();
    userToken = await loginUser();

    await StoreSetting.deleteMany({});
    await StoreSetting.create({ storeName: 'Test Store' });

    enquiryId = (await createEnquiry('new'))._id;
    await createEnquiry('read');
    await createEnquiry('replied');
    await createEnquiry('archived');
  });

  afterAll(async () => {
    await ContactEnquiry.deleteMany({});
    await Product.deleteMany({});
    await Order.deleteMany({});
    await User.deleteMany({});
    await StoreSetting.deleteMany({});
    await close();
  });

  describe('GET /api/contact/admin', () => {
    it('should return enquiries list for admin', async () => {
      const res = await request(app)
        .get('/api/contact/admin')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get('/api/contact/admin')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get('/api/contact/admin');

      expect(res.status).toBe(401);
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/contact/admin?status=new')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('should search by name/email/message', async () => {
      const res = await request(app)
        .get('/api/contact/admin?search=Test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('should paginate results', async () => {
      const res = await request(app)
        .get('/api/contact/admin?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
    });

    it('should return pagination metadata', async () => {
      const res = await request(app)
        .get('/api/contact/admin?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pages).toBeDefined();
      expect(res.body.hasMore).toBeDefined();
    });

    it('should return status stats', async () => {
      const res = await request(app)
        .get('/api/contact/admin')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats).toBeDefined();
    });

    it('should return 400 for invalid enquiry ID', async () => {
      const res = await request(app)
        .get('/api/contact/admin/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent enquiry', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/contact/admin/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/contact/admin/:id', () => {
    it('should return single enquiry for admin', async () => {
      const res = await request(app)
        .get(`/api/contact/admin/${enquiryId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(String(res.body.data._id)).toBe(String(enquiryId));
    });
  });

  describe('Contact Statuses Endpoint', () => {
    it('should return available contact statuses', async () => {
      const res = await request(app)
        .get('/api/contact/admin/statuses')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBe(4);
    });

    it('should return contact stats', async () => {
      const res = await request(app)
        .get('/api/contact/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.total).toBeDefined();
    });
  });
});
