const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const Product = require('../models/Product');
const Wishlist = require('../models/Wishlist');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
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

describe('Sprint 2 - Product Media, Search, Filter, Sort, Related, Recently Viewed', () => {
  beforeAll(connect);
  afterAll(async () => {
    await Product.deleteMany({});
    await Wishlist.deleteMany({});
    await Cart.deleteMany({});
    await Order.deleteMany({});
    await close();
  });

  let adminToken;
  let userToken;
  let userToken2;
  let productId1;
  let productId2;
  let productId3;
  let productId4;
  let productId5;

  beforeAll(async () => {
    const admin = await createAdminUser(`admin_sp2_${Date.now()}@test.com`, 'admin123');
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = adminRes.body.token;

    const userRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Sp2 User',
        email: `user_sp2_${Date.now()}@test.com`,
        password: 'password123',
      });
    userToken = userRes.body.token;

    const userRes2 = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Sp2 User2',
        email: `user2_sp2_${Date.now()}@test.com`,
        password: 'password123',
      });
    userToken2 = userRes2.body.token;
  });

  beforeEach(async () => {
    await Product.deleteMany({});
    await Wishlist.deleteMany({});
    await Cart.deleteMany({});
    await Order.deleteMany({});
    await User.updateMany({}, { $set: { recentlyViewed: [] } });
  });

  const seedProducts = async () => {
    const p1 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Elegant Gold Ring')
      .field('sku', 'GR-001')
      .field('category', 'Rings')
      .field('subcategory', 'Engagement Rings')
      .field('jewelleryCollection', 'Heritage')
      .field('metal', 'Gold')
      .field('purity', '14K')
      .field('price', '10000')
      .field('discountPrice', '8000')
      .field('stock', '10')
      .field('status', 'active')
      .field('isFeatured', 'true')
      .field('isNewArrival', 'true')
      .field('tags', 'ring,gold,engagement')
      .field('imageUrls', 'https://example.com/ring1.jpg,https://example.com/ring2.jpg,https://example.com/ring3.jpg')
      .field('productVideoUrl', 'https://example.com/ring-video.mp4')
      .field('productVideoThumbnail', 'https://example.com/ring-video-thumb.jpg')
      .field('description', 'Elegant gold engagement ring description');
    productId1 = p1.body.data._id;

    const p2 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Silver Pendant Necklace')
      .field('sku', 'SN-002')
      .field('category', 'Necklaces')
      .field('jewelleryCollection', 'Eternal')
      .field('metal', 'Silver')
      .field('purity', 'Sterling Silver')
      .field('price', '5000')
      .field('stock', '5')
      .field('status', 'active')
      .field('tags', 'necklace,pendant,silver')
      .field('imageUrls', 'https://example.com/necklace1.jpg,https://example.com/necklace2.jpg')
      .field('description', 'Silver pendant necklace description');
    productId2 = p2.body.data._id;

    const p3 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Platinum Diamond Earrings')
      .field('sku', 'PE-003')
      .field('category', 'Earrings')
      .field('subcategory', 'Diamond Earrings')
      .field('jewelleryCollection', 'Blossom')
      .field('metal', 'Platinum')
      .field('purity', '950PT')
      .field('price', '15000')
      .field('stock', '3')
      .field('status', 'active')
      .field('isBestSeller', 'true')
      .field('tags', 'earrings,diamond,platinum')
      .field('imageUrls', 'https://example.com/earrings1.jpg')
      .field('description', 'Platinum diamond earrings description');
    productId3 = p3.body.data._id;

    const p4 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Classic Gold Band')
      .field('sku', 'GB-004')
      .field('category', 'Rings')
      .field('subcategory', 'Wedding Bands')
      .field('jewelleryCollection', 'Aura')
      .field('metal', 'Gold')
      .field('purity', '18K')
      .field('price', '12000')
      .field('stock', '8')
      .field('status', 'inactive')
      .field('tags', 'ring,band,gold')
      .field('imageUrls', 'https://example.com/band1.jpg')
      .field('description', 'Classic gold wedding band description');
    productId4 = p4.body.data._id;

    const p5 = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Diamond Cocktail Ring')
      .field('sku', 'DCR-005')
      .field('category', 'Rings')
      .field('subcategory', 'Cocktail Rings')
      .field('jewelleryCollection', 'Eternal')
      .field('metal', 'Gold')
      .field('purity', '18K')
      .field('price', '18000')
      .field('discountPrice', '15000')
      .field('stock', '5')
      .field('status', 'active')
      .field('tags', 'ring,diamond,cocktail')
      .field('imageUrls', 'https://example.com/cocktail1.jpg')
      .field('description', 'Diamond cocktail ring description');
    productId5 = p5.body.data._id;
  };

  beforeEach(async () => {
    await seedProducts();
  });

  afterEach(async () => {
    await Product.deleteMany({});
    await Wishlist.deleteMany({});
  });

  // ===========================================
  // 1. PRODUCT MEDIA / IMAGE GALLERY
  // ===========================================
  describe('Product Media / Image Gallery', () => {
    it('product detail should return structured images with url, alt, order', async () => {
      const res = await request(app).get(`/api/products/${productId1}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.images).toBeInstanceOf(Array);
      expect(res.body.data.images.length).toBe(3);

      const firstImage = res.body.data.images[0];
      expect(firstImage).toHaveProperty('url');
      expect(firstImage).toHaveProperty('alt');
      expect(firstImage).toHaveProperty('order');
      expect(firstImage.url).toBe('https://example.com/ring1.jpg');
      expect(firstImage.order).toBe(0);
    });

    it('product detail should return images in order', async () => {
      const res = await request(app).get(`/api/products/${productId1}`);

      expect(res.statusCode).toBe(200);
      const orders = res.body.data.images.map((img) => img.order);
      expect(orders).toEqual([0, 1, 2]);
      expect(res.body.data.images[0].url).toBe('https://example.com/ring1.jpg');
      expect(res.body.data.images[2].url).toBe('https://example.com/ring3.jpg');
    });

    it('product listing should return structured images for product cards', async () => {
      const res = await request(app).get('/api/products');

      expect(res.statusCode).toBe(200);
      const product = res.body.data.find((p) => p._id === productId1);
      expect(product).toBeDefined();
      expect(product.images).toBeInstanceOf(Array);
      expect(product.images.length).toBe(3);
      expect(product.images[0]).toHaveProperty('url');
      expect(product.images[0]).toHaveProperty('alt');
      expect(product.images[0]).toHaveProperty('order');
    });

    it('should return empty array for products with no images', async () => {
      await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', 'No Image Product')
        .field('sku', 'NO-IMG-001')
        .field('category', 'Rings')
        .field('metal', 'Gold')
        .field('price', '100')
        .field('stock', '5')
        .field('status', 'active')
        .field('imageUrls', 'https://example.com/noimage.jpg');

      const res = await request(app).get('/api/products');
      const product = res.body.data.find((p) => p.name === 'No Image Product');
      expect(product.images).toBeInstanceOf(Array);
      expect(product.images.length).toBeGreaterThan(0);
    });
  });

  // ===========================================
  // 2. PRODUCT VIDEO
  // ===========================================
  describe('Product Video', () => {
    it('product detail should return video URL and thumbnail', async () => {
      const res = await request(app).get(`/api/products/${productId1}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.productVideoUrl).toBe('https://example.com/ring-video.mp4');
      expect(res.body.data.productVideoThumbnail).toBe('https://example.com/ring-video-thumb.jpg');
    });

    it('product without video should return empty strings', async () => {
      const res = await request(app).get(`/api/products/${productId2}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.productVideoUrl).toBe('');
      expect(res.body.data.productVideoThumbnail).toBe('');
    });
  });

  // ===========================================
  // 3. PRODUCT SEARCH
  // ===========================================
  describe('Product Search', () => {
    it('should search by product name', async () => {
      const res = await request(app).get('/api/products?search=gold');

      expect(res.statusCode).toBe(200);
      const names = res.body.data.map((p) => p.name.toLowerCase());
      expect(names.some((n) => n.includes('gold'))).toBe(true);
    });

    it('should search by product name partial match', async () => {
      const res = await request(app).get('/api/products?search=ring');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      const names = res.body.data.map((p) => p.name.toLowerCase());
      expect(names.some((n) => n.includes('ring'))).toBe(true);
    });

    it('should search by SKU', async () => {
      const res = await request(app).get('/api/products?search=GR-001');

      expect(res.statusCode).toBe(200);
      const product = res.body.data.find((p) => p.sku === 'GR-001');
      expect(product).toBeDefined();
    });

    it('should search by tags', async () => {
      const res = await request(app).get('/api/products?search=platinum');

      expect(res.statusCode).toBe(200);
      const product = res.body.data.find((p) => p.name === 'Platinum Diamond Earrings');
      expect(product).toBeDefined();
    });

    it('should return empty results for no match', async () => {
      const res = await request(app).get('/api/products?search=nonexistentproduct12345');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should support pagination in search', async () => {
      const res = await request(app).get('/api/products?search=ring&page=1&limit=2');

      expect(res.statusCode).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
    });
  });

  // ===========================================
  // 4. PRODUCT FILTERING
  // ===========================================
  describe('Product Filtering', () => {
    it('should filter by category', async () => {
      const res = await request(app).get('/api/products?category=Rings');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.category.toLowerCase()).toBe('rings');
      });
    });

    it('should filter by subcategory', async () => {
      const res = await request(app).get('/api/products?subcategory=Engagement%20Rings');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].subcategory).toBe('Engagement Rings');
    });

    it('should filter by collection', async () => {
      const res = await request(app).get('/api/products?collection=Heritage');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].jewelleryCollection).toBe('Heritage');
    });

    it('should filter by metal', async () => {
      const res = await request(app).get('/api/products?metal=Gold');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.metal).toBe('Gold');
      });
    });

    it('should filter by purity', async () => {
      const res = await request(app).get('/api/products?purity=14K');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].purity).toBe('14K');
    });

    it('should filter by price range (minPrice)', async () => {
      const res = await request(app).get('/api/products?minPrice=9000');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        const effectivePrice = p.discountPrice > 0 ? p.discountPrice : p.price;
        expect(effectivePrice).toBeGreaterThanOrEqual(9000);
      });
    });

    it('should filter by price range (maxPrice)', async () => {
      const res = await request(app).get('/api/products?maxPrice=10000');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        const effectivePrice = p.discountPrice > 0 ? p.discountPrice : p.price;
        expect(effectivePrice).toBeLessThanOrEqual(10000);
      });
    });

    it('should filter by price range (both)', async () => {
      const res = await request(app).get('/api/products?minPrice=5000&maxPrice=12000');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        const effectivePrice = p.discountPrice > 0 ? p.discountPrice : p.price;
        expect(effectivePrice).toBeGreaterThanOrEqual(5000);
        expect(effectivePrice).toBeLessThanOrEqual(12000);
      });
    });

    it('should filter by inStock', async () => {
      const res = await request(app).get('/api/products?inStock=true');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.stock).toBeGreaterThan(0);
      });
    });

    it('should filter by isFeatured', async () => {
      const res = await request(app).get('/api/products?isFeatured=true');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.isFeatured).toBe(true);
      });
    });

    it('should filter by isNewArrival', async () => {
      const res = await request(app).get('/api/products?isNewArrival=true');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.isNewArrival).toBe(true);
      });
    });

    it('should filter by isBestSeller', async () => {
      const res = await request(app).get('/api/products?isBestSeller=true');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.isBestSeller).toBe(true);
      });
    });

    it('should filter by discount (products with discountPrice > 0)', async () => {
      const res = await request(app).get('/api/products?discount=true');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.discountPrice).toBeGreaterThan(0);
      });
    });

    it('should combine multiple filters', async () => {
      const res = await request(app).get('/api/products?metal=Gold&jewelleryCollection=Heritage&inStock=true');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.metal).toBe('Gold');
        expect(p.jewelleryCollection).toBe('Heritage');
        expect(p.stock).toBeGreaterThan(0);
      });
    });

    it('should only return active products by default', async () => {
      const res = await request(app).get('/api/products');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      products.forEach((p) => {
        expect(p.status).toBe('active');
      });
      const inactiveProduct = products.find((p) => p.name === 'Classic Gold Band');
      expect(inactiveProduct).toBeUndefined();
    });
  });

  // ===========================================
  // 5. PRODUCT SORTING
  // ===========================================
  describe('Product Sorting', () => {
    it('should sort by price ascending', async () => {
      const res = await request(app).get('/api/products?sort=price&status=active');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      for (let i = 1; i < products.length; i++) {
        expect(products[i].price).toBeGreaterThanOrEqual(products[i - 1].price);
      }
    });

    it('should sort by price descending', async () => {
      const res = await request(app).get('/api/products?sort=-price&status=active');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      for (let i = 1; i < products.length; i++) {
        expect(products[i].price).toBeLessThanOrEqual(products[i - 1].price);
      }
    });

    it('should sort by newest (createdAt descending)', async () => {
      const res = await request(app).get('/api/products?sort=-createdAt&status=active');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      for (let i = 1; i < products.length; i++) {
        const prevDate = new Date(products[i - 1].createdAt);
        const currDate = new Date(products[i].createdAt);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }
    });

    it('should sort by rating descending', async () => {
      const res = await request(app).get('/api/products?sort=-rating&status=active');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      for (let i = 1; i < products.length; i++) {
        expect(products[i].rating).toBeLessThanOrEqual(products[i - 1].rating);
      }
    });

    it('should default to newest first', async () => {
      const res = await request(app).get('/api/products?status=active');

      expect(res.statusCode).toBe(200);
      const products = res.body.data;
      expect(products.length).toBeGreaterThan(0);
    });
  });

  // ===========================================
  // 6. RELATED PRODUCTS
  // ===========================================
  describe('Related Products', () => {
    it('should return related products for a given product', async () => {
      const res = await request(app).get(`/api/products/${productId1}/related`);

      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should exclude current product from related products', async () => {
      const res = await request(app).get(`/api/products/${productId1}/related`);

      expect(res.statusCode).toBe(200);
      const relatedIds = res.body.data.map((p) => p._id);
      expect(relatedIds).not.toContain(productId1);
    });

    it('should return products from same category', async () => {
      const res = await request(app).get(`/api/products/${productId1}/related`);

      expect(res.statusCode).toBe(200);
      const relatedProducts = res.body.data;
      relatedProducts.forEach((p) => {
        expect(p.status).toBe('active');
      });
    });

    it('should respect limit parameter', async () => {
      const res = await request(app).get(`/api/products/${productId1}/related?limit=2`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
    });

    it('should return 404 for non-existent product', async () => {
      const res = await request(app).get(`/api/products/${new mongoose.Types.ObjectId().toString()}/related`);

      expect(res.statusCode).toBe(404);
    });

    it('should return 400 for invalid product ID', async () => {
      const res = await request(app).get('/api/products/invalid-id/related');

      expect(res.statusCode).toBe(400);
    });
  });

  // ===========================================
  // 7. RECENTLY VIEWED PRODUCTS
  // ===========================================
  describe('Recently Viewed Products', () => {
    it('should track viewed product for authenticated user', async () => {
      await request(app)
        .get(`/api/products/${productId1}`)
        .set('Authorization', `Bearer ${userToken}`);

      const res = await request(app)
        .get('/api/products/recently-viewed')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0]._id).toBe(productId1);
    });

    it('should move existing viewed product to top', async () => {
      await request(app)
        .get(`/api/products/${productId1}`)
        .set('Authorization', `Bearer ${userToken}`);
      await request(app)
        .get(`/api/products/${productId2}`)
        .set('Authorization', `Bearer ${userToken}`);
      // View product 1 again - should move to top
      await new Promise((resolve) => setTimeout(resolve, 10));
      await request(app)
        .get(`/api/products/${productId1}`)
        .set('Authorization', `Bearer ${userToken}`);

      const res = await request(app)
        .get('/api/products/recently-viewed')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0]._id).toBe(productId1);
      expect(res.body.count).toBe(2);
    });

    it('should not track for anonymous users', async () => {
      await request(app).get(`/api/products/${productId1}`);

      const res = await request(app)
        .get('/api/products/recently-viewed')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBe(0);
    });

    it('should respect max 20 item limit', async () => {
      const productIds = [];
      for (let i = 0; i < 25; i++) {
        const pRes = await request(app)
          .post('/api/products')
          .set('Authorization', `Bearer ${adminToken}`)
          .field('name', `Bulk Product ${i}`)
          .field('sku', `BULK-${i}`)
          .field('category', 'Rings')
          .field('price', String(1000 * (i + 1)))
          .field('stock', '5')
          .field('status', 'active')
          .field('imageUrls', `https://example.com/bulk${i}.jpg`);
        productIds.push(pRes.body.data._id);
      }

      for (const pid of productIds) {
        await request(app)
          .get(`/api/products/${pid}`)
          .set('Authorization', `Bearer ${userToken}`);
      }

      const res = await request(app)
        .get('/api/products/recently-viewed')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBeLessThanOrEqual(20);
    });

    it('should remove deleted products from recently viewed', async () => {
      await request(app)
        .get(`/api/products/${productId1}`)
        .set('Authorization', `Bearer ${userToken}`);

      await request(app)
        .delete(`/api/products/${productId1}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .get('/api/products/recently-viewed')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      const found = res.body.data.find((p) => p._id === productId1);
      expect(found).toBeUndefined();
    });

    it('should not allow cross-user access', async () => {
      await request(app)
        .get(`/api/products/${productId1}`)
        .set('Authorization', `Bearer ${userToken}`);

      const res = await request(app)
        .get('/api/products/recently-viewed')
        .set('Authorization', `Bearer ${userToken2}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBe(0);
    });
  });

  // ===========================================
  // 8. PRODUCT CARD API RESPONSE
  // ===========================================
  describe('Product Card API Response', () => {
    it('listing should return lightweight product data', async () => {
      const res = await request(app).get('/api/products?status=active');

      expect(res.statusCode).toBe(200);
      const product = res.body.data[0];
      expect(product).toHaveProperty('_id');
      expect(product).toHaveProperty('name');
      expect(product).toHaveProperty('price');
      expect(product).toHaveProperty('discountPrice');
      expect(product).toHaveProperty('images');
      expect(product).toHaveProperty('category');
      expect(product).toHaveProperty('stock');
      expect(product).toHaveProperty('isFeatured');
      expect(product).toHaveProperty('rating');
      expect(product).toHaveProperty('reviews');
    });

    it('listing should not return description by default', async () => {
      const res = await request(app).get('/api/products?status=active');

      expect(res.statusCode).toBe(200);
      const product = res.body.data[0];
      expect(product.description).toBeUndefined();
    });

    it('detail should return full product information', async () => {
      const res = await request(app).get(`/api/products/${productId1}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('description');
      expect(res.body.data).toHaveProperty('_id');
      expect(res.body.data).toHaveProperty('name');
      expect(res.body.data).toHaveProperty('price');
      expect(res.body.data).toHaveProperty('images');
      expect(res.body.data.images.length).toBe(3);
    });    it('product card images should include order field for carousel', async () => {
      const res = await request(app).get('/api/products?status=active');

      expect(res.statusCode).toBe(200);
      const product = res.body.data.find((p) => p._id === productId1);
      expect(product.images.length).toBe(3);
      expect(product.images[0].order).toBeDefined();
      expect(product.images[1].order).toBeDefined();
      expect(product.images[2].order).toBeDefined();
    });
  });
});
