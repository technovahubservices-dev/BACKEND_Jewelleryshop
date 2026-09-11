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
  return User.create({
    name: 'Admin',
    email,
    password: hashedPassword,
    isAdmin: true,
  });
};

describe('TASK 2: Product Image Preview & Quotation SKU', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    const admin = await createAdminUser(
      `task2_admin_${Date.now()}@test.com`,
      'admin123'
    );
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = res.body.token;
  });

  afterEach(async () => {
    await Product.deleteMany({});
    await Quotation.deleteMany({});
  });

  // ===========================================
  // 1. Product Image URL/API Response
  // ===========================================
  describe('Product Image URL/API Response', () => {
    it('should return primaryImage and image URLs in product detail response', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Image Test Ring')
        .field('sku', 'IMG-TEST-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '10000')
        .field('stock', '10')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/ring1.jpg,https://example.com/ring2.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.data.images).toBeInstanceOf(Array);
      expect(res.body.data.images.length).toBeGreaterThan(0);
      expect(res.body.data.images[0]).toHaveProperty('url');
      expect(res.body.data.images[0].url).toBe('https://example.com/ring1.jpg');
      expect(res.body.data.primaryImage).toBe('https://example.com/ring1.jpg');
    });

    it('should return image URLs in product listing response', async () => {
      await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Listing Image Product')
        .field('sku', 'LIST-IMG-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '10000')
        .field('stock', '10')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/listing.jpg');

      const res = await request(app).get('/api/products');
      expect(res.statusCode).toBe(200);
      const product = res.body.data.find((p) => p.sku === 'LIST-IMG-001');
      expect(product).toBeDefined();
      expect(product.images).toBeInstanceOf(Array);
      expect(product.images.length).toBeGreaterThan(0);
      expect(product.images[0].url).toBe('https://example.com/listing.jpg');
    });

    it('should preserve images when updating product without imageUrls', async () => {
      const createRes = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Update Image Product')
        .field('sku', 'UPD-IMG-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '10000')
        .field('stock', '10')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/update.jpg');

      expect(createRes.statusCode).toBe(201);
      const productId = createRes.body.data._id;

      const updateRes = await request(app)
        .put(`/api/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('price', '15000')
        .field('imageUrls', JSON.stringify([{ url: 'https://example.com/update.jpg', alt: '', order: 0 }]));

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.data.images).toBeInstanceOf(Array);
      expect(updateRes.body.data.images.length).toBeGreaterThan(0);
      expect(updateRes.body.data.images[0].url).toBe('https://example.com/update.jpg');
      expect(updateRes.body.data.primaryImage).toBe('https://example.com/update.jpg');
    });
  });

  // ===========================================
  // 2. Unique SKU
  // ===========================================
  describe('Unique SKU', () => {
    it('should enforce unique SKU at the database level', async () => {
      const product1 = await Product.create({
        name: 'Product A',
        category: 'Rings',
        sku: 'UNIQUE-SKU-001',
        price: 10000,
        status: 'active',
        images: [{ url: 'https://example.com/a.jpg', alt: '', order: 0 }],
      });

      await expect(
        Product.create({
          name: 'Product B',
          category: 'Rings',
          sku: 'UNIQUE-SKU-001',
          price: 20000,
          status: 'active',
          images: [{ url: 'https://example.com/b.jpg', alt: '', order: 0 }],
        })
      ).rejects.toThrow(/duplicate key|11000/i);

      const product2 = await Product.create({
        name: 'Product C',
        category: 'Rings',
        sku: 'UNIQUE-SKU-002',
        price: 30000,
        status: 'active',
        images: [{ url: 'https://example.com/c.jpg', alt: '', order: 0 }],
      });

      const product1Db = await Product.findById(product1._id);
      const product2Db = await Product.findById(product2._id);
      expect(product1Db.sku).toBe('UNIQUE-SKU-001');
      expect(product2Db.sku).toBe('UNIQUE-SKU-002');
    });

    it('should have unique index on SKU field', async () => {
      const indexes = await Product.collection.indexExists('sku_1');
      expect(indexes).toBe(true);
    });
  });

  // ===========================================
  // 3. Duplicate SKU Rejection During Create
  // ===========================================
  describe('Duplicate SKU Rejection During Create', () => {
    it('should reject creating a product with an existing SKU', async () => {
      await Product.create({
        name: 'Existing Product',
        category: 'Rings',
        sku: 'DUP-CREATE-001',
        price: 10000,
        status: 'active',
        images: [{ url: 'https://example.com/existing.jpg', alt: '', order: 0 }],
      });

      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Duplicate Product')
        .field('sku', 'DUP-CREATE-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '5000')
        .field('stock', '5')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/new.jpg');

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('SKU');
    });

    it('should allow creating a product with a new SKU', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Unique Product')
        .field('sku', 'UNIQUE-CREATE-002')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '5000')
        .field('stock', '5')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/unique.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.data.sku).toBe('UNIQUE-CREATE-002');
    });
  });

  // ===========================================
  // 4. Duplicate SKU Rejection During Update
  // ===========================================
  describe('Duplicate SKU Rejection During Update', () => {
    it('should reject updating a product to use another product SKU', async () => {
      const product1 = await Product.create({
        name: 'Product One',
        category: 'Rings',
        sku: 'DUP-UPDATE-001',
        price: 10000,
        status: 'active',
        images: [{ url: 'https://example.com/p1.jpg', alt: '', order: 0 }],
      });

      const product2 = await Product.create({
        name: 'Product Two',
        category: 'Rings',
        sku: 'DUP-UPDATE-002',
        price: 20000,
        status: 'active',
        images: [{ url: 'https://example.com/p2.jpg', alt: '', order: 0 }],
      });

      const res = await request(app)
        .put(`/api/products/${product2._id.toString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Updated Product Two')
        .field('sku', 'DUP-UPDATE-001')
        .field('imageUrls', JSON.stringify([{ url: 'https://example.com/p2.jpg', alt: '', order: 0 }]));

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('SKU');

      const product2Db = await Product.findById(product2._id);
      expect(product2Db.sku).toBe('DUP-UPDATE-002');
    });

    it('should allow keeping the same SKU on update', async () => {
      const product = await Product.create({
        name: 'Same SKU Product',
        category: 'Rings',
        sku: 'SAME-UPDATE-001',
        price: 15000,
        status: 'active',
        images: [{ url: 'https://example.com/same.jpg', alt: '', order: 0 }],
      });

      const res = await request(app)
        .put(`/api/products/${product._id.toString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Updated Name')
        .field('sku', 'SAME-UPDATE-001')
        .field('price', '12000')
        .field('imageUrls', JSON.stringify([{ url: 'https://example.com/same.jpg', alt: '', order: 0 }]));

      expect(res.statusCode).toBe(200);
      expect(res.body.data.sku).toBe('SAME-UPDATE-001');
      expect(res.body.data.price).toBe(12000);
    });
  });

  // ===========================================
  // 5. Valid SKU Lookup
  // ===========================================
  describe('Valid SKU Lookup', () => {
    it('should return product details for valid SKU via /sku/:sku endpoint', async () => {
      await Product.create({
        name: 'SKU Lookup Product',
        category: 'Earrings',
        subcategory: 'Diamond Earrings',
        sku: 'SKU-LOOKUP-001',
        price: 8000,
        discountPrice: 6500,
        stock: 15,
        status: 'active',
        metal: 'Gold',
        purity: '14K',
        weight: '2.5g',
        images: [{ url: 'https://example.com/earring.jpg', alt: '', order: 0 }],
      });

      const res = await request(app).get('/api/products/sku/SKU-LOOKUP-001');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data._id).toBeTruthy();
      expect(res.body.data.name).toBe('SKU Lookup Product');
      expect(res.body.data.sku).toBe('SKU-LOOKUP-001');
      expect(res.body.data.price).toBe(8000);
      expect(res.body.data.discountPrice).toBe(6500);
    });

    it('should return 404 for invalid (non-existent) SKU', async () => {
      const res = await request(app).get('/api/products/sku/NONEXISTENT-999');

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for empty SKU', async () => {
      const res = await request(app).get('/api/products/sku/');

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ===========================================
  // 6. Quotation Edit Does Not Change Product
  // ===========================================
  describe('Quotation Edit Does Not Change Product', () => {
    it('should not modify the Product when quotation items are edited', async () => {
      const product = await Product.create({
        name: 'Quotation Edit Product',
        category: 'Rings',
        sku: 'QEDIT-001',
        price: 10000,
        discountPrice: 8000,
        stock: 5,
        status: 'active',
        images: [{ url: 'https://example.com/edit.jpg', alt: '', order: 0 }],
      });

      const originalProduct = await Product.findById(product._id);
      const originalPrice = originalProduct.price;
      const originalDiscount = originalProduct.discountPrice;
      const originalStock = originalProduct.stock;

      const quoteRes = await request(app)
        .post('/api/quotations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: { name: 'Edit Test', email: 'edit@test.com', phone: '+91 99999 99999', address: 'Test Addr' },
          validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
          items: [
            {
              productName: 'Edit Product',
              sku: 'QEDIT-001',
              qty: 2,
              price: 0,
              discount: 0,
              gst: 18,
            },
          ],
          status: 'draft',
        });

      expect(quoteRes.statusCode).toBe(201);
      const quotationId = quoteRes.body.data._id;

      // Edit the quotation with different price and quantity
      const updateRes = await request(app)
        .put(`/api/quotations/${quotationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            {
              productName: 'Edit Product',
              sku: 'QEDIT-001',
              qty: 5,
              price: 999,
              discount: 10,
              gst: 5,
            },
          ],
        });

      expect(updateRes.statusCode).toBe(200);

      // Verify the product was NOT modified
      const productAfterUpdate = await Product.findById(product._id);
      expect(productAfterUpdate.price).toBe(originalPrice);
      expect(productAfterUpdate.discountPrice).toBe(originalDiscount);
      expect(productAfterUpdate.stock).toBe(originalStock);

      // Verify the quotation was updated
      expect(updateRes.body.data.items[0].qty).toBe(5);
      expect(updateRes.body.data.items[0].price).toBe(999);
      expect(updateRes.body.data.items[0].discount).toBe(10);
      expect(updateRes.body.data.items[0].gst).toBe(5);
    });

    it('should allow editing quotation price, quantity, discount and GST independently', async () => {
      const product = await Product.create({
        name: 'Indep Edit Product',
        category: 'Rings',
        sku: 'INDEP-EDIT-001',
        price: 10000,
        discountPrice: 8000,
        stock: 5,
        status: 'active',
        images: [{ url: 'https://example.com/indep.jpg', alt: '', order: 0 }],
      });

      const quoteRes = await request(app)
        .post('/api/quotations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: { name: 'Indep Test', email: 'indep@test.com', phone: '+91 99999 99999', address: 'Test Addr' },
          validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
          items: [
            {
              productName: 'Indep Product',
              sku: 'INDEP-EDIT-001',
              qty: 1,
              price: 0,
              discount: 0,
              gst: 18,
            },
          ],
          status: 'draft',
        });

      expect(quoteRes.statusCode).toBe(201);
      const quotationId = quoteRes.body.data._id;

      // Edit only quantity
      let updateRes = await request(app)
        .put(`/api/quotations/${quotationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            {
              productName: 'Indep Product',
              sku: 'INDEP-EDIT-001',
              qty: 3,
              price: 0,
              discount: 0,
              gst: 18,
            },
          ],
        });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.data.items[0].qty).toBe(3);
      expect(updateRes.body.data.items[0].price).toBe(8000);

      // Edit only discount
      updateRes = await request(app)
        .put(`/api/quotations/${quotationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            {
              productName: 'Indep Product',
              sku: 'INDEP-EDIT-001',
              qty: 3,
              price: 0,
              discount: 10,
              gst: 18,
            },
          ],
        });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.data.items[0].discount).toBe(10);

      // Edit only GST
      updateRes = await request(app)
        .put(`/api/quotations/${quotationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            {
              productName: 'Indep Product',
              sku: 'INDEP-EDIT-001',
              qty: 3,
              price: 0,
              discount: 10,
              gst: 5,
            },
          ],
        });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.data.items[0].gst).toBe(5);
    });
  });

  // ===========================================
  // 7. Quotation SKU Resolution Returns Product Details
  // ===========================================
  describe('Quotation SKU Resolution Returns Product Details', () => {
    it('should return product ID, name, SKU, price, discount when SKU is entered in quotation', async () => {
      await Product.create({
        name: 'Quotation SKU Detail Product',
        category: 'Rings',
        subcategory: 'Engagement Rings',
        metal: 'Gold',
        purity: '14K',
        weight: '2.5g',
        diamondWeight: '1.0ct',
        diamondShape: 'Round',
        diamondClarity: 'VS1',
        diamondColor: 'G',
        sku: 'QSKU-DETAIL-001',
        price: 10000,
        discountPrice: 8000,
        stock: 10,
        status: 'active',
        images: [{ url: 'https://example.com/qsku.jpg', alt: '', order: 0 }],
      });

      const res = await request(app)
        .post('/api/quotations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: { name: 'SKU Detail Customer', email: 'skudetail@test.com', phone: '+91 99999 99999', address: 'Test Addr' },
          validUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
          items: [
            {
              productName: 'Placeholder Name',
              sku: 'QSKU-DETAIL-001',
              qty: 1,
              price: 0,
              discount: 0,
              gst: 18,
            },
          ],
          status: 'draft',
        });

      expect(res.statusCode).toBe(201);
      const item = res.body.data.items[0];
      expect(item.product).toBeTruthy();
      expect(item.product._id).toBeTruthy();
      expect(item.product.name).toBe('Quotation SKU Detail Product');
      expect(item.product.sku).toBe('QSKU-DETAIL-001');
      expect(item.product.price).toBe(10000);
      expect(item.product.discountPrice).toBe(8000);
      expect(item.price).toBe(8000);
    });
  });
});
