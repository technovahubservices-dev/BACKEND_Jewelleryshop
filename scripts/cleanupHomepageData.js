const mongoose = require('mongoose');
const dotenv = require('dotenv').config();

const STALE_VALUES = ['Updated Title', 'Explore Collection'];

const cleanStaleHomepageData = async () => {
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

  const HomepageSetting = require('../models/HomepageSetting');

  let changed = false;
  const settings = await HomepageSetting.findOne({});
  if (!settings) {
    console.log('No HomepageSetting document found. Nothing to clean.');
    await mongoose.disconnect();
    return;
  }

  const isStale = (val) => typeof val === 'string' && STALE_VALUES.some(
    (s) => val.toLowerCase().includes(s.toLowerCase())
  );

  if (isStale(settings.heroSectionTitle)) {
    console.log('Removing stale heroSectionTitle:', settings.heroSectionTitle);
    settings.heroSectionTitle = undefined;
    changed = true;
  }

  if (isStale(settings.heroSectionSubtitle)) {
    console.log('Removing stale heroSectionSubtitle:', settings.heroSectionSubtitle);
    settings.heroSectionSubtitle = undefined;
    changed = true;
  }

  if (isStale(settings.heroSectionDescription)) {
    console.log('Removing stale heroSectionDescription:', settings.heroSectionDescription);
    settings.heroSectionDescription = undefined;
    changed = true;
  }

  let slidesChanged = false;
  if (Array.isArray(settings.heroSlides)) {
    settings.heroSlides = settings.heroSlides.filter((slide) => {
      if (isStale(slide.title) || isStale(slide.subtitle)) {
        console.log('Removing stale heroSlide:', slide.title, slide.subtitle);
        slidesChanged = true;
        return false;
      }
      return true;
    });
  }

  let videoReelsChanged = false;
  if (Array.isArray(settings.videoReels)) {
    settings.videoReels = settings.videoReels.filter((reel) => {
      if (isStale(reel.title)) {
        console.log('Removing stale videoReel:', reel.title);
        videoReelsChanged = true;
        return false;
      }
      return true;
    });
  }

  changed = changed || slidesChanged || videoReelsChanged;

  if (changed) {
    await settings.save();
    console.log('Stale homepage data cleaned successfully.');
  } else {
    console.log('No stale data found. Database is clean.');
  }

  await mongoose.disconnect();
};

cleanStaleHomepageData().catch((err) => {
  console.error('Cleanup error:', err.message);
  process.exit(1);
});
