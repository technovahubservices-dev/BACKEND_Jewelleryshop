const mongoose = require('mongoose');

const heroBannerSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    subtitle: {
      type: String,
      trim: true,
      maxlength: [500, 'Subtitle cannot exceed 500 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    image: {
      type: String,
      required: [true, 'Image is required'],
    },
    mobileImage: {
      type: String,
    },
    ctaText: {
      type: String,
      trim: true,
      default: 'View Collection',
    },
    ctaLink: {
      type: String,
      trim: true,
      default: '/shop',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

heroBannerSchema.index({ isActive: 1, sortOrder: 1 });
heroBannerSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('HeroBanner', heroBannerSchema);
