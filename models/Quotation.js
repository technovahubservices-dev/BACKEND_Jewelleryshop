const mongoose = require('mongoose');

const quotationItemSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    sku: {
      type: String,
      default: '',
      trim: true,
    },
    qty: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity cannot be negative'],
      default: 1,
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative'],
      max: [100, 'Discount cannot exceed 100'],
    },
    gst: {
      type: Number,
      default: 18,
      min: [0, 'GST cannot be negative'],
      max: [100, 'GST cannot exceed 100'],
    },
    lineTotal: {
      type: Number,
      default: 0,
      min: [0, 'Line total cannot be negative'],
    },
  },
  { _id: true }
);

const customerSchema = mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
  },
  { _id: false }
);

const quotationSchema = mongoose.Schema(
  {
    quotationNumber: { type: String, required: true, unique: true },
    customer: { type: customerSchema, required: true },
    date: { type: Date, default: Date.now },
    validUntil: { type: Date, required: true },
    items: [quotationItemSchema],
    notes: { type: String, default: '' },
    totalAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'],
      default: 'draft',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

quotationSchema.index({ quotationNumber: 1 });
quotationSchema.index({ status: 1 });
quotationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);
