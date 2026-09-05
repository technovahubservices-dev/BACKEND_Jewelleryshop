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

describe('CMS Upload/Save — With Image Upload', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  const smallPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeAll(async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);
    const admin = await User.create({
      name: 'Admin',
      email: `cms_upload_${Date.now()}@test.com`,
      password: hashedPassword,
      isAdmin: true,
    });
    adminToken = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await HeroBanner.deleteMany({});
    await Collection.deleteMany({});
    await Testimonial.deleteMany({});
    await PromoBanner.deleteMany({});
    await Blog.deleteMany({});
    await FeaturedProduct.deleteMany({});
    await Product.deleteMany({});
  });

  describe('Image Upload → Save', () => {
    it('should upload image to Google Drive and save to MongoDB', async () => {
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Hero with Image')
        .field('isActive', 'true')
        .attach('image', smallPng, 'hero.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.url).toContain('drive.google.com');

      const dbItem = await HeroBanner.findById(res.body.data._id);
      expect(dbItem).toBeTruthy();
      expect(dbItem.image).toContain('drive.google.com');

      const getRes = await request(app)
        .get('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      const found = getRes.body.data.find((i) => i._id === res.body.data._id);
      expect(found).toBeTruthy();
      expect(found.image).toContain('drive.google.com');
    });

    it('should create product with uploaded image', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'With Image Product')
        .field('sku', 'IMG-PRODUCT-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '7500')
        .attach('images', smallPng, 'product.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.images.length).toBeGreaterThan(0);
    });

    it('should create product without image (imageUrls URL only)', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'No Image Product')
        .field('sku', 'NOIMG-PRODUCT-001')
        .field('category', 'Rings')
        .field('price', '5000')
        .field('imageUrls', 'https://example.com/ring.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.images).toContain('https://example.com/ring.jpg');
    });
  });

  describe('Edit → Replace Image', () => {
    it('should replace image when editing and clean up old Drive file', async () => {
      const createRes = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Original Hero')
        .attach('image', smallPng, 'original.png');

      const heroId = createRes.body.data._id;
      const oldImage = createRes.body.data.image;

      const res = await request(app)
        .put(`/api/content/heroBanners/${heroId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Updated Hero')
        .attach('image', smallPng, 'replacement.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.image).toBeTruthy();
      expect(res.body.data.image).toContain('drive.google.com');

      const { deleteDriveFilesForUrls } = require('../utils/googleDriveStorage');
      expect(deleteDriveFilesForUrls).toHaveBeenCalled();
    });
  });

  describe('Delete → Drive Cleanup', () => {
    it('should delete CMS item and clean up Drive files', async () => {
      const createRes = await request(app)
        .post('/api/content/testimonials')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'Delete Me')
        .field('content', 'Test content')
        .attach('image', smallPng, 'delete-me.png');

      const testimonialId = createRes.body.data._id;

      const res = await request(app)
        .delete(`/api/content/testimonials/${testimonialId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deleted = await Testimonial.findById(testimonialId);
      expect(deleted).toBeNull();

      const { deleteDriveFilesForUrls } = require('../utils/googleDriveStorage');
      expect(deleteDriveFilesForUrls).toHaveBeenCalled();
    });
  });

  describe('YouTube URL Preservation', () => {
    it('should preserve YouTube URL in videoReels', async () => {
      const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          videoReels: [
            {
              title: 'Product Showcase',
              videoUrl: youtubeUrl,
              thumbnail: 'https://example.com/thumb.jpg',
              sortOrder: 0,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const reel = res.body.data.videoReels[0];
      expect(reel.videoUrl).toBe(youtubeUrl);
    });
  });

  describe('Active/Inactive', () => {
    it('should not return inactive item from active endpoint', async () => {
      await request(app)
        .post('/api/content/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Active Collection')
        .field('isActive', 'true')
        .attach('image', smallPng, 'active.png');

      await request(app)
        .post('/api/content/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Inactive Collection')
        .field('isActive', 'false')
        .attach('image', smallPng, 'inactive.png');

      const res = await request(app).get('/api/content/collections/active');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].title).toBe('Active Collection');
    });
  });

  describe('Reorder', () => {
    it('should reorder items by sortOrder', async () => {
      const r1 = await request(app)
        .post('/api/content/promoBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Banner 1')
        .attach('image', smallPng, 'b1.png');

      const r2 = await request(app)
        .post('/api/content/promoBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Banner 2')
        .attach('image', smallPng, 'b2.png');

      const res = await request(app)
        .put('/api/content/promoBanners/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { id: r2.body.data._id, sortOrder: 0 },
            { id: r1.body.data._id, sortOrder: 1 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app).get('/api/content/promoBanners/active').set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.body.data[0].title).toBe('Banner 2');
      expect(getRes.body.data[1].title).toBe('Banner 1');
    });
  });

  describe('Multer Error Handling (was 500 Internal Server Error)', () => {
    it('should return 400 for invalid file type (not 500)', async () => {
      const txtBuffer = Buffer.from('not an image');
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Bad File Hero')
        .attach('image', txtBuffer, 'test.txt');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('Internal server error');
    });

    it('should return 400 for unexpected file field (not 500)', async () => {
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Bad Field Hero')
        .field('imageUrls', 'https://example.com/img.jpg')
        .attach('images', smallPng, 'test.png');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('Internal server error');
    });

    it('should return 413 for file too large (not 500)', async () => {
      const largeBuffer = Buffer.alloc(26 * 1024 * 1024, 0);
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Large Hero')
        .attach('image', largeBuffer, 'large.png');

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('Internal server error');
    });
  });
});
