const mongoose = require('mongoose');
const dotenv = require('dotenv').config();

const connectDB = require('../config/db');

const repairHomepageMediaUrls = async () => {
  await connectDB();

  const HomepageSetting = mongoose.model('HomepageSetting');

  const {
    getGoogleDriveFileId,
    buildProxyMediaUrl,
    normalizeGoogleDriveUrl,
  } = require('../utils/googleDriveStorage');

  const urlToPublicUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    const fileId = getGoogleDriveFileId(url);
    if (!fileId) return url;
    return buildProxyMediaUrl(fileId);
  };

  let modified = 0;

  const settings = await HomepageSetting.findOne({});
  if (!settings) {
    console.log('No HomepageSetting document found.');
    return;
  }

  const doc = typeof settings.toObject === 'function' ? settings.toObject() : settings;
  const updates = {};

  if (doc.heroSectionBgImage && typeof doc.heroSectionBgImage === 'string') {
    const newUrl = normalizeGoogleDriveUrl(doc.heroSectionBgImage);
    if (newUrl !== doc.heroSectionBgImage) {
      updates.heroSectionBgImage = newUrl;
    }
  }

  if (Array.isArray(doc.videoReels)) {
    let reelsChanged = false;
    const newReels = doc.videoReels.map((reel) => {
      const reelObj = typeof reel.toObject === 'function' ? reel.toObject() : reel;
      let changed = false;
      const newReel = { ...reelObj };

      if (newReel.videoUrl && typeof newReel.videoUrl === 'string') {
        const fixed = normalizeGoogleDriveUrl(newReel.videoUrl);
        if (fixed !== newReel.videoUrl) {
          newReel.videoUrl = fixed;
          changed = true;
        }
      }

      if (newReel.thumbnail && typeof newReel.thumbnail === 'string' && !newReel.thumbnail.startsWith('https://placehold.co')) {
        const fixed = normalizeGoogleDriveUrl(newReel.thumbnail);
        if (fixed !== newReel.thumbnail) {
          newReel.thumbnail = fixed;
          changed = true;
        }
      }

      if (changed) {
        reelsChanged = true;
      }
      return newReel;
    });

    if (reelsChanged) {
      updates.videoReels = newReels;
    }
  }

  if (Array.isArray(doc.heroSlides)) {
    let slidesChanged = false;
    const newSlides = doc.heroSlides.map((slide) => {
      const slideObj = typeof slide.toObject === 'function' ? slide.toObject() : slide;
      let changed = false;
      const newSlide = { ...slideObj };

      if (newSlide.image && typeof newSlide.image === 'string') {
        const fixed = normalizeGoogleDriveUrl(newSlide.image);
        if (fixed !== newSlide.image) {
          newSlide.image = fixed;
          changed = true;
        }
      }

      if (newSlide.link && typeof newSlide.link === 'string') {
        const fixed = urlToPublicUrl(newSlide.link);
        if (fixed !== newSlide.link) {
          newSlide.link = fixed;
          changed = true;
        }
      }

      if (changed) {
        slidesChanged = true;
      }
      return newSlide;
    });

    if (slidesChanged) {
      updates.heroSlides = newSlides;
    }
  }

  const stringImageFields = ['heroSectionBgImage'];
  for (const field of stringImageFields) {
    if (doc[field] && typeof doc[field] === 'string' && doc[field].includes('drive.google.com')) {
      const fixed = normalizeGoogleDriveUrl(doc[field]);
      if (fixed !== doc[field]) {
        updates[field] = fixed;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    console.log('[Repair] Updating HomepageSetting with normalized URLs:', Object.keys(updates));
    const result = await HomepageSetting.updateOne({ _id: settings._id }, { $set: updates });
    modified++;
    console.log('[Repair] HomepageSetting updated:', result.nModified, 'fields changed');
  }

  const contentModels = [
    { name: 'HeroBanner', imageFields: ['image', 'mobileImage'] },
    { name: 'Collection', imageFields: ['image'] },
    { name: 'FeaturedProduct', imageFields: ['image'] },
    { name: 'PromoBanner', imageFields: ['image'] },
    { name: 'Testimonial', imageFields: ['image'] },
    { name: 'Blog', imageFields: ['image'] },
  ];

  for (const { name: modelName, imageFields } of contentModels) {
    const Model = mongoose.model(modelName);
    const docs = await Model.find({});

    for (const doc of docs) {
      const updates = {};
      for (const field of imageFields) {
        const val = doc[field];
        if (val && typeof val === 'string' && val.includes('drive.google.com')) {
          const fixed = normalizeGoogleDriveUrl(val);
          if (fixed !== val) {
            updates[field] = fixed;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        console.log(`[Repair] ${modelName} ${doc._id}: fixing image URLs`);
        await Model.updateOne({ _id: doc._id }, { $set: updates });
        modified++;
      }
    }
  }

  if (modified > 0) {
    console.log(`[Repair] Database repaired: ${modified} document(s) updated.`);
  } else {
    console.log('[Repair] No stale media URLs found. Database is clean.');
  }

  await mongoose.disconnect();
};

repairHomepageMediaUrls().catch((err) => {
  console.error('Repair error:', err.message);
  process.exit(1);
});
