const request = require('supertest');
const { app } = require('../server');
const { connect, close } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const HomepageSetting = require('../models/HomepageSetting');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

jest.mock('../utils/googleDriveStorage', () => {
  const actual = jest.requireActual('../utils/googleDriveStorage');
  return {
    ...actual,
    uploadRequestFileToGoogleDrive: jest.fn(async (req) => {
      if (!req.file) return null;
      const isVideo = req.file.mimetype && req.file.mimetype.startsWith('video/');
      const id = 'mock-drive-id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
      const proxyUrl = '/api/upload/drive/' + id;
      return {
        id,
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        url: proxyUrl,
        viewUrl: proxyUrl,
        publicDriveUrl: isVideo
          ? 'https://drive.google.com/file/d/' + id + '/preview'
          : 'https://drive.google.com/thumbnail?id=' + id + '&sz=w2000',
        previewUrl: isVideo ? 'https://drive.google.com/file/d/' + id + '/preview' : null,
        mediaType: isVideo ? 'video' : 'image',
        publicUrl: proxyUrl,
        uploadedAt: new Date().toISOString(),
      };
    }),
    uploadRequestFilesToGoogleDrive: jest.fn(async () => []),
    deleteDriveFilesForUrls: jest.fn(async () => {}),
  };
});

const GOOGLE_DRIVE_ID = '1abc123thumb';
const GOOGLE_DRIVE_URL = `https://drive.google.com/thumbnail?id=${GOOGLE_DRIVE_ID}&sz=w2000`;
const PROXY_URL = `/api/upload/drive/${GOOGLE_DRIVE_ID}`;

const smallMp4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAAACGlzb21tYQAAAAAAAAAAGxpaWJhdmkyN2MGBX0AAAEKAAAA' +
  'Zmlyc3Q7ZGF0YT4K',
  'base64'
);

const smallPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('CMS Homepage Settings — Announcement, Hero, Category, Video, Festive', () => {
  let adminToken;
  let adminUser;
  let createdCategories = [];
  let createdProducts = [];

  beforeAll(connect);
  afterAll(close);

  beforeAll(async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);
    adminUser = await User.create({
      name: 'Admin',
      email: `cms_homepage_${Date.now()}@test.com`,
      password: hashedPassword,
      isAdmin: true,
    });
    adminToken = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await HomepageSetting.deleteMany({});
    if (createdCategories.length) {
      await Category.deleteMany({ _id: { $in: createdCategories } });
      createdCategories = [];
    }
    if (createdProducts.length) {
      await Product.deleteMany({ _id: { $in: createdProducts } });
      createdProducts = [];
    }
  });

  const createCategory = async (name, slug) => {
    const cat = await Category.create({ name, slug, isActive: true });
    createdCategories.push(cat._id);
    return cat;
  };

  const createProduct = async (sku, category) => {
    const prod = await Product.create({
      name: `Product ${sku}`,
      sku,
      category,
      price: 1000,
      discountPrice: 800,
      stock: 10,
      images: ['https://example.com/img.jpg'],
      primaryImage: 'https://example.com/img.jpg',
      status: 'active',
    });
    createdProducts.push(prod._id);
    return prod;
  };

  // ──────────────────────────────────────────────────────────
  // 1. ANNOUNCEMENT BAR — Without CTA fields
  // ──────────────────────────────────────────────────────────
  describe('1. Announcement Bar — CTA fields optional', () => {
    it('should accept announcement without ctaText and ctaLink', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          announcementText: 'Free shipping on orders over $100',
          announcementActive: true,
          announcementBgColor: '#ff0000',
          announcementTextColor: '#ffffff',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.announcementText).toBe('Free shipping on orders over $100');
    });

    it('should return announcement bar via public API without CTA fields', async () => {
      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          announcementText: 'Sale is on!',
          announcementActive: true,
        });

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.announcementText).toBe('Sale is on!');
      expect(res.body.data.announcementActive).toBe(true);
    });

    it('should preserve legacy announcement with CTA fields', async () => {
      await HomepageSetting.updateOne(
        {},
        {
          $set: {
            announcementText: 'Legacy announcement',
            announcementActive: true,
            announcementCtaText: 'Shop Now',
            announcementCtaLink: '/shop/sale',
          },
        },
        { upsert: true }
      );

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.announcementText).toBe('Legacy announcement');
      expect(res.body.data.announcementCtaText).toBe('Shop Now');
      expect(res.body.data.announcementCtaLink).toBe('/shop/sale');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 2. HERO SLIDER — Image without title/subtitle/link
  // ──────────────────────────────────────────────────────────
  describe('2. Hero Slider — image-only slides', () => {
    it('should create hero slide with only image (no title/subtitle/link)', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSlides: [
            { image: GOOGLE_DRIVE_URL, isActive: true, sortOrder: 0 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.heroSlides).toHaveLength(1);
      expect(res.body.data.heroSlides[0].image).toBe(PROXY_URL);
    });

    it('should handle hero slide update preserving image', async () => {
      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSlides: [
            { image: GOOGLE_DRIVE_URL, isActive: true, sortOrder: 0 },
          ],
        });

      const updateRes = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSlides: [
            { image: GOOGLE_DRIVE_URL, isActive: true, sortOrder: 0 },
          ],
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.heroSlides[0].image).toBe(PROXY_URL);
    });

    it('should accept hero slide with full legacy data', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSlides: [
            {
              title: 'Welcome',
              subtitle: 'Shop now',
              image: GOOGLE_DRIVE_URL,
              link: '/shop',
              isActive: true,
              sortOrder: 0,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.heroSlides[0].title).toBe('Welcome');
      expect(res.body.data.heroSlides[0].image).toBe(PROXY_URL);
      expect(res.body.data.heroSlides[0].link).toBe('/shop');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 3. CATEGORY NAVIGATION — categoryId reference
  // ──────────────────────────────────────────────────────────
  describe('3. Category Navigation — category reference', () => {
    it('should save categories with categoryId and return resolved slug', async () => {
      const cat = await createCategory('Rings', 'rings');

      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categories: [
            {
              name: 'Rings',
              image: GOOGLE_DRIVE_URL,
              categoryId: String(cat._id),
              sortOrder: 0,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.categories).toHaveLength(1);
      expect(res.body.data.categories[0].categoryId).toBeTruthy();
    });

    it('should resolve category slug in public API response', async () => {
      const cat = await createCategory('Earrings', 'earrings');

      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categories: [
            {
              name: 'Earrings',
              image: GOOGLE_DRIVE_URL,
              categoryId: String(cat._id),
              sortOrder: 0,
            },
          ],
        });

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.categories[0].categorySlug).toBe('earrings');
      expect(res.body.data.categories[0].categoryName).toBe('Earrings');
    });

    it('should reject invalid categoryId', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categories: [
            {
              name: 'Invalid',
              image: GOOGLE_DRIVE_URL,
              categoryId: '000000000000000000000000',
              sortOrder: 0,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Category not found');
    });

    it('should accept categories without categoryId (backward compat)', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categories: [
            {
              name: 'Rings',
              image: GOOGLE_DRIVE_URL,
              link: '/shop?category=rings',
              sortOrder: 0,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.categories[0].name).toBe('Rings');
      expect(res.body.data.categories[0].link).toBe('/shop?category=rings');
    });

    it('should support category via updateHomepageTab', async () => {
      const cat = await createCategory('Necklaces', 'necklaces');

      const res = await request(app)
        .put('/api/content/homepage/settings/updateTab')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tab: 'categories',
          payload: {
            categories: [
              {
                name: 'Necklaces',
                image: GOOGLE_DRIVE_URL,
                categoryId: String(cat._id),
                sortOrder: 0,
              },
            ],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.categories).toHaveLength(1);
    });

    it('should return categorySlug usable for product filtering', async () => {
      const cat = await createCategory('Bracelets', 'bracelets');
      const product = await createProduct('BRACELET-001', 'Bracelets');

      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categories: [
            {
              name: 'Bracelets',
              image: GOOGLE_DRIVE_URL,
              categoryId: String(cat._id),
              sortOrder: 0,
            },
          ],
        });

      const res = await request(app).get('/api/content/homepage/settings');
      const catSlug = res.body.data.categories[0].categorySlug;

      const productRes = await request(app)
        .get(`/api/products?category=${catSlug}`);

      expect(productRes.status).toBe(200);
      expect(productRes.body.data.length).toBeGreaterThan(0);
      expect(productRes.body.data[0].category).toBe('Bracelets');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 4. VIDEO REELS — SKU support and validation
  // ──────────────────────────────────────────────────────────
  describe('4. Video Reels — SKU support', () => {
    it('should accept video reel with valid SKU', async () => {
      const product = await createProduct('VIDEO-SKU-001', 'Rings');

      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'VIDEO-SKU-001')
        .attach('video', smallMp4, 'showcase.mp4');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const reel = res.body.data.videoReels[0];
      expect(reel.sku).toBe('VIDEO-SKU-001');
    });

    it('should reject video reel with invalid SKU', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'NONEXISTENT-SKU')
        .attach('video', smallMp4, 'showcase.mp4');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Product with SKU "NONEXISTENT-SKU" not found');
    });

    it('should accept video reel without SKU (backward compat)', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'No SKU Reel')
        .attach('video', smallMp4, 'nosku.mp4');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.videoReels[0].title).toBe('No SKU Reel');
    });

    it('should resolve product details in public API response', async () => {
      const product = await createProduct('SKU-PUBLIC-001', 'Rings');

      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'SKU-PUBLIC-001')
        .field('isActive', 'true')
        .attach('video', smallMp4, 'pub.mp4');

      const res = await request(app).get('/api/content/homepage/settings');
      const reel = res.body.data.videoReels.find((r) => r.sku === 'SKU-PUBLIC-001');
      expect(reel).toBeTruthy();
      expect(reel.productId).toBeTruthy();
      expect(reel.productName).toBe('Product SKU-PUBLIC-001');
    });

    it('should resolve SKU via dedicated video-reels/active endpoint', async () => {
      const product = await createProduct('SKU-ACTIVE-001', 'Earrings');

      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'SKU-ACTIVE-001')
        .field('isActive', 'true')
        .attach('video', smallMp4, 'active.mp4');

      const res = await request(app).get('/api/content/homepage/video-reels/active');
      const reel = res.body.data.find((r) => r.sku === 'SKU-ACTIVE-001');
      expect(reel).toBeTruthy();
      expect(reel.productId).toBeTruthy();
    });

    it('should update video reel SKU and resolve new product', async () => {
      const product1 = await createProduct('SKU-OLD-001', 'Rings');
      const product2 = await createProduct('SKU-NEW-001', 'Necklaces');

      const createRes = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'SKU-OLD-001')
        .attach('video', smallMp4, 'old.mp4');

      const reelId = createRes.body.data.videoReels[0]._id;

      const updateRes = await request(app)
        .put(`/api/content/homepage/video-reels/${reelId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'SKU-NEW-001');

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.videoReels[0].sku).toBe('SKU-NEW-001');

      const publicRes = await request(app).get('/api/content/homepage/video-reels/active');
      const updatedReel = publicRes.body.data.find((r) => r._id === reelId);
      expect(updatedReel.sku).toBe('SKU-NEW-001');
      expect(updatedReel.productId).toBeTruthy();
      expect(updatedReel.productName).toBe('Product SKU-NEW-001');
    });

    it('should clear SKU and productId when set to empty', async () => {
      const product = await createProduct('SKU-CLEAR-001', 'Rings');

      const createRes = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'SKU-CLEAR-001')
        .attach('video', smallMp4, 'clear.mp4');

      const reelId = createRes.body.data.videoReels[0]._id;

      const updateRes = await request(app)
        .put(`/api/content/homepage/video-reels/${reelId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', '');

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.videoReels[0].sku).toBe('');
    });

    it('should validate SKU format (reject object/array)', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('sku', 'SKU-1')
        .field('sku', 'SKU-2')
        .attach('video', smallMp4, 'array-sku.mp4');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('sku must be a string value');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 5. FESTIVE EXCLUSIVE — image upload and backward compat
  // ──────────────────────────────────────────────────────────
  describe('5. Festive Exclusive', () => {
    it('should save festive images with only image (no title/link)', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          festiveExclusiveImages: [
            { image: GOOGLE_DRIVE_URL, isActive: true, sortOrder: 0 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.festiveExclusiveImages).toHaveLength(1);
      expect(res.body.data.festiveExclusiveImages[0].image).toBe(PROXY_URL);
    });

    it('should preserve legacy festive title and link data', async () => {
      await HomepageSetting.updateOne(
        {},
        {
          $set: {
            festiveExclusiveImages: [
              {
                image: GOOGLE_DRIVE_URL,
                title: 'Festive Sale',
                link: '/shop/festive',
                sortOrder: 0,
              },
            ],
          },
        },
        { upsert: true }
      );

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.festiveExclusiveImages[0].title).toBe('Festive Sale');
      expect(res.body.data.festiveExclusiveImages[0].link).toBe('/shop/festive');
      expect(res.body.data.festiveExclusiveImages[0].image).toBe(PROXY_URL);
    });
  });

  // ──────────────────────────────────────────────────────────
  // 6. LEGACY RECORDS — backward compatibility
  // ──────────────────────────────────────────────────────────
  describe('6. Legacy Records Backward Compatibility', () => {
    it('should handle legacy video reel without videoMetadata/isActive', async () => {
      await HomepageSetting.create({
        videoReels: [
          {
            title: 'Legacy Reel',
            videoUrl: 'https://example.com/legacy.mp4',
            sortOrder: 0,
          },
        ],
      });

      const res = await request(app).get('/api/content/homepage/video-reels/active');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].title).toBe('Legacy Reel');
      expect(res.body.data[0].isActive).not.toBe(false);
    });

    it('should handle legacy categories with link but no categoryId', async () => {
      await HomepageSetting.create({
        categories: [
          {
            name: 'Legacy Category',
            image: GOOGLE_DRIVE_URL,
            link: '/shop/legacy',
            sortOrder: 0,
          },
        ],
      });

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.categories[0].name).toBe('Legacy Category');
      expect(res.body.data.categories[0].link).toBe('/shop/legacy');
    });

    it('should handle legacy festiveExclusiveImages with title/link', async () => {
      await HomepageSetting.create({
        festiveExclusiveImages: [
          {
            image: GOOGLE_DRIVE_URL,
            title: 'Legacy Festive',
            link: '/festive/offer',
            sortOrder: 0,
          },
        ],
      });

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.festiveExclusiveImages[0].title).toBe('Legacy Festive');
      expect(res.body.data.festiveExclusiveImages[0].link).toBe('/festive/offer');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 7. HOME PAGE COMPATIBILITY — all sections receive valid data
  // ──────────────────────────────────────────────────────────
 describe('7. Home Page Compatibility — all sections', () => {
    it('should return all existing sections with valid data', async () => {
      const cat = await createCategory('Rings', 'rings');
      const product = await createProduct('COMPAT-SKU-001', 'Rings');

      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          announcementText: 'Announcement',
          announcementActive: true,
          categories: [
            { name: 'Rings', image: GOOGLE_DRIVE_URL, categoryId: String(cat._id), sortOrder: 0 },
          ],
          heroSlides: [
            { image: GOOGLE_DRIVE_URL, isActive: true, sortOrder: 0 },
          ],
          videoReels: [
            { sku: 'COMPAT-SKU-001', isActive: true, sortOrder: 0, videoUrl: '/api/upload/drive/xyz' },
          ],
          festiveExclusiveImages: [
            { image: GOOGLE_DRIVE_URL, sortOrder: 0 },
          ],
        });

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.status).toBe(200);
      const data = res.body.data;

      // Announcement Bar
      expect(data.announcementText).toBe('Announcement');
      expect(data.announcementActive).toBe(true);

      // Hero Slider
      expect(data.heroSlides).toHaveLength(1);
      expect(data.heroSlides[0].image).toBe(PROXY_URL);

      // Category Navigation
      expect(data.categories).toHaveLength(1);
      expect(data.categories[0].categorySlug).toBe('rings');
      expect(data.categories[0].categoryName).toBe('Rings');

      // Video Reels
      expect(data.videoReels).toHaveLength(1);
      expect(data.videoReels[0].sku).toBe('COMPAT-SKU-001');
      expect(data.videoReels[0].productId).toBeTruthy();

      // Festive Exclusive
      expect(data.festiveExclusiveImages).toHaveLength(1);
      expect(data.festiveExclusiveImages[0].image).toBe(PROXY_URL);

      // Other sections still present
      expect(data).toHaveProperty('heroSectionTitle');
      expect(data).toHaveProperty('heroSectionEnabled');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 8. AUTHENTICATION / SECURITY
  // ──────────────────────────────────────────────────────────
  describe('8. Authentication & Security', () => {
    it('should require admin auth for homepage settings update', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .send({ announcementText: 'Unauthorized' });

      expect(res.status).toBe(401);
    });

    it('should require admin auth for video reel upload', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .attach('video', smallMp4, 'nonauth.mp4');

      expect(res.status).toBe(401);
    });
  });
});