const request = require('supertest');
const mongoose = require('mongoose');
const path = require('path');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const bcrypt = require('bcryptjs');

jest.mock('../utils/googleDrive', () => ({
  uploadFile: jest.fn(),
  deleteFile: jest.fn().mockResolvedValue(true),
  getFileUrl: jest.fn(),
  isDriveUrl: jest.fn().mockReturnValue(false),
  isDriveFileId: jest.fn().mockReturnValue(false),
}));

const googleDrive = require('../utils/googleDrive');

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

const loginAdmin = async (app) => {
  const admin = await createAdminUser(`admin_${Date.now()}@test.com`, 'admin123');
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: admin.email, password: 'admin123' });
  return loginRes.body.token;
};

describe('Product CRUD', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;
  let createdProductId;

  const productData = {
    name: 'Test Gold Ring',
    sku: 'GOLD-RNG-001',
    category: 'Rings',
    metal: 'Gold',
    price: 25000,
    stock: 10,
    status: 'active',
  };

  beforeAll(async () => {
    adminToken = await loginAdmin(app);
  });

  beforeEach(() => {
    let mockCounter = 0;
    googleDrive.uploadFile.mockImplementation((buffer, originalName, mimetype) => {
      mockCounter += 1;
      return Promise.resolve({
        fileId: `mock-file-id-${mockCounter}`,
        fileName: originalName,
        url: `https://drive.google.com/uc?export=view&id=mock-file-id-${mockCounter}`,
        driveUrl: `https://drive.google.com/file/d/mock-file-id-${mockCounter}`,
      });
    });
  });

  it('should create a product', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', productData.name)
      .field('sku', productData.sku)
      .field('category', productData.category)
      .field('metal', productData.metal)
      .field('price', String(productData.price))
      .field('stock', String(productData.stock))
      .field('status', productData.status)
      .field('imageUrls', 'https://example.com/image.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(productData.name);
    createdProductId = res.body.data._id;
  });

  it('should get all products', async () => {
    const res = await request(app)
      .get('/api/products');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should get single product by id', async () => {
    const res = await request(app)
      .get(`/api/products/${createdProductId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data._id).toBe(createdProductId);
  });

  it('should update product', async () => {
    const res = await request(app)
      .put(`/api/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('price', '26000');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.price).toBe(26000);
  });

  it('should delete product', async () => {
    const res = await request(app)
      .delete(`/api/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Product Creation - Subcategory Validation', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    adminToken = await loginAdmin(app);
  });

  beforeEach(() => {
    let mockCounter = 0;
    googleDrive.uploadFile.mockImplementation((buffer, originalName, mimetype) => {
      mockCounter += 1;
      return Promise.resolve({
        fileId: `mock-file-id-${mockCounter}`,
        fileName: originalName,
        url: `https://drive.google.com/uc?export=view&id=mock-file-id-${mockCounter}`,
        driveUrl: `https://drive.google.com/file/d/mock-file-id-${mockCounter}`,
      });
    });
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  it('should create a product with image URL and valid subcategory Wedding Bands', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Wedding Band Set')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '15000')
      .field('stock', '20')
      .field('subcategory', 'Wedding Bands')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/wedding-band.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subcategory).toBe('Wedding Bands');
    expect(res.body.data.images).toContain('https://example.com/wedding-band.jpg');
    expect(res.body.data.primaryImage).toBe('https://example.com/wedding-band.jpg');
  });

  it('should create a product with uploaded image and valid subcategory', async () => {
    const imagePath = path.join(__dirname, '..', 'test-image.jpg');

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Engagement Ring')
      .field('category', 'Rings')
      .field('metal', 'Platinum')
      .field('price', '30000')
      .field('stock', '10')
      .field('subcategory', 'Engagement Rings')
      .field('status', 'active')
      .field('imageUrls', '[]')
      .attach('images', imagePath, 'test-image.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subcategory).toBe('Engagement Rings');
    expect(res.body.data.images.length).toBeGreaterThan(0);
    expect(res.body.data.images.some((img) =>
      img.includes('drive.google.com')
    )).toBe(true);
    expect(res.body.data.primaryImage).toBe(res.body.data.images[0]);
  });

  it('should create a product with uploaded image (fallback path) and valid subcategory', async () => {
    googleDrive.uploadFile.mockRejectedValue(new Error('Drive upload failed'));

    const imagePath = path.join(__dirname, '..', 'test-image.jpg');

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Fallback Ring')
      .field('category', 'Rings')
      .field('metal', 'Silver')
      .field('price', '8000')
      .field('stock', '5')
      .field('subcategory', 'Promise Rings')
      .field('status', 'active')
      .field('imageUrls', '[]')
      .attach('images', imagePath, 'test-image.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.images.length).toBeGreaterThan(0);
    expect(res.body.data.images.some((img) => img.startsWith('/uploads/'))).toBe(true);
    expect(res.body.data.primaryImage).toBe(res.body.data.images[0]);
  });

  it('should create a product with image URL only (no uploaded file)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Necklace Set')
      .field('category', 'Necklaces')
      .field('metal', 'Gold')
      .field('price', '12000')
      .field('stock', '15')
      .field('subcategory', 'Diamond Necklaces')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/necklace.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.images).toContain('https://example.com/necklace.jpg');
    expect(res.body.data.primaryImage).toBe('https://example.com/necklace.jpg');
  });

  it('should create a product without subcategory (optional field)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'No Subcategory Ring')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '5')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/no-subcat.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subcategory).toBeUndefined();
  });

  it('should return 400 when no image is provided', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'No Image Ring')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '5')
      .field('subcategory', 'Engagement Rings')
      .field('status', 'active')
      .field('imageUrls', '[]');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message.toLowerCase()).toContain('image');
  });

  it('should return 400 for invalid "wedding" subcategory with clear message', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Wedding Ring Invalid')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '10000')
      .field('stock', '10')
      .field('subcategory', 'wedding')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/ring.jpg');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Invalid subcategory');
    expect(res.body.message).toContain('Wedding Bands');
  });

  it('should return 400 for other invalid subcategories with clear message', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Invalid Subcat Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '10000')
      .field('stock', '10')
      .field('subcategory', 'NotAValidSubcategory')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/ring.jpg');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Invalid subcategory');
    expect(res.body.message).toContain('NotAValidSubcategory');
  });

  it('should create products with all existing valid subcategories', async () => {
    const validSubcategories = [
      'Engagement Rings',
      'Wedding Bands',
      'Cocktail Rings',
      'Promise Rings',
      'Diamond Necklaces',
      'Gold Chains',
      'Pendant Sets',
      'Diamond Earrings',
      'Gold Earrings',
      'Hoop Earrings',
      'Stud Earrings',
      'Bracelets',
      'Bangles',
      'Cuffs',
      'Chain Bracelets',
    ];

    for (const sub of validSubcategories) {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', `Test Product ${sub}`)
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '1000')
        .field('stock', '1')
        .field('subcategory', sub)
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/test.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.subcategory).toBe(sub);
      expect(res.body.data.images).toContain('https://example.com/test.jpg');
      expect(res.body.data.primaryImage).toBe('https://example.com/test.jpg');
    }
  });

  it('should create a product with multiple image URLs', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Multi Image Ring')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '7000')
      .field('stock', '10')
      .field('subcategory', 'Cocktail Rings')
      .field('status', 'active')
      .field('imageUrls', JSON.stringify([
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg',
        'https://example.com/img3.jpg',
      ]));

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.images).toContain('https://example.com/img1.jpg');
    expect(res.body.data.images).toContain('https://example.com/img2.jpg');
    expect(res.body.data.images).toContain('https://example.com/img3.jpg');
    expect(res.body.data.primaryImage).toBe('https://example.com/img1.jpg');
  });
});

describe('SKU Auto-Generation', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    adminToken = await loginAdmin(app);
  });

  beforeEach(() => {
    let mockCounter = 0;
    googleDrive.uploadFile.mockImplementation((buffer, originalName, mimetype) => {
      mockCounter += 1;
      return Promise.resolve({
        fileId: `mock-file-id-${mockCounter}`,
        fileName: originalName,
        url: `https://drive.google.com/uc?export=view&id=mock-file-id-${mockCounter}`,
        driveUrl: `https://drive.google.com/file/d/mock-file-id-${mockCounter}`,
      });
    });
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  it('should auto-generate a unique SKU ignoring frontend-provided SKU value', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Auto Gen Ring')
      .field('sku', 'FRONTEND-SKU-999')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/ring.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sku).toMatch(/^GOLD-RNG-\d{3}$/);
    expect(res.body.data.sku).not.toBe('FRONTEND-SKU-999');
  });

  it('should generate unique SKUs for products with same metal and category', async () => {
    const res1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Diamond Ring A')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/ring1.jpg');

    const res2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Diamond Ring B')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/ring2.jpg');

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    expect(res1.body.data.sku).toMatch(/^GOLD-RNG-\d{3}$/);
    expect(res2.body.data.sku).toMatch(/^GOLD-RNG-\d{3}$/);
    expect(res1.body.data.sku).not.toBe(res2.body.data.sku);
  });

  it('should generate sequential SKU numbers for same product type', async () => {
    const res1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Sequential Ring 1')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/seq1.jpg');

    const res2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Sequential Ring 2')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/seq2.jpg');

    const res3 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Sequential Ring 3')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/seq3.jpg');

    expect(res1.body.data.sku).toBe('GOLD-RNG-001');
    expect(res2.body.data.sku).toBe('GOLD-RNG-002');
    expect(res3.body.data.sku).toBe('GOLD-RNG-003');
  });

  it('should generate SKU with correct format based on metal and category', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Platinum Necklace')
      .field('category', 'Necklaces')
      .field('metal', 'Platinum')
      .field('price', '15000')
      .field('stock', '5')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/necklace.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.data.sku).toMatch(/^PLAT-NEC-\d{3}$/);
  });

  it('should use default metal code when metal is not specified', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Default Metal Ring')
      .field('category', 'Rings')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/default.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.data.sku).toMatch(/^GOLD-RNG-\d{3}$/);
  });
});

describe('SKU Uniqueness and Editability', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  beforeAll(async () => {
    adminToken = await loginAdmin(app);
  });

  beforeEach(() => {
    let mockCounter = 0;
    googleDrive.uploadFile.mockImplementation((buffer, originalName, mimetype) => {
      mockCounter += 1;
      return Promise.resolve({
        fileId: `mock-file-id-${mockCounter}`,
        fileName: originalName,
        url: `https://drive.google.com/uc?export=view&id=mock-file-id-${mockCounter}`,
        driveUrl: `https://drive.google.com/file/d/mock-file-id-${mockCounter}`,
      });
    });
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  it('should create product with unique auto-generated SKU', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Unique SKU Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/unique.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.data.sku).toMatch(/^GOLD-RNG-\d{3}$/);

    const product = await Product.findById(res.body.data._id);
    expect(product.sku).toBe(res.body.data.sku);
  });

  it('should create another product with a different SKU', async () => {
    const res1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'First Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/first.jpg');

    const res2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Second Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/second.jpg');

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.body.data.sku).not.toBe(res2.body.data.sku);
  });

  it('should reject duplicate SKU when explicitly provided', async () => {
    const res1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Base Product For SKU Test')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/base.jpg');

    expect(res1.statusCode).toBe(201);
    const existingSku = res1.body.data.sku;
    const productId = res1.body.data._id;

    const res2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Explicit Duplicate SKU')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('sku', existingSku)
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/explicit.jpg');

    expect(res2.statusCode).toBe(201);
    expect(res2.body.data.sku).not.toBe(existingSku);
    expect(res2.body.data.sku).toMatch(/^GOLD-RNG-\d{3}$/);
  });

  it('should allow edit without changing SKU', async () => {
    const createRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Editable Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/edit.jpg');

    expect(createRes.statusCode).toBe(201);
    const originalSku = createRes.body.data.sku;
    const productId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('price', '6000')
      .field('imageUrls', JSON.stringify([
        'https://example.com/edit.jpg',
      ]));

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.body.data.sku).toBe(originalSku);
    expect(updateRes.body.data.price).toBe(6000);
  });

  it('should allow edit with new unused SKU', async () => {
    const createRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'SKU Change Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/change.jpg');

    expect(createRes.statusCode).toBe(201);
    const productId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('sku', 'NEW-UNIQUE-SKU-001')
      .field('imageUrls', JSON.stringify([
        'https://example.com/change.jpg',
      ]));

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.body.data.sku).toBe('NEW-UNIQUE-SKU-001');
  });

  it('should reject edit with another product SKU', async () => {
    const res1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Product A')
      .field('category', 'Rings')
      .field('metal', 'Silver')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/productA.jpg');

    const res2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Product B')
      .field('category', 'Rings')
      .field('metal', 'Silver')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/productB.jpg');

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    const skuB = res2.body.data.sku;
    const productAId = res1.body.data._id;

    const updateRes = await request(app)
      .put(`/api/products/${productAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('sku', skuB)
      .field('imageUrls', JSON.stringify([
        'https://example.com/productA.jpg',
      ]));

    expect(updateRes.statusCode).toBe(400);
    expect(updateRes.body.success).toBe(false);
    expect(updateRes.body.message).toContain('SKU already exists');
  });

  it('should allow duplicate product names with different SKUs', async () => {
    const res1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Same Name Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/same1.jpg');

    const res2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Same Name Product')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '6000')
      .field('stock', '15')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/same2.jpg');

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.body.data.name).toBe('Same Name Product');
    expect(res2.body.data.name).toBe('Same Name Product');
    expect(res1.body.data.sku).not.toBe(res2.body.data.sku);
  });
});
