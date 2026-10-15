const Order = require('../models/Order');
const Cart = require('../models/Cart');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { sendOrderConfirmationEmail, sendOrderStatusNotificationEmail } = require('../services/mailer');
const {
  buildOrderItems,
  deductStockForOrder,
  restoreStockForOrder,
} = require('../utils/orderProductResolver');

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

const deductOrderStockOnce = async (order) => {
  if (order.stockDeducted) return false;

  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      stockDeducted: { $ne: true },
      stockDeductionInProgress: { $ne: true },
    },
    { $set: { stockDeductionInProgress: true } },
    { new: true }
  );

  if (!claimedOrder) {
    const latestOrder = await Order.findById(order._id).select('stockDeducted stockDeductionInProgress');
    if (latestOrder?.stockDeducted) {
      order.stockDeducted = true;
      return false;
    }
    const error = new Error('Inventory confirmation is already in progress. Please retry shortly.');
    error.statusCode = 409;
    throw error;
  }

  let inventoryApplied = false;
  try {
    await deductStockForOrder(claimedOrder);
    inventoryApplied = true;
    const updateResult = await Order.updateOne(
      { _id: order._id, stockDeductionInProgress: true },
      { $set: { stockDeducted: true, stockDeductionInProgress: false } }
    );
    const modifiedCount = updateResult.modifiedCount !== undefined
      ? updateResult.modifiedCount
      : updateResult.nModified;
    if (modifiedCount !== 1) {
      throw new Error('Unable to save payment inventory status');
    }
    order.stockDeducted = true;
    return true;
  } catch (error) {
    if (inventoryApplied) await restoreStockForOrder(claimedOrder);
    await Order.updateOne(
      { _id: order._id, stockDeductionInProgress: true },
      { $set: { stockDeductionInProgress: false, stockDeducted: false } }
    );
    throw error;
  }
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

  try {
    // Inventory may have changed after the prepaid order was created.
    await buildOrderItems(order.items || []);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Unable to confirm product availability',
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

  if (
    order.paymentGatewayOrderId &&
    order.paymentStatus === 'pending' &&
    order.paymentGateway === gateway &&
    order.paymentMethod === paymentMethod
  ) {
    try {
      const providerPayments = await getRazorpayInstance().orders.fetchPayments(order.paymentGatewayOrderId);
      const payments = providerPayments.items || [];
      const activePayment = payments.find((payment) => ['created', 'authorized', 'captured'].includes(payment.status));

      if (activePayment) {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_STILL_PENDING',
          message: 'The existing payment is still being processed. Please check its status before retrying.',
        });
      }

      if (payments.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            gatewayOrderId: order.paymentGatewayOrderId,
            amount: Math.round(order.totalPrice * 100),
            currency: 'INR',
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
      }

      if (payments.length && payments.every((payment) => payment.status === 'failed')) {
        order.paymentStatus = 'failed';
        order.paymentFailureReason = payments[payments.length - 1].error_description || 'Payment failed';
        await order.save();
      } else {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_STATUS_UNKNOWN',
          message: 'Payment status could not be confirmed. Please check again before retrying.',
        });
      }
    } catch (error) {
      console.error('Payment status lookup error:', error);
      return res.status(503).json({
        success: false,
        code: 'PAYMENT_STATUS_UNKNOWN',
        message: 'Payment status could not be confirmed. Please check again before retrying.',
      });
    }
  }

  try {
    const razorpayOrder = await getRazorpayInstance().orders.create({
      amount: Math.round(order.totalPrice * 100),
      currency: 'INR',
      receipt: order.paymentRetryCount
        ? `order_${order._id.toString()}_retry_${order.paymentRetryCount + 1}`
        : `order_${order._id.toString()}`,
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
    order.paymentFailureReason = '';
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

const getPaymentStatus = asyncHandler(async (req, res) => {
  const { id: orderId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ success: false, message: 'Invalid order ID' });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user && order.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorized to check payment for this order' });
  }

  if (order.isPaid || order.paymentStatus === 'paid') {
    return res.status(200).json({ success: true, data: { paymentStatus: 'paid', orderId: order._id.toString() } });
  }

  if (!order.paymentGatewayOrderId) {
    return res.status(200).json({ success: true, data: { paymentStatus: 'not_started', orderId: order._id.toString() } });
  }

  try {
    const providerPayments = await getRazorpayInstance().orders.fetchPayments(order.paymentGatewayOrderId);
    const payments = providerPayments.items || [];
    const activePayment = payments.find((payment) => ['created', 'authorized', 'captured'].includes(payment.status));

    if (activePayment) {
      return res.status(200).json({
        success: true,
        data: {
          paymentStatus: 'pending',
          gatewayStatus: activePayment.status,
          orderId: order._id.toString(),
        },
      });
    }

    if (payments.length && payments.every((payment) => payment.status === 'failed')) {
      order.paymentStatus = 'failed';
      order.paymentFailureReason = payments[payments.length - 1].error_description || 'Payment failed';
      await order.save();
      return res.status(200).json({ success: true, data: { paymentStatus: 'failed', orderId: order._id.toString() } });
    }

    if (payments.length === 0) {
      return res.status(200).json({ success: true, data: { paymentStatus: 'not_started', orderId: order._id.toString() } });
    }

    return res.status(200).json({ success: true, data: { paymentStatus: 'unknown', orderId: order._id.toString() } });
  } catch (error) {
    console.error('Payment status lookup error:', error);
    return res.status(503).json({
      success: false,
      code: 'PAYMENT_STATUS_UNKNOWN',
      message: 'Payment status could not be confirmed. Please check again before retrying.',
      data: { paymentStatus: 'unknown', orderId: order._id.toString() },
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

  if (!order.paymentGatewayOrderId || !['upi', 'card', 'net_banking'].includes(order.paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: 'Payment order has not been initialized',
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

  const stockDeductedNow = await deductOrderStockOnce(order);

  const previousStatus = order.statusHistory?.[order.statusHistory.length - 1]?.status || 'new';
  order.paymentGatewayPaymentId = paymentId;
  order.paymentGatewaySignature = signature;
  order.isPaid = true;
  order.paidAt = new Date();
  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  order.statusHistory = order.statusHistory || [];
  order.statusHistory.push({
    status: 'payment_received',
    timestamp: new Date(),
    note: 'Payment verified successfully',
    updatedBy: req.user ? req.user._id : undefined,
  });

  try {
    await order.save();
  } catch (error) {
    const savedOrder = await Order.findById(order._id).select('isPaid');
    if (stockDeductedNow && !savedOrder?.isPaid) {
      await restoreStockForOrder(order);
      order.stockDeducted = false;
      await Order.updateOne({ _id: order._id, isPaid: { $ne: true } }, {
        $set: { stockDeducted: false },
      });
    }
    throw error;
  }

  if (order.user) {
    await Cart.updateOne({ user: order.user }, { $set: { items: [] } });
  }

  const populatedOrder = await Order.populate(order, [
    { path: 'items.product' },
    { path: 'user', select: 'name email phone' },
  ]);

  if (populatedOrder.user) {
    sendOrderConfirmationEmail(populatedOrder).catch((err) => {
      console.error('[paymentController] Failed to send order confirmation email:', err.message);
    });
    sendOrderStatusNotificationEmail(populatedOrder, 'confirmed').catch((err) => {
      console.error('[paymentController] Failed to send status email:', err.message);
    });
  }

  res.status(200).json({
    success: true,
    message: 'Payment verified successfully',
    data: populatedOrder,
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

  if (order.paymentGatewayOrderId) {
    try {
      const providerPayments = await getRazorpayInstance().orders.fetchPayments(order.paymentGatewayOrderId);
      const payments = providerPayments.items || [];
      const activePayment = payments.find((payment) => ['created', 'authorized', 'captured'].includes(payment.status));
      if (activePayment) {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_STILL_PENDING',
          message: 'The existing payment is still being processed. Please check its status before retrying.',
        });
      }
      if (payments.length && !payments.every((payment) => payment.status === 'failed')) {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_STATUS_UNKNOWN',
          message: 'Payment status could not be confirmed. Please check again before retrying.',
        });
      }
    } catch (error) {
      console.error('Payment retry status lookup error:', error);
      return res.status(503).json({
        success: false,
        code: 'PAYMENT_STATUS_UNKNOWN',
        message: 'Payment status could not be confirmed. Please check again before retrying.',
      });
    }
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
  const receipt = event.payload?.order?.entity?.receipt || '';
  const orderId = receipt.startsWith('order_')
    ? receipt.slice('order_'.length).split('_retry_')[0]
    : '';
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
      const stockDeductedNow = await deductOrderStockOnce(order);
      try {
        await order.save();
      } catch (error) {
        const savedOrder = await Order.findById(order._id).select('isPaid');
        if (stockDeductedNow && !savedOrder?.isPaid) {
          await restoreStockForOrder(order);
          order.stockDeducted = false;
          await Order.updateOne({ _id: order._id, isPaid: { $ne: true } }, {
            $set: { stockDeducted: false },
          });
        }
        throw error;
      }

      if (order.user) {
        await Cart.updateOne({ user: order.user }, { $set: { items: [] } });
      }

      const populatedOrder = await Order.populate(order, [
        { path: 'items.product' },
        { path: 'user', select: 'name email phone' },
      ]);

      if (populatedOrder.user) {
        sendOrderConfirmationEmail(populatedOrder).catch((err) => {
          console.error('[paymentController] Webhook: Failed to send order confirmation email:', err.message);
        });
      }
    }
  } else if (
    event.event === 'payment.failed' &&
    !order.isPaid &&
    paymentEntity?.order_id === order.paymentGatewayOrderId
  ) {
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
  } else if (
    event.event === 'payment.cancelled' &&
    !order.isPaid &&
    paymentEntity?.order_id === order.paymentGatewayOrderId
  ) {
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

module.exports = {
  createPaymentOrder,
  getPaymentStatus,
  verifyPayment,
  retryPayment,
  handleWebhook,
};
