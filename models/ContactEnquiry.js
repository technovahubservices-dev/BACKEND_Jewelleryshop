const mongoose = require('mongoose');

const contactEnquirySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [120, 'Name cannot exceed 120 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      maxlength: [5000, 'Message cannot exceed 5000 characters'],
    },
    routedTo: {
      type: String,
      trim: true,
      lowercase: true,
    },
    delivered: {
      type: Boolean,
      default: false,
    },
    deliveryError: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['new', 'read', 'replied', 'archived'],
      default: 'new',
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    adminNote: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

contactEnquirySchema.index({ createdAt: -1 });
contactEnquirySchema.index({ status: 1, createdAt: -1 });
contactEnquirySchema.index({ email: 1 });

module.exports = mongoose.model('ContactEnquiry', contactEnquirySchema);
