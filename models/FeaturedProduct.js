const mongoose = require('mongoose');

const featuredProductSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
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

featuredProductSchema.index({ isActive: 1, sortOrder: 1 });
featuredProductSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('FeaturedProduct', featuredProductSchema);
