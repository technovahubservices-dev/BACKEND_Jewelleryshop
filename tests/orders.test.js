const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
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

const createRegularUser = async (email, password) => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const user = await User.create({
    name: 'Customer',
    email,
    password: hashedPassword,
  });
  return user;
};

describe('Order Creation & Stock Validation', () => {
  beforeAll(connect);
  afterAll(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

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
    expect(res.body.data.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
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

describe('My Orders (GET /api/orders/my-orders)', () => {
  beforeAll(connect);
  afterAll(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  let userToken;
  let adminToken;
  let productId;
  let otherUserToken;
  let orderId;

  const user = {
    name: 'My Orders User',
    email: `myorders_${Date.now()}@test.com`,
    password: 'password123',
  };

  const otherUser = {
    name: 'Other User',
    email: `other_${Date.now()}@test.com`,
    password: 'password123',
  };

  const product = {
    name: 'My Orders Product',
    sku: 'MYORD-001',
    category: 'Necklaces',
    metal: 'Silver',
    price: 5000,
    stock: 10,
    status: 'active',
  };

  beforeAll(async () => {
    await request(app).post('/api/auth/register').send(user);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password123' });
    userToken = loginRes.body.token;

    await request(app).post('/api/auth/register').send(otherUser);
    const otherLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: otherUser.email, password: 'password123' });
    otherUserToken = otherLoginRes.body.token;

    const admin = await createAdminUser(`admin_myorders_${Date.now()}@test.com`, 'admin123');
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
      .field('imageUrls', 'https://example.com/myorders-image.jpg');
    productId = productRes.body.data._id;

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [
          {
            product: productId,
            name: product.name,
            price: product.price,
            quantity: 1,
            sku: product.sku,
            discount: 0,
            gst: 250,
            lineTotal: 5000,
          },
        ],
        shippingAddress: {
          fullName: 'My Orders User',
          address: '456 Order St',
          city: 'Mumbai',
          state: 'Maharashtra',
        },
        paymentMethod: 'cod',
        itemsPrice: 5000,
        taxPrice: 250,
        shippingPrice: 0,
        totalPrice: 5250,
      });

    orderId = orderRes.body.data._id;
  });

  it('should return only the authenticated user orders', async () => {
    const res = await request(app)
      .get('/api/orders/my-orders')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it('should not return other users orders', async () => {
    const res = await request(app)
      .get('/api/orders/my-orders')
      .set('Authorization', `Bearer ${otherUserToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it('should support pagination with limit and page', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          items: [
            {
              product: productId,
              name: product.name,
              price: product.price,
              quantity: 1,
              sku: product.sku,
              discount: 0,
              gst: 250,
              lineTotal: 5000,
            },
          ],
          shippingAddress: {
            fullName: 'My Orders User',
            address: '456 Order St',
            city: 'Mumbai',
            state: 'Maharashtra',
          },
          paymentMethod: 'cod',
          itemsPrice: 5000,
          taxPrice: 250,
          shippingPrice: 0,
          totalPrice: 5250,
        });
    }

    const res = await request(app)
      .get('/api/orders/my-orders?limit=2&page=1')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.pagination).toBeUndefined();
    expect(res.body.page).toBe(1);
    expect(res.body.pages).toBe(2);
  });

  it('should deny access without auth token', async () => {
    const res = await request(app)
      .get('/api/orders/my-orders');

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('Order Details (GET /api/orders/:id)', () => {
  beforeAll(connect);
  afterAll(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  let userToken;
  let adminToken;
  let otherUserToken;
  let productId;
  let orderId;

  const user = {
    name: 'Order Details User',
    email: `orderdetails_${Date.now()}@test.com`,
    password: 'password123',
  };

  const otherUser = {
    name: 'Other Details User',
    email: `otherdetails_${Date.now()}@test.com`,
    password: 'password123',
  };

  const product = {
    name: 'Details Product',
    sku: 'DETAILS-001',
    category: 'Earrings',
    metal: 'Gold',
    price: 3000,
    stock: 10,
    status: 'active',
  };

  beforeAll(async () => {
    await request(app).post('/api/auth/register').send(user);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password123' });
    userToken = loginRes.body.token;

    await request(app).post('/api/auth/register').send(otherUser);
    const otherLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: otherUser.email, password: 'password123' });
    otherUserToken = otherLoginRes.body.token;

    const admin = await createAdminUser(`admin_details_${Date.now()}@test.com`, 'admin123');
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
      .field('imageUrls', 'https://example.com/details-image.jpg');
    productId = productRes.body.data._id;

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [
          {
            product: productId,
            name: product.name,
            price: product.price,
            quantity: 1,
            sku: product.sku,
            discount: 0,
            gst: 150,
            lineTotal: 3000,
          },
        ],
        shippingAddress: {
          fullName: 'Order Details User',
          address: '789 Detail St',
          city: 'Delhi',
          state: 'Delhi',
        },
        billingAddress: {
          fullName: 'Order Details User',
          address: '789 Detail St',
          city: 'Delhi',
          state: 'Delhi',
        },
        paymentMethod: 'cod',
        itemsPrice: 3000,
        taxPrice: 150,
        shippingPrice: 0,
        totalPrice: 3150,
      });

    orderId = orderRes.body.data._id;
  });

  it('should return full order details for the owner', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe(orderId);
    expect(res.body.data.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(res.body.data.status).toBe('new');
    expect(res.body.data.items[0]).toHaveProperty('sku');
    expect(res.body.data.items[0]).toHaveProperty('discount');
    expect(res.body.data.items[0]).toHaveProperty('gst');
    expect(res.body.data.items[0]).toHaveProperty('lineTotal');
    expect(res.body.data.shippingAddress).toBeDefined();
    expect(res.body.data.billingAddress).toBeDefined();
  });

  it('should deny access to another users order', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${otherUserToken}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 404 for non-existent order', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .get(`/api/orders/${fakeId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 for invalid order ID', async () => {
    const res = await request(app)
      .get('/api/orders/invalid-id')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should deny access without auth token', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}`);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('Order Invoice (GET /api/orders/:id/invoice)', () => {
  beforeAll(connect);
  afterAll(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  let userToken;
  let adminToken;
  let otherUserToken;
  let productId;
  let orderId;

  const user = {
    name: 'Invoice User',
    email: `invoice_${Date.now()}@test.com`,
    password: 'password123',
  };

  const otherUser = {
    name: 'Other Invoice User',
    email: `otherinvoice_${Date.now()}@test.com`,
    password: 'password123',
  };

  const product = {
    name: 'Invoice Product',
    sku: 'INVOICE-001',
    category: 'Rings',
    metal: 'Gold',
    price: 8000,
    stock: 10,
    status: 'active',
  };

  beforeAll(async () => {
    await request(app).post('/api/auth/register').send(user);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password123' });
    userToken = loginRes.body.token;

    await request(app).post('/api/auth/register').send(otherUser);
    const otherLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: otherUser.email, password: 'password123' });
    otherUserToken = otherLoginRes.body.token;

    const admin = await createAdminUser(`admin_invoice_${Date.now()}@test.com`, 'admin123');
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
      .field('imageUrls', 'https://example.com/invoice-image.jpg');
    productId = productRes.body.data._id;

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [
          {
            product: productId,
            name: product.name,
            price: product.price,
            quantity: 1,
            sku: product.sku,
            discount: 0,
            gst: 400,
            lineTotal: 8000,
          },
        ],
        shippingAddress: {
          fullName: 'Invoice User',
          address: 'Invoice St',
          city: 'Hyderabad',
          state: 'Telangana',
        },
        billingAddress: {
          fullName: 'Invoice User',
          address: 'Invoice St',
          city: 'Hyderabad',
          state: 'Telangana',
        },
        paymentMethod: 'cod',
        itemsPrice: 8000,
        taxPrice: 400,
        shippingPrice: 0,
        totalPrice: 8400,
      });

    orderId = orderRes.body.data._id;
  });

  it('should download invoice as PDF for the owner', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('should deny invoice access to another user', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${otherUserToken}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 for invalid order ID on invoice', async () => {
    const res = await request(app)
      .get('/api/orders/invalid-id/invoice')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should deny invoice access without auth token', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}/invoice`);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
