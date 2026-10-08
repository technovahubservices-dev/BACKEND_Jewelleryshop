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
    address: {
  type: String,
  trim: true,
  maxlength: [500, 'Address cannot exceed 500 characters'],
  default: '',
},
instagramUrl: {
  type: String,
  trim: true,
  default: 'https://instagram.com',
},
instagramUsername: {
  type: String,
  trim: true,
  maxlength: [100, 'Instagram username cannot exceed 100 characters'],
  default: '@jkrjewellery',
},
contactDescription: {
  type: String,
  trim: true,
  maxlength: [1000, 'Contact description cannot exceed 1000 characters'],
  default: 'We would love to hear from you. Reach out for appointments, custom orders, or any questions about our collections.',
},
    currency: {
      type: String,
      trim: true,
      maxlength: [10, 'Currency cannot exceed 10 characters'],
      default: 'INR',
    },
    policies: {
      type: [
        {
          type: {
            type: String,
            enum: [
              'authenticity',
              'purity',
              'returns',
              'exchange',
              'warranty',
              'shipping',
              'care',
              'customisation',
            ],
            required: true,
          },
          title: {
            type: String,
            trim: true,
            maxlength: [200, 'Policy title cannot exceed 200 characters'],
            required: true,
          },
          description: {
            type: String,
            maxlength: [2000, 'Policy description cannot exceed 2000 characters'],
            required: true,
          },
          icon: {
            type: String,
            trim: true,
            maxlength: [100, 'Icon cannot exceed 100 characters'],
          },
          sortOrder: {
            type: Number,
            default: 0,
          },
           isActive: {
            type: Boolean,
            default: true,
          },
          collapsedByDefault: {
            type: Boolean,
            default: false,
          },
        },
      ],
      default: [],
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
