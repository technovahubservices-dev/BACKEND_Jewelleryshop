const mongoose = require('mongoose');

const accessorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Accessory name is required'],
      unique: true,
      trim: true,
      maxlength: [100, 'Accessory name cannot exceed 100 characters'],
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
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

accessorySchema.index({ isActive: 1 });

module.exports = mongoose.model('Accessory', accessorySchema);
