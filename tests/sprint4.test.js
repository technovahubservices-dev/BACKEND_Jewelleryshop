const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const StoreSetting = require('../models/StoreSetting');
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

const adminLogin = async (app, email, pass) => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: pass });
  return res.body.token;
};

const createProductViaAPI = async (app, token, data) => {
  const res = await request(app)
    .post('/api/products')
    .set('Authorization', `Bearer ${token}`)
    .field('name', data.name)
    .field('sku', data.sku)
    .field('category', data.category)
    .field('metal', data.metal)
    .field('price', String(data.price))
    .field('stock', String(data.stock))
    .field('status', data.status || 'active');

  if (data.discountPrice !== undefined && data.discountPrice !== null) {
    res.field('discountPrice', String(data.discountPrice));
  }
  if (data.subcategory) res.field('subcategory', data.subcategory);
  if (data.jewelleryCollection) res.field('jewelleryCollection', data.jewelleryCollection);
  if (data.occasion) res.field('occasion', data.occasion);
  if (data.purity) res.field('purity', data.purity);
  if (data.tags) res.field('tags', data.tags);
  res.field('imageUrls', data.imageUrls || 'https://example.com/test.jpg');

  return res;
};

describe('Sprint 4: Discount Calculation & Price Fields', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_discount_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await StoreSetting.deleteMany({});
    await close();
  });

  it('normal product should return computed price fields', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Normal Ring')
      .field('sku', 'NORM-RNG-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '10000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/normal.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.data.originalPrice).toBe(10000);
    expect(res.body.data.sellingPrice).toBe(10000);
    expect(res.body.data.discountAmount).toBe(0);
    expect(res.body.data.discountPercentage).toBe(0);
    expect(res.body.data.hasDiscount).toBe(false);
  });

  it('discounted product should compute correct discount fields', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Discounted Ring')
      .field('sku', 'DISC-RNG-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '20000')
      .field('discountPrice', '15000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/discount.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.data.originalPrice).toBe(20000);
    expect(res.body.data.sellingPrice).toBe(15000);
    expect(res.body.data.discountAmount).toBe(5000);
    expect(res.body.data.discountPercentage).toBe(25);
    expect(res.body.data.hasDiscount).toBe(true);
  });

  it('should reject negative discount price', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Negative Discount')
      .field('sku', 'NEG-DISC-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '10000')
      .field('discountPrice', '-100')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/neg.jpg');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Discount price cannot be negative/);
  });

  it('should reject discount price >= regular price', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Bad Discount')
      .field('sku', 'BAD-DISC-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('discountPrice', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/bad.jpg');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('existing products without new fields still work', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ sku: 'NORM-RNG-001' });

    expect(res.statusCode).toBe(200);
    const product = res.body.data.find((p) => p.sku === 'NORM-RNG-001');
    expect(product).toBeDefined();
    expect(product.originalPrice).toBeDefined();
    expect(product.sellingPrice).toBeDefined();
    expect(product.hasDiscount).toBe(false);
  });
});

describe('Sprint 4: Occasion & Bridal/Wedding Tags', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_occasion_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('should create product with occasion', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Bridal Ring')
      .field('sku', 'BRIDAL-RNG-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '30000')
      .field('stock', '5')
      .field('status', 'active')
      .field('occasion', 'Bridal')
      .field('jewelleryCollection', 'Bridal')
      .field('imageUrls', 'https://example.com/bridal.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.data.occasion).toBe('Bridal');
    expect(res.body.data.jewelleryCollection).toBe('Bridal');
  });

  it('should create product with Wedding occasion', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Wedding Band')
      .field('sku', 'WEDDING-BND-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '12000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'Wedding')
      .field('jewelleryCollection', 'Wedding')
      .field('imageUrls', 'https://example.com/wedding.jpg');

    expect(res.statusCode).toBe(201);
    expect(res.body.data.occasion).toBe('Wedding');
  });

  it('should reject invalid occasion', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Bad Occasion')
      .field('sku', 'BAD-OCC-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'InvalidOccasion')
      .field('imageUrls', 'https://example.com/bad.jpg');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject invalid collection', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Bad Collection')
      .field('sku', 'BAD-COL-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('jewelleryCollection', 'InvalidCollection')
      .field('imageUrls', 'https://example.com/bad.jpg');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Sprint 4: Collection Filtering', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_colfilter_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Heritage Earrings')
      .field('sku', 'COL-HER-001')
      .field('category', 'Earrings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'Festive')
      .field('jewelleryCollection', 'Heritage')
      .field('imageUrls', 'https://example.com/heritage.jpg');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Eternal Necklace')
      .field('sku', 'COL-ETE-001')
      .field('category', 'Necklaces')
      .field('metal', 'Silver')
      .field('price', '8000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'Anniversary')
      .field('jewelleryCollection', 'Eternal')
      .field('imageUrls', 'https://example.com/eternal.jpg');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('should filter products by collection', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ collection: 'Heritage' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.jewelleryCollection === 'Heritage')).toBe(true);
  });

  it('should filter products by jewelleryCollection param', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ jewelleryCollection: 'Eternal' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.jewelleryCollection === 'Eternal')).toBe(true);
  });

  it('should return empty when collection does not match', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ collection: 'NonExistent' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});

describe('Sprint 4: Category Filtering', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_catfilter_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Gold Ring A')
      .field('sku', 'CAT-RNG-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '10000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/ringa.jpg');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Silver Earrings B')
      .field('sku', 'CAT-ERG-001')
      .field('category', 'Earrings')
      .field('metal', 'Silver')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/earb.jpg');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('should filter products by category', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ category: 'Rings' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.category === 'Rings')).toBe(true);
  });

  it('should filter products by category case-insensitive', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ category: 'rings' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter by non-existent category', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ category: 'NonExistent' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});

describe('Sprint 4: Occasion Filtering', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_occfilter_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Bridal Bangles')
      .field('sku', 'OCC-BRG-BNG-001')
      .field('category', 'Bangles')
      .field('metal', 'Gold')
      .field('price', '15000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'Bridal')
      .field('jewelleryCollection', 'Bridal')
      .field('imageUrls', 'https://example.com/bridal-bangle.jpg');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Party Earrings')
      .field('sku', 'OCC-PARTY-ERG-001')
      .field('category', 'Earrings')
      .field('metal', 'Silver')
      .field('price', '3000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'Party')
      .field('imageUrls', 'https://example.com/party-earrings.jpg');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('should filter products by occasion Bridal', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ occasion: 'Bridal' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.occasion === 'Bridal')).toBe(true);
  });

  it('should filter products by occasion Wedding', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ occasion: 'Wedding' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(0);
    res.body.data.forEach((p) => {
      expect(p.occasion).toBe('Wedding');
    });
  });

  it('should filter products by bridal=true (shorthand)', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ bridal: 'true' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.occasion === 'Bridal')).toBe(true);
  });

  it('should filter products by wedding=true (shorthand)', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ wedding: 'true' });

    expect(res.statusCode).toBe(200);
    res.body.data.forEach((p) => {
      expect(p.occasion).toBe('Wedding');
    });
  });
});

describe('Sprint 4: Combined Filters', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_combined_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Bridal Gold Bangle')
      .field('sku', 'COM-BRIDAL-BNG-001')
      .field('category', 'Bangles')
      .field('metal', 'Gold')
      .field('price', '20000')
      .field('discountPrice', '15000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'Bridal')
      .field('jewelleryCollection', 'Bridal')
      .field('purity', '22K')
      .field('imageUrls', 'https://example.com/com-bridal-bangle.jpg');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Wedding Gold Band')
      .field('sku', 'COM-WEDDING-RNG-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '12000')
      .field('stock', '0')
      .field('status', 'active')
      .field('occasion', 'Wedding')
      .field('jewelleryCollection', 'Wedding')
      .field('purity', '14K')
      .field('imageUrls', 'https://example.com/com-wedding-band.jpg');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Festive Silver Earrings')
      .field('sku', 'COM-FESTIVE-ERG-001')
      .field('category', 'Earrings')
      .field('metal', 'Silver')
      .field('price', '4000')
      .field('stock', '10')
      .field('status', 'active')
      .field('occasion', 'Festive')
      .field('jewelleryCollection', 'Occasion')
      .field('purity', 'Sterling Silver')
      .field('imageUrls', 'https://example.com/com-festive-earrings.jpg');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('Bridal + Bangles should filter correctly', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ bridal: 'true', category: 'Bangles' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.occasion === 'Bridal' && p.category === 'Bangles')).toBe(true);
  });

  it('Wedding + Gold should filter correctly', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ wedding: 'true', metal: 'Gold' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.occasion === 'Wedding' && p.metal === 'Gold')).toBe(true);
  });

  it('Occasion + discount should filter correctly', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ collection: 'Bridal', discount: 'onsale' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.hasDiscount === true)).toBe(true);
  });

  it('Collection + category combined filter', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ collection: 'Bridal', category: 'Bangles' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.jewelleryCollection === 'Bridal' && p.category === 'Bangles')).toBe(true);
  });

  it('availability out-of-stock should filter correctly', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ availability: 'out-of-stock' });

    expect(res.statusCode).toBe(200);
    res.body.data.forEach((p) => {
      expect(p.stock).toBeLessThanOrEqual(0);
    });
  });

  it('availability in-stock should filter correctly', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ availability: 'in-stock' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.stock > 0)).toBe(true);
  });
});

describe('Sprint 4: Discount Filter Levels', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_discfilter_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', '25% Off Ring')
      .field('sku', 'DISC-25-RNG-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '20000')
      .field('discountPrice', '15000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/25off.jpg');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', '50% Off Earrings')
      .field('sku', 'DISC-50-ERG-001')
      .field('category', 'Earrings')
      .field('metal', 'Silver')
      .field('price', '10000')
      .field('discountPrice', '5000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/50off.jpg');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'No Discount Bangle')
      .field('sku', 'DISC-NONE-BNG-001')
      .field('category', 'Bangles')
      .field('metal', 'Gold')
      .field('price', '8000')
      .field('stock', '10')
      .field('status', 'active')
      .field('imageUrls', 'https://example.com/nodisc.jpg');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('should filter "all" discount (default behavior)', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ discount: 'all' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('should filter "onsale" (products with discount)', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ discount: 'onsale' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.every((p) => p.hasDiscount === true)).toBe(true);
  });

  it('should filter "none" (products without discount)', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ discount: 'none' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.hasDiscount === false)).toBe(true);
  });

  it('should filter "10+" (10% or more discount)', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ discount: '10+' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.every((p) => p.discountPercentage >= 10)).toBe(true);
  });

  it('should filter "50+" (50% or more discount)', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ discount: '50+' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((p) => p.discountPercentage >= 50)).toBe(true);
  });
});

describe('Sprint 4: Product Response Fields', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_resp_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');

    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Full Field Ring')
      .field('sku', 'FULL-RNG-001')
      .field('category', 'Rings')
      .field('subcategory', 'Engagement Rings')
      .field('metal', 'White Gold')
      .field('purity', '18K')
      .field('price', '30000')
      .field('discountPrice', '25000')
      .field('stock', '10')
      .field('status', 'active')
      .field('jewelleryCollection', 'Eternal')
      .field('occasion', 'Engagement')
      .field('imageUrls', 'https://example.com/full.jpg');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('should return all required product response fields', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ sku: 'FULL-RNG-001' });

    expect(res.statusCode).toBe(200);
    const product = res.body.data.find((p) => p.sku === 'FULL-RNG-001');
    expect(product).toBeDefined();

    expect(product).toHaveProperty('_id');
    expect(product).toHaveProperty('name');
    expect(product).toHaveProperty('sku');
    expect(product).toHaveProperty('category');
    expect(product).toHaveProperty('subcategory');
    expect(product).toHaveProperty('jewelleryCollection');
    expect(product).toHaveProperty('occasion');
    expect(product).toHaveProperty('price');
    expect(product).toHaveProperty('discountPrice');
    expect(product).toHaveProperty('originalPrice');
    expect(product).toHaveProperty('sellingPrice');
    expect(product).toHaveProperty('discountAmount');
    expect(product).toHaveProperty('discountPercentage');
    expect(product).toHaveProperty('hasDiscount');
    expect(product).toHaveProperty('images');
    expect(product).toHaveProperty('primaryImage');
    expect(product).toHaveProperty('status');

    const singleRes = await request(app).get(`/api/products/${product._id}`);
    expect(singleRes.statusCode).toBe(200);
    const singleProduct = singleRes.body.data;
    expect(singleProduct).toHaveProperty('originalPrice');
    expect(singleProduct).toHaveProperty('sellingPrice');
    expect(singleProduct).toHaveProperty('discountAmount');
    expect(singleProduct).toHaveProperty('discountPercentage');
    expect(singleProduct).toHaveProperty('hasDiscount');
  });
});

describe('Sprint 4: Public Policy API', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_policy_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');
  });

  afterAll(async () => {
    await StoreSetting.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('should set policies via admin endpoint', async () => {
    const policies = [
      {
        type: 'authenticity',
        title: '100% Authentic Jewellery',
        description: 'All our jewellery comes with a certificate of authenticity.',
        icon: 'shield-check',
        isActive: true,
      },
      {
        type: 'returns',
        title: '30-Day Returns',
        description: 'Free returns within 30 days of purchase.',
        icon: 'return',
        isActive: true,
      },
      {
        type: 'purity',
        title: 'Gold Purity Guarantee',
        description: 'We use 100% pure gold with certified purity.',
        icon: 'gold',
        isActive: true,
      },
    ];

    const res = await request(app)
      .put('/api/store')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: 'JKR Jewellery',
        currency: 'INR',
        policies,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.policies.length).toBe(3);
    expect(res.body.data.policies[0].type).toBe('authenticity');
  });

  it('should reject invalid policy type', async () => {
    const res = await request(app)
      .put('/api/store')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        policies: [
          {
            type: 'invalid_type',
            title: 'Invalid Policy',
            description: 'This should fail',
          },
        ],
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return active policies via public endpoint', async () => {
    const res = await request(app)
      .get('/api/store/public');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('storeName');
    expect(res.body.data).toHaveProperty('policies');
    expect(Array.isArray(res.body.data.policies)).toBe(true);
    expect(res.body.data.policies.length).toBe(3);
    expect(res.body.data.policies.every((p) => p.type && p.title && p.description)).toBe(true);
  });

  it('should return all required policy fields in public response', async () => {
    const res = await request(app)
      .get('/api/store/public');

    expect(res.statusCode).toBe(200);
    const policy = res.body.data.policies[0];
    expect(policy).toHaveProperty('type');
    expect(policy).toHaveProperty('title');
    expect(policy).toHaveProperty('description');
    expect(policy).toHaveProperty('icon');
  });

  it('public endpoint should not require auth', async () => {
    const res = await request(app)
      .get('/api/store/public');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('admin endpoint should require auth', async () => {
    const res = await request(app)
      .put('/api/store')
      .send({ storeName: 'Hacked Store' });

    expect(res.statusCode).toBe(401);
  });
});

describe('Sprint 4: Inactive Collection Excluded from Public', () => {
  let adminToken;

  beforeAll(async () => {
    await connect();
    const admin = await createAdminUser(`admin_inactive_${Date.now()}@test.com`, 'admin123');
    adminToken = await adminLogin(app, admin.email, 'admin123');
  });

  afterAll(async () => {
    await Product.deleteMany({});
    await User.deleteMany({});
    await close();
  });

  it('inactive products should not appear in public listing', async () => {
    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Inactive Product')
      .field('sku', 'INACT-001')
      .field('category', 'Rings')
      .field('metal', 'Gold')
      .field('price', '5000')
      .field('stock', '10')
      .field('status', 'inactive')
      .field('imageUrls', 'https://example.com/inactive.jpg');

    const res = await request(app)
      .get('/api/products');

    expect(res.statusCode).toBe(200);
    const found = res.body.data.find((p) => p.sku === 'INACT-001');
    expect(found).toBeUndefined();
  });
});
