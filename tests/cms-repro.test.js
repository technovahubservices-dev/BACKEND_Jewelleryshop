const request = require('supertest');
const { app } = require('../server');
const { connect, close } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const HeroBanner = require('../models/HeroBanner');
const Collection = require('../models/Collection');
const Testimonial = require('../models/Testimonial');
const PromoBanner = require('../models/PromoBanner');
const Blog = require('../models/Blog');
const FeaturedProduct = require('../models/FeaturedProduct');
const HomepageSetting = require('../models/HomepageSetting');
const GoogleDriveConnection = require('../models/GoogleDriveConnection');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mock Google Drive to avoid needing real credentials
jest.mock('../utils/googleDriveStorage', () => {
  const actual = jest.requireActual('../utils/googleDriveStorage');
  return {
    ...actual,
    uploadRequestFileToGoogleDrive: jest.fn(async (req, options = {}) => {
      if (!req.file) return null;
      return {
        id: 'mock-drive-id-' + Date.now(),
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        url: 'https://drive.google.com/thumbnail?id=mock-drive-id&sz=w2000',
        viewUrl: 'https://drive.google.com/uc?export=view&id=mock-drive-id',
      };
    }),
    uploadRequestFilesToGoogleDrive: jest.fn(async (req, options = {}) => {
      if (!req.files || req.files.length === 0) return [];
      return req.files.map((file, idx) => ({
        id: 'mock-drive-id-' + Date.now() + '-' + idx,
        name: file.originalname,
        mimeType: file.mimetype,
        url: 'https://drive.google.com/thumbnail?id=mock-drive-id&sz=w2000',
        viewUrl: 'https://drive.google.com/uc?export=view&id=mock-drive-id',
      }));
    }),
    deleteDriveFilesForUrls: jest.fn(async () => {}),
  };
});

describe('CMS Content Management Reproduction', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;
  let adminUser;

  const smallPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeAll(async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);
    adminUser = await User.create({
      name: 'Admin',
      email: `cms_admin_${Date.now()}@test.com`,
      password: hashedPassword,
      isAdmin: true,
    });
    adminToken = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Create GoogleDriveConnection so uploadRequestFileToGoogleDrive doesn't fail early
    await GoogleDriveConnection.create({
      user: adminUser._id,
      googleAccountId: 'test-account',
      email: 'test@example.com',
      scope: ['https://www.googleapis.com/auth/drive.file'],
      accessTokenEncrypted: '',
      refreshTokenEncrypted: 'mock-refresh-token',
      connectedAt: new Date(),
    });
  });

  afterEach(async () => {
    await HeroBanner.deleteMany({});
    await Collection.deleteMany({});
    await Testimonial.deleteMany({});
    await PromoBanner.deleteMany({});
    await Blog.deleteMany({});
    await FeaturedProduct.deleteMany({});
  });

  describe('CMS Upload/Save Flow', () => {
    it('TEST A: Create HeroBanner with image upload', async () => {
      console.log('[CMS REPRO] Creating HeroBanner with image upload...');
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Hero')
        .field('isActive', 'true')
        .attach('image', smallPng, 'hero-image.png');

      console.log('[CMS REPRO] TEST A Status:', res.status);
      console.log('[CMS REPRO] TEST A Body:', JSON.stringify(res.body, null, 2));
    });

    it('TEST B: Create Collection with image upload', async () => {
      console.log('[CMS REPRO] Creating Collection with image upload...');
      const res = await request(app)
        .post('/api/content/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Collection')
        .field('description', 'A test collection')
        .field('isActive', 'true')
        .attach('image', smallPng, 'collection-image.png');

      console.log('[CMS REPRO] TEST B Status:', res.status);
      console.log('[CMS REPRO] TEST B Body:', JSON.stringify(res.body, null, 2));
    });

    it('TEST C: Create Testimonial with image upload', async () => {
      console.log('[CMS REPRO] Creating Testimonial with image upload...');
      const res = await request(app)
        .post('/api/content/testimonials')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'John Doe')
        .field('content', 'Great product!')
        .field('rating', '5')
        .field('isActive', 'true')
        .attach('image', smallPng, 'testimonial-image.png');

      console.log('[CMS REPRO] TEST C Status:', res.status);
      console.log('[CMS REPRO] TEST C Body:', JSON.stringify(res.body, null, 2));
    });

    it('TEST D: Create PromoBanner with image upload', async () => {
      console.log('[CMS REPRO] Creating PromoBanner with image upload...');
      const res = await request(app)
        .post('/api/content/promoBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Promo')
        .field('isActive', 'true')
        .attach('image', smallPng, 'promo-image.png');

      console.log('[CMS REPRO] TEST D Status:', res.status);
      console.log('[CMS REPRO] TEST D Body:', JSON.stringify(res.body, null, 2));
    });

    it('TEST E: Create Blog with image upload', async () => {
      console.log('[CMS REPRO] Creating Blog with image upload...');
      const res = await request(app)
        .post('/api/content/blogs')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Blog')
        .field('content', 'Blog content')
        .field('isActive', 'true')
        .attach('image', smallPng, 'blog-image.png');

      console.log('[CMS REPRO] TEST E Status:', res.status);
      console.log('[CMS REPRO] TEST E Body:', JSON.stringify(res.body, null, 2));
    });

    it('TEST F: Create FeaturedProduct with image upload', async () => {
      console.log('[CMS REPRO] Creating FeaturedProduct with image upload...');
      const res = await request(app)
        .post('/api/content/featuredProducts')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Featured')
        .field('isActive', 'true')
        .attach('image', smallPng, 'featured-image.png');

      console.log('[CMS REPRO] TEST F Status:', res.status);
      console.log('[CMS REPRO] TEST F Body:', JSON.stringify(res.body, null, 2));
    });
  });

  describe('CMS Error Handling', () => {
    it('TEST G: File with wrong field name', async () => {
      console.log('[CMS REPRO] Wrong field name test...');
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Hero')
        .field('imageUrls', 'https://example.com/img.jpg')
        .attach('file', smallPng, 'test.png');

      console.log('[CMS REPRO] TEST G Status:', res.status);
      console.log('[CMS REPRO] TEST G Body:', JSON.stringify(res.body));
      expect(res.status).not.toBe(500);
    });

    it('TEST H: File with invalid extension', async () => {
      console.log('[CMS REPRO] Invalid file type test...');
      const txtBuffer = Buffer.from('not an image');
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Hero')
        .attach('image', txtBuffer, 'test.txt');

      console.log('[CMS REPRO] TEST H Status:', res.status);
      console.log('[CMS REPRO] TEST H Body:', JSON.stringify(res.body));
      expect(res.status).not.toBe(500);
    });

    it('TEST I: File too large', async () => {
      console.log('[CMS REPRO] File too large test...');
      const largeBuffer = Buffer.alloc(26 * 1024 * 1024, 0);
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Hero')
        .attach('image', largeBuffer, 'large.png');

      console.log('[CMS REPRO] TEST I Status:', res.status);
      console.log('[CMS REPRO] TEST I Body:', JSON.stringify(res.body));
      expect(res.status).not.toBe(500);
    });
  });
});
