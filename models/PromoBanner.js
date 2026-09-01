const mongoose = require('mongoose');

const promoBannerSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    image: {
      type: String,
    },
    ctaText: {
      type: String,
      trim: true,
      default: 'Shop Now',
    },
    ctaLink: {
      type: String,
      trim: true,
      default: '/shop',
    },
    position: {
      type: String,
      enum: ['top', 'bottom', 'sidebar', 'featured'],
      default: 'top',
    },
    bgColor: {
      type: String,
      trim: true,
      default: '#F9F8F6',
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

promoBannerSchema.index({ isActive: 1, sortOrder: 1 });
promoBannerSchema.index({ position: 1, isActive: 1 });
promoBannerSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('PromoBanner', promoBannerSchema);
