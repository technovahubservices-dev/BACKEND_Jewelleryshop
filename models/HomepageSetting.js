const mongoose = require('mongoose');

const homepageSettingSchema = mongoose.Schema(
  {
    announcementText: {
      type: String,
      trim: true,
      maxlength: [500, 'Announcement text cannot exceed 500 characters'],
      default: 'welcome to jkr. 10% offer earrings! 20% offer Rings!.. 10% offer Necklace!...',
    },
    announcementActive: {
      type: Boolean,
      default: true,
    },
    announcementBgColor: {
      type: String,
      trim: true,
      default: '#013220',
    },
    announcementTextColor: {
      type: String,
      trim: true,
      default: '#ffffff',
    },
    announcementCtaText: {
      type: String,
      trim: true,
    },
    announcementCtaLink: {
      type: String,
      trim: true,
      default: '/shop',
    },
    heroSectionTitle: {
      type: String,
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    heroSectionSubtitle: {
      type: String,
      trim: true,
      maxlength: [500, 'Subtitle cannot exceed 500 characters'],
    },
    heroSectionDescription: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    heroSectionBgImage: {
      type: String,
    },
    heroSectionCtaText: {
      type: String,
      trim: true,
      default: 'Explore Collection',
    },
     heroSectionCtaLink: {
      type: String,
      trim: true,
      default: '/shop',
    },
    heroSectionEnabled: {
      type: Boolean,
      default: true,
    },
    heroSlides: [
      {
        title: { type: String, trim: true, maxlength: [200, 'Slide title cannot exceed 200 characters'] },
        subtitle: { type: String, trim: true, maxlength: [500, 'Slide subtitle cannot exceed 500 characters'] },
        image: { type: String },
        link: { type: String, trim: true },
        isActive: { type: Boolean, default: true },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    promoSectionTitle: {
      type: String,
      trim: true,
    },
    promoSectionSubtitle: {
      type: String,
      trim: true,
    },
    promoSectionBgColor: {
      type: String,
      trim: true,
      default: '#F9F8F6',
    },
    collectionSectionTitle: {
      type: String,
      trim: true,
      default: 'Our Collections',
    },
    featuredSectionTitle: {
      type: String,
      trim: true,
      default: 'Featured Products',
    },
    featuredSectionDescription: {
      type: String,
      trim: true,
    },
    testimonialSectionTitle: {
      type: String,
      trim: true,
      default: 'What Our Patrons Say',
    },
    homepageTestimonials: [
      {
        name: { type: String, required: true, trim: true },
        location: { type: String, trim: true },
        content: { type: String, required: true, maxlength: 2000 },
        rating: { type: Number, min: 1, max: 5, default: 5 },
        image: { type: String },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    categorySectionTitle: {
      type: String,
      trim: true,
      default: 'Shop by Category',
    },
    categorySectionDescription: {
      type: String,
      trim: true,
      maxlength: [500, 'Category section description cannot exceed 500 characters'],
    },
    categories: [
      {
        name: { type: String, required: true, trim: true },
        image: { type: String },
        link: { type: String, trim: true },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    videoSectionTitle: {
      type: String,
      trim: true,
      default: 'Watch & Shop',
    },
    videoSectionDescription: {
      type: String,
      trim: true,
      maxlength: [500, 'Video section description cannot exceed 500 characters'],
    },
      videoReels: [
       {
         title: { type: String, trim: true },
         videoUrl: { type: String },
         thumbnail: { type: String },
         price: { type: String },
         shopLink: { type: String, trim: true },
         sortOrder: { type: Number, default: 0 },
       },
     ],
    hipChainsSectionTitle: {
      type: String,
      trim: true,
      default: 'The Hip Chain Collection',
    },
    hipChainsSectionDescription: {
      type: String,
      trim: true,
    },
    hipChainsCategoryFilter: {
      type: String,
      trim: true,
      default: 'Hip Chain',
    },
    earringsSectionTitle: {
      type: String,
      trim: true,
      default: 'Exquisite Earrings Selection',
    },
    earringsSectionDescription: {
      type: String,
      trim: true,
    },
    earringsCategoryFilter: {
      type: String,
      trim: true,
      default: 'Earrings',
    },
    festiveExclusiveImages: [
      {
        image: { type: String },
        title: { type: String, trim: true },
        link: { type: String, trim: true },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    heritageCollectionImages: [
      {
        image: { type: String },
        title: { type: String, trim: true },
        link: { type: String, trim: true },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    footerText: {
      type: String,
      trim: true,
      maxlength: [500, 'Footer text cannot exceed 500 characters'],
    },
    footerLogoUrl: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

homepageSettingSchema.statics.getSettings = async function () {
  let settings = await this.findOne({});
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('HomepageSetting', homepageSettingSchema);
