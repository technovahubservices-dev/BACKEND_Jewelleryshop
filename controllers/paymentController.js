const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Razorpay = require('razorpay');
const crypto = require('crypto');

let razorpay = null;

const getRazorpayInstance = () => {
  if (!razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay credentials are not configured');
    }
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
};

const createPaymentOrder = asyncHandler(async (req, res) => {
  const { orderId, paymentMethod, gateway = 'razorpay' } = req.body;

  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order ID',
    });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  if (order.user && order.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to create payment for this order',
    });
  }

  if (order.isPaid) {
    return res.status(400).json({
      success: false,
      message: 'Order is already paid',
    });
  }

  if (order.paymentStatus === 'failed' && order.paymentRetryCount >= 3) {
    return res.status(400).json({
      success: false,
      message: 'Maximum payment retries exceeded. Please contact support.',
    });
  }

  const validMethods = ['upi', 'card', 'net_banking'];
  if (!validMethods.includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment method',
    });
  }

  try {
    const razorpayOrder = await getRazorpayInstance().orders.create({
      amount: Math.round(order.totalPrice * 100),
      currency: 'INR',
      receipt: `order_${order._id.toString()}`,
      notes: {
        orderId: order._id.toString(),
        paymentMethod,
        userId: req.user._id.toString(),
      },
    });

    order.paymentGateway = gateway;
    order.paymentGatewayOrderId = razorpayOrder.id;
    order.paymentMethod = paymentMethod;
    order.paymentStatus = 'pending';
    order.status = 'pending_payment';
    order.paymentRetryCount = (order.paymentRetryCount || 0) + 1;
    await order.save();

    res.status(200).json({
      success: true,
      data: {
        gatewayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID,
        prefill: {
          name: req.user.name || '',
          email: req.user.email || '',
          contact: req.user.phone || '',
        },
        orderId: order._id.toString(),
        paymentMethod,
      },
    });
  } catch (error) {
    console.error('Payment order creation error:', error);
    res.status(500).json({
      success: false,
      message: error.message === 'Razorpay credentials are not configured'
        ? 'Payment gateway is not configured'
        : 'Failed to create payment order',
    });
  }
});

const verifyPayment = asyncHandler(async (req, res) => {
  const { orderId, paymentId, signature } = req.body;

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({
      success: false,
      message: 'Missing payment verification details',
    });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  if (order.user && order.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to verify payment for this order',
    });
  }

  if (order.isPaid) {
    return res.status(400).json({
      success: false,
      message: 'Order is already paid',
    });
  }

  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${order.paymentGatewayOrderId}|${paymentId}`)
    .digest('hex');

  if (generatedSignature !== signature) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment signature',
    });
  }

  order.paymentGatewayPaymentId = paymentId;
  order.paymentGatewaySignature = signature;
  order.isPaid = true;
  order.paidAt = new Date();
  order.paymentStatus = 'paid';
  order.status = 'confirmed';

  const previousStatus = order.statusHistory?.[order.statusHistory.length - 1]?.status || 'new';
  order.statusHistory = order.statusHistory || [];
  order.statusHistory.push({
    status: 'payment_received',
    timestamp: new Date(),
    note: 'Payment verified successfully',
    updatedBy: req.user ? req.user._id : undefined,
  });

  await order.save();

  await deductStockForOrder(order);

  res.status(200).json({
    success: true,
    message: 'Payment verified successfully',
    data: order,
  });
});

const retryPayment = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { paymentMethod, gateway = 'razorpay' } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order ID',
    });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  if (order.user && order.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to retry payment for this order',
    });
  }

  if (order.isPaid) {
    return res.status(400).json({
      success: false,
      message: 'Order is already paid',
    });
  }

  if (order.paymentRetryCount >= 3) {
    return res.status(400).json({
      success: false,
      message: 'Maximum payment retries exceeded',
    });
  }

  const validMethods = ['upi', 'card', 'net_banking'];
  if (!validMethods.includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment method',
    });
  }

  try {
    const razorpayOrder = await getRazorpayInstance().orders.create({
      amount: Math.round(order.totalPrice * 100),
      currency: 'INR',
      receipt: `order_${order._id.toString()}_retry_${order.paymentRetryCount + 1}`,
      notes: {
        orderId: order._id.toString(),
        paymentMethod,
        userId: req.user._id.toString(),
        retry: true,
      },
    });

    order.paymentGateway = gateway;
    order.paymentGatewayOrderId = razorpayOrder.id;
    order.paymentMethod = paymentMethod;
    order.paymentStatus = 'pending';
    order.status = 'pending_payment';
    order.paymentRetryCount = (order.paymentRetryCount || 0) + 1;
    order.paymentFailureReason = '';
    await order.save();

    res.status(200).json({
      success: true,
      data: {
        gatewayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID,
        prefill: {
          name: req.user.name || '',
          email: req.user.email || '',
          contact: req.user.phone || '',
        },
        orderId: order._id.toString(),
        paymentMethod,
      },
    });
  } catch (error) {
    console.error('Payment retry error:', error);
    res.status(500).json({
      success: false,
      message: error.message === 'Razorpay credentials are not configured'
        ? 'Payment gateway is not configured'
        : 'Failed to retry payment',
    });
  }
});

const handleWebhook = asyncHandler(async (req, res) => {
  const webhookSignature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({
      success: false,
      message: 'Webhook secret not configured',
    });
  }

  const generatedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (generatedSignature !== webhookSignature) {
    return res.status(400).json({
      success: false,
      message: 'Invalid webhook signature',
    });
  }

  const event = req.body;
  const orderId = event.payload?.order?.entity?.receipt?.replace('order_', '');
  const paymentEntity = event.payload?.payment?.entity;

  if (!orderId) {
    return res.status(200).json({ success: true, message: 'No order ID in webhook' });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(200).json({ success: true, message: 'Order not found' });
  }

  if (event.event === 'payment.captured') {
    if (!order.isPaid) {
      order.paymentGatewayPaymentId = paymentEntity?.id || '';
      order.isPaid = true;
      order.paidAt = new Date();
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: 'payment_received',
        timestamp: new Date(),
        note: 'Payment captured via webhook',
        updatedBy: order.user,
      });
      await order.save();

      await deductStockForOrder(order);
    }
  } else if (event.event === 'payment.failed') {
    order.paymentStatus = 'failed';
    order.paymentFailureReason = paymentEntity?.error_description || 'Payment failed';
    order.status = 'cancelled';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: 'cancelled',
      timestamp: new Date(),
      note: `Payment failed: ${order.paymentFailureReason}`,
      updatedBy: order.user,
    });
    await order.save();
  } else if (event.event === 'payment.cancelled') {
    order.paymentStatus = 'failed';
    order.paymentFailureReason = 'Payment cancelled by user';
    order.status = 'cancelled';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: 'cancelled',
      timestamp: new Date(),
      note: 'Payment cancelled by user',
      updatedBy: order.user,
    });
    await order.save();
  }

  res.status(200).json({ success: true });
});

const deductStockForOrder = async (order) => {
  for (const item of order.items) {
    if (item.product && mongoose.Types.ObjectId.isValid(item.product)) {
      const product = await Product.findById(item.product);
      if (product) {
        product.stock = Math.max(0, product.stock - item.quantity);
        await product.save();
      }
    }
  }
};

module.exports = {
  createPaymentOrder,
  verifyPayment,
  retryPayment,
  handleWebhook,
};
