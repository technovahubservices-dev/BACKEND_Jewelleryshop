const mongoose = require('mongoose');

const orderItemSchema = mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: { type: String, required: true },
  image: { type: String },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, default: 1 },
}, { _id: false });

const shippingAddressSchema = mongoose.Schema({
  fullName: { type: String, required: true },
  pincode: { type: String },
  address: { type: String, required: true },
  landmark: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
}, { _id: false });

const orderSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    items: [orderItemSchema],
    shippingAddress: shippingAddressSchema,
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

module.exports = mongoose.model('Order', orderSchema);
