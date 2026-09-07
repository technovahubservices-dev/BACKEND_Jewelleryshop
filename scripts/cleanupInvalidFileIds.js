const mongoose = require('mongoose');
const dotenv = require('dotenv').config();

const INVALID_FILE_IDS = [];

const KNOWN_URL_PATTERNS = [
  'drive.google.com/uc',
  'drive.google.com/file/',
  'drive.google.com/open',
  'drive.google.com/thumbnail',
];

const isValidDriveFileId = (id) => {
  if (!id || typeof id !== 'string') return false;
  if (INVALID_FILE_IDS.includes(id)) return false;
  if (id.length < 10) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
};

const extractFileIdsFromUrl = (url) => {
  if (!url || typeof url !== 'string') return [];
  const { getGoogleDriveFileId } = require('../utils/googleDriveStorage');
  const fileId = getGoogleDriveFileId(url);
  return fileId ? [fileId] : [];
};

const cleanInvalidMedia = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is not defined');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log('Connected to MongoDB');

  let totalFixed = 0;

  const HomepageSetting = require('../models/HomepageSetting');

  const settings = await HomepageSetting.findOne({});
  if (settings) {
    const doc = typeof settings.toObject === 'function' ? settings.toObject() : settings;
    const updates = {};

    const stringFields = ['heroSectionBgImage', 'footerLogoUrl'];
    for (const field of stringFields) {
      if (doc[field]) {
        const fileIds = extractFileIdsFromUrl(doc[field]);
        for (const fileId of fileIds) {
          if (!isValidDriveFileId(fileId)) {
            console.log(`[HomepageSetting] Invalid fileId "${fileId}" found in ${field}, clearing value`);
            updates[field] = null;
            totalFixed++;
          }
        }
      }
    }

    const reelFields = ['videoUrl', 'thumbnail'];
    if (Array.isArray(doc.videoReels)) {
      const newReels = doc.videoReels.map((reel) => {
        const reelObj = typeof reel.toObject === 'function' ? reel.toObject() : reel;
        const newReel = { ...reelObj };
        let changed = false;

        for (const field of reelFields) {
          const val = newReel[field];
          if (val && typeof val === 'string') {
            const fileIds = extractFileIdsFromUrl(val);
            for (const fileId of fileIds) {
              if (!isValidDriveFileId(fileId)) {
                console.log(`[HomepageSetting] Invalid fileId "${fileId}" in videoReels.${field}, clearing`);
                newReel[field] = '';
                newReel.videoMetadata = {
                  ...newReel.videoMetadata,
                  driveFileId: null,
                  invalid: true,
                };
                changed = true;
                totalFixed++;
              }
            }
          }
        }

        return changed ? newReel : reel;
      });

      if (totalFixed > 0) {
        updates.videoReels = newReels;
      }
    }

    const slideFields = ['image', 'mobileImage', 'link'];
    if (Array.isArray(doc.heroSlides)) {
      const newSlides = doc.heroSlides.map((slide) => {
        const slideObj = typeof slide.toObject === 'function' ? slide.toObject() : slide;
        const newSlide = { ...slideObj };
        let changed = false;

        for (const field of slideFields) {
          const val = newSlide[field];
          if (val && typeof val === 'string') {
            const fileIds = extractFileIdsFromUrl(val);
            for (const fileId of fileIds) {
              if (!isValidDriveFileId(fileId)) {
                console.log(`[HomepageSetting] Invalid fileId "${fileId}" in heroSlides.${field}, clearing`);
                newSlide[field] = '';
                changed = true;
                totalFixed++;
              }
            }
          }
        }

        return changed ? newSlide : slide;
      });

      if (totalFixed > 0) {
        updates.heroSlides = newSlides;
      }
    }

    const imageArrayFields = ['homepageTestimonials', 'categories', 'festiveExclusiveImages', 'heritageCollectionImages'];
    for (const arrayKey of imageArrayFields) {
      if (Array.isArray(doc[arrayKey])) {
        const newArray = doc[arrayKey].map((item) => {
          const itemObj = typeof item.toObject === 'function' ? item.toObject() : item;
          const newItem = { ...itemObj };
          let changed = false;

          const imageFields = ['image', 'mobileImage', 'thumbnail'];
          for (const field of imageFields) {
            const val = newItem[field];
            if (val && typeof val === 'string') {
              const fileIds = extractFileIdsFromUrl(val);
              for (const fileId of fileIds) {
                if (!isValidDriveFileId(fileId)) {
                  console.log(`[HomepageSetting] Invalid fileId "${fileId}" in ${arrayKey}.${field}, clearing`);
                  newItem[field] = '';
                  changed = true;
                  totalFixed++;
                }
              }
            }
          }

          return changed ? newItem : item;
        });

        if (totalFixed > 0) {
          updates[arrayKey] = newArray;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await HomepageSetting.updateOne({ _id: settings._id }, { $set: updates });
      console.log(`[HomepageSetting] Updated ${totalFixed} invalid media reference(s).`);
    } else {
      console.log('[HomepageSetting] No invalid file IDs found.');
    }
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
        if (val && typeof val === 'string') {
          const fileIds = extractFileIdsFromUrl(val);
          for (const fileId of fileIds) {
            if (!isValidDriveFileId(fileId)) {
              console.log(`[${modelName}] Invalid fileId "${fileId}" in ${doc._id}.${field}, clearing`);
              updates[field] = null;
              totalFixed++;
            }
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await Model.updateOne({ _id: doc._id }, { $set: updates });
      }
    }
  }

  if (totalFixed > 0) {
    console.log(`Total: ${totalFixed} invalid media reference(s) cleaned.`);
  } else {
    console.log('No invalid file IDs found in any content.');
  }

  await mongoose.disconnect();
};

cleanInvalidMedia().catch((err) => {
  console.error('Cleanup error:', err.message);
  process.exit(1);
});
