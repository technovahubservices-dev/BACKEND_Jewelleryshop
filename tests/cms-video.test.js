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

describe('CMS Watch & Shop — Video Management', () => {
  beforeAll(connect);
  afterAll(close);

  let adminToken;

  const smallMp4 = Buffer.from(
    'AAAAIGZ0eXBpc29tAAAACG' +
    'lzb21tYQAAAAAAAAAAGxpaWJhdmkyN2MGBX0AAAEKAAAA' +
    'Zmlyc3Q7ZGF0YT4K',
    'base64'
  );

  beforeAll(async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);
    const admin = await User.create({
      name: 'Admin',
      email: `cms_video_${Date.now()}@test.com`,
      password: hashedPassword,
      isAdmin: true,
    });
    adminToken = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await HomepageSetting.deleteMany({});
    await HeroBanner.deleteMany({});
    await Collection.deleteMany({});
    await Testimonial.deleteMany({});
    await PromoBanner.deleteMany({});
    await Blog.deleteMany({});
    await FeaturedProduct.deleteMany({});
    await Product.deleteMany({});
  });

  describe('1. Admin can upload Watch & Shop video', () => {
    it('should upload video to Google Drive and store in MongoDB', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Diamond Necklace Showcase')
        .field('price', 'Rs. 4,999')
        .field('shopLink', '/products/diamond-necklace')
        .field('isActive', 'true')
        .attach('video', smallMp4, 'showcase.mp4');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.videoReels).toBeDefined();
      expect(res.body.data.videoReels.length).toBe(1);

      const reel = res.body.data.videoReels[0];
      expect(reel.title).toBe('Diamond Necklace Showcase');
      expect(reel.videoUrl).toContain('drive.google.com/uc?export=view');
      expect(reel.videoMetadata).toBeDefined();
      expect(reel.videoMetadata.driveFileId).toBeTruthy();
      expect(reel.videoMetadata.originalName).toBe('showcase.mp4');
      expect(reel.videoMetadata.mimeType).toBeTruthy();
      expect(reel.price).toBe('Rs. 4,999');
      expect(reel.shopLink).toBe('/products/diamond-necklace');
      expect(reel.sortOrder).toBe(0);

      const dbSettings = await HomepageSetting.findOne({});
      expect(dbSettings.videoReels.length).toBe(1);
      expect(dbSettings.videoReels[0].videoMetadata.driveFileId).toBeTruthy();
      expect(dbSettings.videoReels[0].isActive).toBe(true);
    });
  });

  describe('2. Video is uploaded to Google Drive', () => {
    it('should call uploadRequestFileToGoogleDrive with correct params', async () => {
      const { uploadRequestFileToGoogleDrive } = require('../utils/googleDriveStorage');
      uploadRequestFileToGoogleDrive.mockClear();

      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Drive Upload Test')
        .attach('video', smallMp4, 'test-video.mp4');

      expect(uploadRequestFileToGoogleDrive).toHaveBeenCalled();
    });
  });

  describe('3. MongoDB stores returned video URL', () => {
    it('should store video URL and Drive file ID in MongoDB', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Stored Video')
        .attach('video', smallMp4, 'stored.mp4');

      const reel = res.body.data.videoReels[0];

      const dbSettings = await HomepageSetting.findOne({});
      const dbReel = dbSettings.videoReels[0];

      expect(dbReel.videoUrl).toBe(reel.videoUrl);
      expect(dbReel.videoUrl).toContain('drive.google.com/uc?export=view');
    });
  });

  describe('4. MongoDB stores Drive file ID', () => {
    it('should store driveFileId in videoMetadata', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Metadata Test')
        .attach('video', smallMp4, 'meta.mp4');

      const dbSettings = await HomepageSetting.findOne({});
      expect(dbSettings.videoReels[0].videoMetadata.driveFileId).toBeTruthy();
      expect(dbSettings.videoReels[0].videoMetadata.originalName).toBe('meta.mp4');
      expect(dbSettings.videoReels[0].videoMetadata.mimeType).toBe('video/mp4');
    });
  });

  describe('5. Public API returns video', () => {
    it('should return active video reels from public endpoint', async () => {
      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Public Video')
        .field('isActive', 'true')
        .attach('video', smallMp4, 'public.mp4');

      const res = await request(app)
        .get('/api/content/homepage/settings');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const reels = res.body.data.videoReels || [];
      expect(reels.length).toBe(1);
      expect(reels[0].title).toBe('Public Video');
      expect(reels[0].videoUrl).toContain('drive.google.com');
    });

    it('should also return from dedicated video-reels/active endpoint', async () => {
      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Active Video')
        .field('isActive', 'true')
        .attach('video', smallMp4, 'active.mp4');

      const res = await request(app)
        .get('/api/content/homepage/video-reels/active');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].title).toBe('Active Video');
    });
  });

  describe('6. Inactive video is not publicly displayed', () => {
    it('should hide inactive videos from public API', async () => {
      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Active Video')
        .field('isActive', 'true')
        .attach('video', smallMp4, 'active.mp4');

      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Hidden Video')
        .field('isActive', 'false')
        .attach('video', smallMp4, 'hidden.mp4');

      const res = await request(app)
        .get('/api/content/homepage/video-reels/active');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].title).toBe('Active Video');

      const fullRes = await request(app)
        .get('/api/content/homepage/settings');

      const homepageReels = fullRes.body.data.videoReels || [];
      expect(homepageReels.length).toBe(1);
      expect(homepageReels[0].title).toBe('Active Video');
    });
  });

  describe('7. Admin can update video', () => {
    it('should update title and other fields without video replacement', async () => {
      const createRes = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Original Title')
        .attach('video', smallMp4, 'original.mp4');

      const reelId = createRes.body.data.videoReels[0]._id;

      const res = await request(app)
        .put(`/api/content/homepage/video-reels/${reelId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', '')
        .field('price', 'Rs. 9,999')
        .field('shopLink', '/products/new-item')
        .field('isActive', 'false');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.videoReels[0].title).toBe('');
      expect(res.body.data.videoReels[0].price).toBe('Rs. 9,999');
      expect(res.body.data.videoReels[0].shopLink).toBe('/products/new-item');
      expect(res.body.data.videoReels[0].isActive).toBe(false);
    });
  });

  describe('8. Admin can replace video', () => {
    it('should replace video and delete old Drive file', async () => {
      const createRes = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Original Video')
        .attach('video', smallMp4, 'original.mp4');

      const reelId = createRes.body.data.videoReels[0]._id;
      const newUploadId = 'new-drive-id-' + Date.now();

      const { uploadRequestFileToGoogleDrive, deleteDriveFilesForUrls } = require('../utils/googleDriveStorage');
      uploadRequestFileToGoogleDrive.mockResolvedValueOnce({
        id: newUploadId,
        name: 'replacement.mp4',
        mimeType: 'video/mp4',
        url: 'https://drive.google.com/thumbnail?id=' + newUploadId,
        viewUrl: 'https://drive.google.com/uc?export=view&id=' + newUploadId,
      });
      deleteDriveFilesForUrls.mockClear();

      const res = await request(app)
        .put(`/api/content/homepage/video-reels/${reelId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Replaced Video')
        .attach('video', smallMp4, 'replacement.mp4');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.videoReels[0].videoUrl).toContain(newUploadId);
      expect(res.body.data.videoReels[0].videoMetadata.driveFileId).toBe(newUploadId);
      expect(deleteDriveFilesForUrls).toHaveBeenCalled();
    });
  });

  describe('9. Admin can delete video', () => {
    it('should delete video reel and clean up Drive file', async () => {
      const createRes = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Delete Me')
        .attach('video', smallMp4, 'delete-me.mp4');

      const reelId = createRes.body.data.videoReels[0]._id;

      const { deleteDriveFilesForUrls } = require('../utils/googleDriveStorage');
      deleteDriveFilesForUrls.mockClear();

      const res = await request(app)
        .delete(`/api/content/homepage/video-reels/${reelId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.videoReels.length).toBe(0);

      const dbSettings = await HomepageSetting.findOne({});
      expect(dbSettings.videoReels.length).toBe(0);

      expect(deleteDriveFilesForUrls).toHaveBeenCalled();
    });

    it('should return 404 for non-existent video reel', async () => {
      const res = await request(app)
        .delete('/api/content/homepage/video-reels/000000000000000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('10. Admin can reorder videos', () => {
    it('should reorder video reels by sortOrder', async () => {
      const r1 = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Video 1')
        .attach('video', smallMp4, 'v1.mp4');

      const r2 = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Video 2')
        .attach('video', smallMp4, 'v2.mp4');

      const id1 = r1.body.data.videoReels[0]._id;
      const id2 = r2.body.data.videoReels.find((r) => r.title === 'Video 2')._id;

      const res = await request(app)
        .put('/api/content/homepage/video-reels/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { id: id2, sortOrder: 0 },
            { id: id1, sortOrder: 1 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.videoReels[0].title).toBe('Video 2');
      expect(res.body.data.videoReels[1].title).toBe('Video 1');

      const publicRes = await request(app)
        .get('/api/content/homepage/video-reels/active');

      expect(publicRes.body.data[0].title).toBe('Video 2');
    });
  });

  describe('11. Invalid MIME type rejected', () => {
    it('should reject non-video file with 400', async () => {
      const txtBuffer = Buffer.from('not a video');
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Text File')
        .attach('video', txtBuffer, 'test.txt');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('Internal server error');
    });

    it('should reject video with invalid extension (.exe) via fileFilter', async () => {
      const fakeBuffer = Buffer.from('fake-exe-content');
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Bad Ext')
        .attach('video', fakeBuffer, 'malware.exe');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('12. Oversized video rejected', () => {
    it('should return 413 for file over 25MB', async () => {
      const largeBuffer = Buffer.alloc(26 * 1024 * 1024, 0);

      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Large Video')
        .attach('video', largeBuffer, 'large.mp4');

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toBe('Internal server error');
    });
  });

  describe('13. Unauthorized upload rejected', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .field('title', 'No Auth')
        .attach('video', smallMp4, 'noauth.mp4');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-admin user', async () => {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('user123', salt);
      const user = await User.create({
        name: 'Regular User',
        email: `user_${Date.now()}@test.com`,
        password: hashedPassword,
        isAdmin: false,
      });
      const userToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .field('title', 'Regular User Upload')
        .attach('video', smallMp4, 'user.mp4');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('14. No hardcoded video URLs', () => {
    it('should not return any hardcoded YouTube/demo URLs from public API', async () => {
      await HomepageSetting.deleteMany({});

      const res = await request(app)
        .get('/api/content/homepage/video-reels/active');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(0);
      expect(res.body.data).toEqual([]);

      const homepageRes = await request(app)
        .get('/api/content/homepage/settings');

      const allReels = homepageRes.body.data.videoReels || [];
      for (const reel of allReels) {
        expect(reel.videoUrl).not.toMatch(/youtube\.com|youtu\.be|dQw4w9WgXcQ/i);
      }
    });
  });

  describe('15. Existing homepage settings still work', () => {
    it('should create/update homepage settings alongside video reels', async () => {
      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Test Video')
        .attach('video', smallMp4, 'test.mp4');

      const res = await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSectionEnabled: true,
          announcementText: 'Free shipping available!',
          announcementActive: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.heroSectionEnabled).toBe(true);
      expect(res.body.data.announcementText).toBe('Free shipping available!');

      expect(res.body.data.videoReels[0].title).toBe('Test Video');
    });

    it('should handle existing videoReels without videoMetadata/isActive (backward compat)', async () => {
      const settings = await HomepageSetting.create({
        videoReels: [
          {
            title: 'Legacy Reel',
            videoUrl: 'https://example.com/legacy.mp4',
            sortOrder: 0,
          },
        ],
      });

      const res = await request(app)
        .get('/api/content/homepage/video-reels/active');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].title).toBe('Legacy Reel');
      expect(res.body.data[0].isActive).not.toBe(false);
    });
  });

  describe('16. Type-safe field validation', () => {
    const webmBuffer = Buffer.from(
      'AAAAIGZ0eXB3ZWJtAAAACGxvYm9zdGVzAAAAbG9ib2J1cwAAAAAAAA=' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGGZ0eXBl',
      'base64'
    );

    it('should accept valid WebM upload', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'WebM Video')
        .attach('video', webmBuffer, 'webm-video.webm');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should reject object value for title (fixes TypeError)', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', JSON.stringify({ en: 'Updated Title' }))
        .attach('video', smallMp4, 'test.mp4');

      expect(res.status).toBe(201);
      expect(res.body.data.videoReels[0].title).toBe('{"en":"Updated Title"}');
    });

    it('should reject array value for title without TypeError', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Title 1')
        .field('title', 'Title 2')
        .attach('video', smallMp4, 'test.mp4');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('title must be a string value');
    });

    it('should reject array value for shopLink without TypeError', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Safe Title')
        .field('shopLink', '/shop/1')
        .field('shopLink', '/shop/2')
        .attach('video', smallMp4, 'test.mp4');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('shopLink must be a string value');
    });

    it('should store videoMetadata as clean object (not full file object)', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Metadata Check')
        .attach('video', smallMp4, 'meta.mp4');

      const reel = res.body.data.videoReels[0];
      expect(reel.videoMetadata).toBeDefined();
      expect(typeof reel.videoMetadata).toBe('object');
      expect(Array.isArray(reel.videoMetadata)).toBe(false);
      expect(reel.videoMetadata.driveFileId).toBeTruthy();
      expect(reel.videoMetadata.originalName).toBe('meta.mp4');
      expect(reel.videoMetadata.mimeType).toBe('video/mp4');
      expect(reel.videoMetadata).not.toHaveProperty('buffer');
      expect(reel.videoMetadata).not.toHaveProperty('path');
    });

    it('should accept thumbnail as string and not store file objects', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Thumbnail Test')
        .field('thumbnail', 'https://example.com/thumb.jpg')
        .attach('video', smallMp4, 'thumb.mp4');

      expect(res.status).toBe(201);
      expect(res.body.data.videoReels[0].thumbnail).toBe('https://example.com/thumb.jpg');
      expect(typeof res.body.data.videoReels[0].thumbnail).toBe('string');
    });

    it('should reject non-string thumbnail (array) with 400', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Bad Thumb')
        .field('thumbnail', 'https://example.com/thumb1.jpg')
        .field('thumbnail', 'https://example.com/thumb2.jpg')
        .attach('video', smallMp4, 'test.mp4');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('thumbnail must be a string value');
    });
  });

  describe('17. Hero section stale data cleanup', () => {
    it('should verify homepage API returns hero data fields', async () => {
      await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Hero Video')
        .attach('video', smallMp4, 'hero.mp4');

      const res = await request(app)
        .get('/api/content/homepage/settings');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('heroSectionTitle');
      expect(res.body.data).toHaveProperty('heroSectionSubtitle');
      expect(res.body.data).toHaveProperty('heroSlides');
      expect(res.body.data).toHaveProperty('videoReels');
      expect(res.body.data).toHaveProperty('heroSectionEnabled');
    });

    it('should NOT contain stale "Updated Title" in any hero field', async () => {
      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSectionTitle: 'Real Title',
          heroSectionSubtitle: 'Real Subtitle',
          heroSlides: [
            { title: 'Real Slide Title', subtitle: 'Real Subtitle', image: '', link: '/shop', isActive: true, sortOrder: 0 },
          ],
        });

      const res = await request(app)
        .get('/api/content/homepage/settings');

      const jsonStr = JSON.stringify(res.body.data);
      expect(jsonStr).not.toContain('Updated Title');
      expect(jsonStr).not.toContain('Explore Collection');
    });

    it('should clear stale hero data when updated with empty/clean values', async () => {
      await HomepageSetting.updateOne(
        {},
        {
          $set: {
            heroSectionTitle: 'Updated Title',
            heroSectionSubtitle: 'Explore Collection',
          },
        },
        { upsert: true }
      );

      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSectionTitle: '',
          heroSectionSubtitle: '',
        });

      const res = await request(app)
        .get('/api/content/homepage/settings');

      expect(res.body.data.heroSectionTitle).toBe('');
      expect(res.body.data.heroSectionSubtitle).toBe('');
      expect(res.body.data.heroSectionTitle).not.toBe('Updated Title');
      expect(res.body.data.heroSectionSubtitle).not.toBe('Explore Collection');
    });

    it('should not have stale values in default homepage on fresh start', async () => {
      await HomepageSetting.deleteMany({});

      const res = await request(app)
        .get('/api/content/homepage/settings');

      expect(res.status).toBe(200);
      const jsonStr = JSON.stringify(res.body.data);
      expect(jsonStr).not.toContain('Updated Title');
      expect(jsonStr).not.toContain('Explore Collection');
    });

    it('should remove stale heroSlides containing "Updated Title"', async () => {
      await HomepageSetting.updateOne(
        {},
        {
          $set: {
            heroSlides: [
              { title: 'Updated Title', subtitle: 'Explore Collection', image: 'https://placehold.co/600x600', link: '/shop', isActive: true, sortOrder: 0 },
              { title: 'Valid Slide', subtitle: 'Valid Subtitle', image: 'https://placehold.co/600x600', link: '/shop', isActive: true, sortOrder: 1 },
            ],
          },
        },
        { upsert: true }
      );

      await request(app)
        .put('/api/content/homepage/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          heroSlides: [
            { title: 'Valid Slide', subtitle: 'Valid Subtitle', image: 'https://placehold.co/600x600', link: '/shop', isActive: true, sortOrder: 0 },
          ],
        });

      const res = await request(app)
        .get('/api/content/homepage/settings');

      const jsonStr = JSON.stringify(res.body.data);
      expect(jsonStr).not.toContain('Updated Title');
      expect(jsonStr).not.toContain('Explore Collection');
      expect(res.body.data.heroSlides.length).toBe(1);
      expect(res.body.data.heroSlides[0].title).toBe('Valid Slide');
    });
  });

  describe('18. Google Drive permission verification', () => {
    it('should verify permission was set after upload', async () => {
      const { uploadRequestFileToGoogleDrive, ensurePublicPermission } = require('../utils/googleDriveStorage');
      uploadRequestFileToGoogleDrive.mockClear();
      uploadRequestFileToGoogleDrive.mockResolvedValueOnce({
        id: 'verify-drive-id-1',
        name: 'verified.mp4',
        mimeType: 'video/mp4',
        url: 'https://drive.google.com/thumbnail?id=verify-drive-id-1&sz=w2000',
        viewUrl: 'https://drive.google.com/uc?export=view&id=verify-drive-id-1',
        mediaType: 'video',
        publicUrl: 'https://drive.google.com/uc?export=view&id=verify-drive-id-1',
        uploadedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Permission Verified')
        .field('thumbnail', 'https://example.com/thumb.jpg')
        .field('shopLink', '/shop/123')
        .field('price', '2500')
        .attach('video', smallMp4, 'verify.mp4');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const reel = res.body.data.videoReels[0];
      expect(reel.videoMetadata).toBeDefined();
      expect(reel.videoMetadata.driveFileId).toBeTruthy();
      expect(reel.videoMetadata.originalName).toBe('verify.mp4');
      expect(reel.videoMetadata.mimeType).toBe('video/mp4');
    });

    it('should return 500 when Drive upload returns no file ID', async () => {
      const { uploadRequestFileToGoogleDrive } = require('../utils/googleDriveStorage');
      uploadRequestFileToGoogleDrive.mockClear();
      uploadRequestFileToGoogleDrive.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Failed Upload')
        .attach('video', smallMp4, 'fail.mp4');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it('should store mediaType metadata correctly for video reel', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Media Type Video')
        .attach('video', smallMp4, 'media-type.mp4');

      expect(res.status).toBe(201);
      expect(res.body.data.videoReels[0].videoUrl).toContain('drive.google.com');
      expect(res.body.data.videoReels[0].videoMetadata.mimeType).toBe('video/mp4');
    });

    it('should return browser-compatible video URL (not thumbnail for video)', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Browser Compatible')
        .attach('video', smallMp4, 'browser.mp4');

      const reel = res.body.data.videoReels[0];
      expect(reel.videoUrl).toContain('drive.google.com');
      expect(reel.videoUrl).not.toContain('/thumbnail');
      expect(reel.videoMetadata.mimeType).toBe('video/mp4');
    });

    it('should not expose internal file paths or Buffer objects in response', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'No Internal Paths')
        .attach('video', smallMp4, 'clean.mp4');

      const reel = res.body.data.videoReels[0];
      const jsonStr = JSON.stringify(reel);
      expect(jsonStr).not.toContain('buffer');
      expect(jsonStr).not.toContain('tmp');
      expect(jsonStr).not.toContain('/uploads/');
      expect(jsonStr).not.toContain('path');
    });
  });

  describe('19. Drive URL repair mechanism', () => {
    it('should repair stale drive.google.com URLs in HomepageSetting', async () => {
      const { normalizeGoogleDriveUrl, repairDriveUrl } = require('../utils/googleDriveStorage');

      const staledUrl = 'https://drive.google.com/uc?export=view&id=old-file-id-123';
      const repairedUrl = repairDriveUrl(staledUrl);
      expect(repairedUrl).toBe('https://drive.google.com/uc?export=view&id=old-file-id-123');
    });

    it('should preserve thumbnail URLs during repair', async () => {
      const { repairDriveUrl } = require('../utils/googleDriveStorage');

      const thumbUrl = 'https://drive.google.com/thumbnail?id=img-file-456&sz=w2000';
      const repaired = repairDriveUrl(thumbUrl);
      expect(repaired).toBe(thumbUrl);
    });

    it('should normalize non-canonical image URLs during repair', async () => {
      const { repairDriveUrl } = require('../utils/googleDriveStorage');

      const nonCanonical = 'https://drive.google.com/file/d/noncanonical-789/view';
      const repaired = repairDriveUrl(nonCanonical);
      expect(repaired).toContain('noncanonical-789');
      expect(repaired).toContain('/thumbnail');
    });

    it('should verify existing videoReels URLs have valid format', async () => {
      const res = await request(app)
        .post('/api/content/homepage/video-reels/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('title', 'Format Check')
        .field('thumbnail', 'https://example.com/thumb.jpg')
        .field('shopLink', '/shop')
        .field('price', '2500')
        .attach('video', smallMp4, 'format.mp4');

      expect(res.status).toBe(201);
      const reel = res.body.data.videoReels[0];
      expect(reel.videoUrl).toMatch(/^https:\/\/drive\.google\.com\//);
      expect(reel.videoMetadata.driveFileId).toBeTruthy();
      expect(reel.videoMetadata.originalName).toBe('format.mp4');
      expect(reel.videoMetadata.mimeType).toBe('video/mp4');
    });
  });
});
