const mongoose = require('mongoose');

const accessoryImageSchema = mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    alt: {
      type: String,
      default: '',
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const accessoryProductSchema = mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AccessoryCategory',
      required: [true, 'Accessory category is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Accessory product name is required'],
      trim: true,
      maxlength: [150, 'Accessory product name cannot exceed 150 characters'],
    },
    slug: {
      type: String,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Stock cannot be negative'],
    },
    brand: {
      type: String,
      default: '',
      trim: true,
      maxlength: [100, 'Brand cannot exceed 100 characters'],
    },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    images: {
      type: [accessoryImageSchema],
      default: [],
    },
    primaryImage: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'draft'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

accessoryProductSchema.index({ name: 1 });
accessoryProductSchema.index({ category: 1, status: 1 });
accessoryProductSchema.index({ slug: 1 });

accessoryProductSchema.pre('save', async function (next) {
  try {
    if (!this.slug && this.name) {
      const baseSlug = this.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'accessory-product';

      let slug = baseSlug;
      let counter = 1;

      while (
        await mongoose.models.AccessoryProduct.exists({
          slug,
          _id: { $ne: this._id },
        })
      ) {
        counter += 1;
        slug = `${baseSlug}-${counter}`;
      }

      this.slug = slug;
    }

    if (Array.isArray(this.images)) {
      this.images = this.images
        .filter((img) => img && img.url)
        .map((img, index) => ({
          url: img.url,
          alt: img.alt || '',
          order: img.order !== undefined ? img.order : index,
        }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    if (this.images.length > 0 && !this.primaryImage) {
      this.primaryImage = this.images[0].url || '';
    }

    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('AccessoryProduct', accessoryProductSchema);
