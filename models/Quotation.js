const mongoose = require('mongoose');

const quotationItemSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    name: { type: String, required: true },
    sku: { type: String, default: '' },
    hsn: { type: String, default: '' },
    metal: { type: String, default: '' },
    purity: { type: String, default: '' },
    grossWeight: { type: String, default: '' },
    netWeight: { type: String, default: '' },
    stoneWeight: { type: String, default: '' },
    stoneType: { type: String, default: '' },
    metalRate: { type: Number, default: 0 },
    makingCharges: { type: Number, default: 0 },
    wastage: { type: Number, default: 0 },
    stoneCharges: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    quantity: { type: Number, required: true, default: 1 },
    discount: { type: Number, default: 0 },
    gst: { type: Number, default: 18 },
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
