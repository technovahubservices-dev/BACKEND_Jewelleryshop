const mongoose = require('mongoose');

const productSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [100, 'Product name cannot exceed 100 characters'],
    },
    sku: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      maxlength: [50, 'SKU cannot exceed 50 characters'],
    },
    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
    },
    description: {
      type: String,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    price: {
      type: Number,
      min: [0, 'Price cannot be negative'],
    },
    discountPrice: {
      type: Number,
      default: 0,
      validate: {
        validator: function (v) {
          if (v === undefined || v === null || v === 0) return true;
          return v < this.price;
        },
        message: 'Discount price must be less than the regular price',
      },
    },
    stock: {
      type: Number,
      min: [0, 'Stock cannot be negative'],
      default: 0,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    subcategory: {
      type: String,
      enum: [
        'Engagement Rings',
        'Wedding Bands',
        'Cocktail Rings',
        'Promise Rings',
        'Diamond Necklaces',
        'Gold Chains',
        'Pendant Sets',
        'Diamond Earrings',
        'Gold Earrings',
        'Hoop Earrings',
        'Stud Earrings',
        'Bracelets',
        'Bangles',
        'Cuffs',
        'Chain Bracelets',
      ],
    },
    jewelleryCollection: {
      type: String,
      enum: [
        'Heritage',
        'Eternal',
        'Blossom',
        'Celeste',
        'Aura',
        'New Arrival',
        'Best Seller',
      ],
    },
    metal: {
      type: String,
      enum: ['Gold', 'Silver', 'Platinum', 'Rose Gold', 'White Gold'],
    },
    purity: {
      type: String,
      enum: ['10K', '14K', '18K', '22K', '24K', '950PT', 'Sterling Silver'],
    },
    weight: {
      type: String,
    },
    diamondWeight: {
      type: String,
    },
    diamondShape: {
      type: String,
      enum: [
        'Round',
        'Princess',
        'Emerald',
        'Cushion',
        'Oval',
        'Pear',
        'Marquise',
        'Asscher',
        'Radiant',
        'Heart',
        'Baguette',
        'N/A',
      ],
    },
    diamondClarity: {
      type: String,
      enum: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'N/A'],
    },
    diamondColor: {
      type: String,
      enum: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'GHI', 'DEF', 'SI', 'N/A'],
    },
    images: [
      {
        type: String,
        required: true,
      },
    ],
    primaryImage: {
      type: String,
      default: '',
    },
    tags: [String],
    status: {
      type: String,
      enum: ['active', 'inactive', 'draft'],
      default: 'active',
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isBestSeller: {
      type: Boolean,
      default: false,
    },
    isNewArrival: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
      min: [0, 'Rating cannot be negative'],
      max: [5, 'Rating cannot exceed 5'],
    },
    reviews: {
      type: Number,
      default: 0,
      min: [0, 'Reviews cannot be negative'],
    },
    reservedStock: {
      type: Number,
      default: 0,
      min: [0, 'Reserved stock cannot be negative'],
    },
    minimumStock: {
      type: Number,
      default: 5,
      min: [0, 'Minimum stock cannot be negative'],
    },
    availableWeight: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

productSchema.index({ name: 1 });
productSchema.index({ category: 1 });
productSchema.index({ status: 1 });
productSchema.index({ isFeatured: 1 });

productSchema.pre('save', function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  if (this.images && this.images.length > 0 && !this.primaryImage) {
    this.primaryImage = this.images[0];
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
