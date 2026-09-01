const mongoose = require('mongoose');

const storeSettingSchema = mongoose.Schema(
  {
    storeName: {
      type: String,
      trim: true,
      maxlength: [120, 'Store name cannot exceed 120 characters'],
      default: 'JKR',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
      default: 'support@jkr.com',
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [30, 'Phone cannot exceed 30 characters'],
      default: '+1 (555) 019-8234',
    },
    currency: {
      type: String,
      trim: true,
      maxlength: [10, 'Currency cannot exceed 10 characters'],
      default: 'INR',
    },
  },
  {
    timestamps: true,
  }
);

storeSettingSchema.statics.getSettings = async function () {
  let settings = await this.findOne({});
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('StoreSetting', storeSettingSchema);
