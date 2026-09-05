const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const HomepageSetting = require('../models/HomepageSetting');
const HeroBanner = require('../models/HeroBanner');
const PromoBanner = require('../models/PromoBanner');
const Collection = require('../models/Collection');
const FeaturedProduct = require('../models/FeaturedProduct');
const Blog = require('../models/Blog');
const Testimonial = require('../models/Testimonial');

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

const GOOGLE_DRIVE_THUMBNAIL_ID = '1abc123thumb';
const GOOGLE_DRIVE_THUMBNAIL = `https://drive.google.com/thumbnail?id=${GOOGLE_DRIVE_THUMBNAIL_ID}&sz=w2000`;
const GOOGLE_DRIVE_FILE_URL = `https://drive.google.com/file/d/${GOOGLE_DRIVE_THUMBNAIL_ID}/view?usp=sharing`;
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('CMS — Homepage Settings (Botique parity)', () => {
  let admin;
  let adminToken;

  beforeAll(connect);
  afterAll(close);

  beforeAll(async () => {
    admin = await createAdminUser(`cms_admin_${Date.now()}@test.com`, 'admin123');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = loginRes.body.token;
  });

  afterEach(async () => {
    await HomepageSetting.deleteMany({});
  });

  describe('GET /api/content/homepage/settings (public)', () => {
    it('should return homepage settings without auth', async () => {
      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('should create default settings if none exist', async () => {
      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.body.data).toBeDefined();
      const created = await HomepageSetting.findOne({});
      expect(created).not.toBeNull();
    });
  });

  describe('Video URL handling (YouTube preservation)', () => {
    it('should preserve YouTube URLs in videoReels.videoUrl without normalizing as Drive URLs', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          videoReels: [
            {
              title: 'Promo Reel',
              videoUrl: YOUTUBE_URL,
              thumbnail: GOOGLE_DRIVE_THUMBNAIL,
              sortOrder: 1,
            },
          ],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.videoReels[0].videoUrl).toBe(YOUTUBE_URL);
      expect(res.body.data.videoReels[0].thumbnail).toBe(GOOGLE_DRIVE_THUMBNAIL);
    });

    it('should normalize non-thumbnail Google Drive URLs to thumbnail format', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSectionBgImage: GOOGLE_DRIVE_FILE_URL,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.heroSectionBgImage).toBe(GOOGLE_DRIVE_THUMBNAIL);
    });

    it('should preserve uc?export=view video URLs (not normalize to thumbnail)', async () => {
      const driveVideoUrl = `https://drive.google.com/uc?export=view&id=video123`;
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          videoReels: [
            {
              title: 'Video Reel',
              videoUrl: driveVideoUrl,
              sortOrder: 1,
            },
          ],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.videoReels[0].videoUrl).toBe(driveVideoUrl);
    });
  });

  describe('Hero section enable/disable', () => {
    it('should support heroSectionEnabled flag', async () => {
      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSectionEnabled: false,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.heroSectionEnabled).toBe(false);
    });
  });

  describe('Homepage array ordering (sortOrder)', () => {
    it('should sort heroSlides by sortOrder in GET response', async () => {
      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSlides: [
            { image: GOOGLE_DRIVE_THUMBNAIL, title: 'Slide 2', sortOrder: 2 },
            { image: GOOGLE_DRIVE_THUMBNAIL, title: 'Slide 1', sortOrder: 1 },
            { image: GOOGLE_DRIVE_THUMBNAIL, title: 'Slide 3', sortOrder: 3 },
          ],
        });

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.body.data.heroSlides[0].title).toBe('Slide 1');
      expect(res.body.data.heroSlides[1].title).toBe('Slide 2');
      expect(res.body.data.heroSlides[2].title).toBe('Slide 3');
    });

    it('should sort videoReels by sortOrder in GET response', async () => {
      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          videoReels: [
            { title: 'Reel B', videoUrl: YOUTUBE_URL, sortOrder: 2 },
            { title: 'Reel A', videoUrl: YOUTUBE_URL, sortOrder: 1 },
          ],
        });

      const res = await request(app).get('/api/content/homepage/settings');
      expect(res.body.data.videoReels[0].title).toBe('Reel A');
      expect(res.body.data.videoReels[1].title).toBe('Reel B');
    });
  });
});

describe('CMS — Content CRUD (Botique parity)', () => {
  let admin;
  let adminToken;

  beforeAll(connect);
  afterAll(close);

  beforeAll(async () => {
    admin = await createAdminUser(`cms_crud_${Date.now()}@test.com`, 'admin123');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = loginRes.body.token;
  });

  afterEach(async () => {
    await HeroBanner.deleteMany({});
    await PromoBanner.deleteMany({});
    await Collection.deleteMany({});
    await Testimonial.deleteMany({});
    await Blog.deleteMany({});
    await FeaturedProduct.deleteMany({});
  });

  describe('GET /active (public, no auth)', () => {
    it('should return active content without authentication', async () => {
      await HeroBanner.create({ title: 'Active Banner', image: GOOGLE_DRIVE_THUMBNAIL, isActive: true, sortOrder: 1 });
      await HeroBanner.create({ title: 'Inactive Banner', image: GOOGLE_DRIVE_THUMBNAIL, isActive: false, sortOrder: 2 });

      const res = await request(app).get('/api/content/heroBanners/active');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].title).toBe('Active Banner');
    });
  });

  describe('Admin CRUD', () => {
    it('should create content with JWT auth', async () => {
      const res = await request(app)
        .post('/api/content/heroBanners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Hero Banner',
          image: GOOGLE_DRIVE_THUMBNAIL,
          isActive: true,
          sortOrder: 1,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should reject unauthenticated admin access', async () => {
      const res = await request(app)
        .post('/api/content/heroBanners')
        .send({ title: 'No Auth', image: GOOGLE_DRIVE_THUMBNAIL });

      expect(res.statusCode).toBe(401);
    });

    it('should reorder content (update sortOrder atomically)', async () => {
      const b1 = await HeroBanner.create({ title: 'B1', image: GOOGLE_DRIVE_THUMBNAIL, isActive: true, sortOrder: 1 });
      const b2 = await HeroBanner.create({ title: 'B2', image: GOOGLE_DRIVE_THUMBNAIL, isActive: true, sortOrder: 2 });

      const res = await request(app)
        .put('/api/content/heroBanners/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ id: b2._id, sortOrder: 1 }, { id: b1._id, sortOrder: 2 }] });

      expect(res.statusCode).toBe(200);

      const updated = await HeroBanner.find().sort('sortOrder');
      expect(updated[0].title).toBe('B2');
      expect(updated[1].title).toBe('B1');
    });

    it('should toggle isActive', async () => {
      const item = await HeroBanner.create({ title: 'Toggle Me', image: GOOGLE_DRIVE_THUMBNAIL, isActive: true, sortOrder: 1 });

      const res = await request(app)
        .put(`/api/content/heroBanners/${item._id}/toggle`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await HeroBanner.findById(item._id);
      expect(updated.isActive).toBe(false);
    });
  });
});

describe('CMS — Image URL Normalization', () => {
  let admin;
  let adminToken;

  beforeAll(connect);
  afterAll(close);

  beforeAll(async () => {
    admin = await createAdminUser(`cms_norm_${Date.now()}@test.com`, 'admin123');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = loginRes.body.token;
  });

  afterEach(async () => {
    await HeroBanner.deleteMany({});
  });

  it('should normalize Google Drive file URLs to thumbnail format on create', async () => {
    const res = await request(app)
      .post('/api/content/heroBanners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Normalized',
        image: GOOGLE_DRIVE_FILE_URL,
        isActive: true,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.image).toBe(GOOGLE_DRIVE_THUMBNAIL);
  });

  it('should normalize Google Drive URLs on GET (read-time)', async () => {
    await HeroBanner.create({
      title: 'Stored',
      image: GOOGLE_DRIVE_FILE_URL,
      isActive: true,
    });

    const res = await request(app)
      .get('/api/content/heroBanners')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data[0].image).toBe(GOOGLE_DRIVE_THUMBNAIL);
  });

  it('should preserve non-Google URLs (e.g. YouTube) in image fields', async () => {
    const res = await request(app)
      .post('/api/content/heroBanners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'External',
        image: 'https://example.com/banner.jpg',
        isActive: true,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.image).toBe('https://example.com/banner.jpg');
  });

  it('should normalize mobileImage alongside image', async () => {
    const res = await request(app)
      .post('/api/content/heroBanners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Mobile',
        image: GOOGLE_DRIVE_FILE_URL,
        mobileImage: GOOGLE_DRIVE_FILE_URL,
        isActive: true,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.image).toBe(GOOGLE_DRIVE_THUMBNAIL);
    expect(res.body.data.mobileImage).toBe(GOOGLE_DRIVE_THUMBNAIL);
  });
});
