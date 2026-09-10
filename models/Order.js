const mongoose = require('mongoose');

const orderItemSchema = mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: { type: String, required: true },
  image: { type: String },
  sku: { type: String, default: '' },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, default: 1 },
  discount: { type: Number, default: 0 },
  gst: { type: Number, default: 18 },
  lineTotal: { type: Number, default: 0 },
}, { _id: false });

const addressSchema = mongoose.Schema({
  fullName: { type: String, required: true },
  phone: { type: String, default: '' },
  address: { type: String, required: true },
  landmark: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String },
}, { _id: false });

const orderSchema = mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    invoiceNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    items: [orderItemSchema],
    shippingAddress: addressSchema,
    billingAddress: addressSchema,
    paymentMethod: {
      type: String,
      enum: ['cod', 'upi', 'card', 'net_banking'],
      default: 'cod',
    },
    itemsPrice: { type: Number, required: true },
    taxPrice: { type: Number, default: 0 },
    shippingPrice: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true },
    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: {
      type: Date,
    },
    isDelivered: {
      type: Boolean,
      default: false,
    },
    deliveredAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['new', 'confirmed', 'payment_received', 'processing', 'manufacturing', 'quality_check', 'packed', 'shipped', 'delivered', 'cancelled', 'pending_payment'],
      default: 'new',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
    },
    shippingStatus: {
      type: String,
      enum: ['not_shipped', 'ready_to_ship', 'shipped', 'out_for_delivery', 'delivered'],
      default: 'not_shipped',
    },
    trackingNumber: {
      type: String,
      default: '',
    },
    courier: {
      type: String,
      default: '',
    },
    shippedAt: {
      type: Date,
    },
    estimatedDeliveryDate: {
      type: Date,
    },
    statusHistory: [{
      status: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      note: { type: String, default: '' },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    quotationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quotation',
      default: null,
    },
    paymentGateway: {
      type: String,
      enum: ['razorpay', 'phonepe', 'stripe', 'paytm', null],
      default: null,
    },
    paymentGatewayOrderId: {
      type: String,
      default: '',
    },
    paymentGatewayPaymentId: {
      type: String,
      default: '',
    },
    paymentGatewaySignature: {
      type: String,
      default: '',
    },
    paymentFailureReason: {
      type: String,
      default: '',
    },
    paymentRetryCount: {
      type: Number,
      default: 0,
      min: 0,
      max: 3,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ user: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ invoiceNumber: 1 });

const OrderCounter = require('./OrderCounter');

orderSchema.pre('validate', async function (next) {
  if (!this.orderNumber) {
    const year = new Date().getFullYear();
    const counter = await OrderCounter.findOneAndUpdate(
      { _id: `order-${year}` },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );
    this.orderNumber = `ORD-${year}-${String(counter.sequence).padStart(6, '0')}`;
  }
  if (!this.invoiceNumber) {
    const year = new Date().getFullYear();
    const counter = await OrderCounter.findOneAndUpdate(
      { _id: `invoice-${year}` },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );
    this.invoiceNumber = `INV-${year}-${String(counter.sequence).padStart(6, '0')}`;
  }
  next();
});

const STATUS_DISPLAY_NAMES = {
  pending_payment: 'Pending Payment',
  new: 'New',
  confirmed: 'Confirmed',
  payment_received: 'Payment Received',
  processing: 'Processing',
  manufacturing: 'Manufacturing',
  quality_check: 'Quality Check',
  packed: 'Packed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

orderSchema.statics.getStatusDisplayName = function (status) {
  return STATUS_DISPLAY_NAMES[status] || (status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown');
};

orderSchema.statics.VALID_STATUSES = [
  'new', 'confirmed', 'payment_received', 'processing',
  'manufacturing', 'quality_check', 'packed', 'shipped',
  'delivered', 'cancelled', 'pending_payment',
];

orderSchema.statics.VALID_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'];
orderSchema.statics.VALID_SHIPPING_STATUSES = ['not_shipped', 'ready_to_ship', 'shipped', 'out_for_delivery', 'delivered'];

module.exports = mongoose.model('Order', orderSchema);
