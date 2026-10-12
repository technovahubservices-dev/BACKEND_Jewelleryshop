const mongoose = require('mongoose');

const accessoryCategorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Accessory category name is required'],
      unique: true,
      trim: true,
      maxlength: [100, 'Accessory category name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    image: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

accessoryCategorySchema.index({ isActive: 1 });

module.exports = mongoose.model('AccessoryCategory', accessoryCategorySchema);
