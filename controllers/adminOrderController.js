const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const { streamInvoiceToResponse } = require('../services/invoiceService');
const { sendOrderStatusNotificationEmail } = require('../services/mailer');

const ORDER_POPULATE = [
  { path: 'user', select: 'name email phone' },
  {
    path: 'items.product',
    select: 'name sku price discountPrice primaryImage images category',
  },
  { path: 'quotationId', select: 'quotationNumber status' },
];

const normalizeStatusValue = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim().toLowerCase();
};

const getSynchronizedShippingStatus = (status) => {
  if (status === 'shipped') return 'shipped';
  if (status === 'delivered') return 'delivered';
  if (status === 'cancelled') return 'not_shipped';
  return '';
};

const buildAdminOrderResponse = (order) => {
  const plain = typeof order?.toObject === 'function'
    ? order.toObject()
    : { ...order };

  const items = (plain.items || []).map((item) => {
    const product = typeof item.product === 'object' && item.product ? item.product : {};
    const primaryImage = product && product.primaryImage
      ? product.primaryImage
      : (product && product.images && product.images[0]
        ? (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url || product.images[0])
        : '');
    const images = product && Array.isArray(product.images)
      ? product.images.map((img) => (typeof img === 'string' ? img : (img.url || img)))
      : [];

    return {
      product: item.product,
      name: item.name || (product && product.name) || '',
      image: item.image || primaryImage || '',
      images,
      sku: item.sku || (product && product.sku) || '',
      price: Number(item.price) || 0,
      quantity: Number(item.quantity) || 0,
      discount: Number(item.discount) || 0,
      gst: Number(item.gst) || 18,
      lineTotal: Number(item.lineTotal) || 0,
    };
  });

  const userObj = plain.user && typeof plain.user === 'object'
    ? {
        _id: plain.user._id,
        name: plain.user.name || '',
        email: plain.user.email || '',
        phone: plain.user.phone || '',
      }
    : plain.user;

  return {
    _id: plain._id,
    orderNumber: plain.orderNumber || '',
    invoiceNumber: plain.invoiceNumber || '',
    user: userObj,
    items,
    itemCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    shippingAddress: plain.shippingAddress,
    billingAddress: plain.billingAddress || plain.shippingAddress,
    paymentMethod: plain.paymentMethod || 'cod',
    itemsPrice: Number(plain.itemsPrice) || 0,
    taxPrice: Number(plain.taxPrice) || 0,
    shippingPrice: Number(plain.shippingPrice) || 0,
    discount: Number(plain.discount) || 0,
    totalPrice: Number(plain.totalPrice) || 0,
    isPaid: plain.isPaid || false,
    paidAt: plain.paidAt,
    isDelivered: plain.isDelivered || false,
    deliveredAt: plain.deliveredAt,
    status: plain.status || 'new',
    paymentStatus: plain.paymentStatus || 'pending',
    shippingStatus: plain.shippingStatus || 'not_shipped',
    trackingNumber: plain.trackingNumber || '',
    courier: plain.courier || '',
    shippedAt: plain.shippedAt,
    estimatedDeliveryDate: plain.estimatedDeliveryDate,
    statusHistory: plain.statusHistory || [],
    paymentGateway: plain.paymentGateway,
    paymentGatewayOrderId: plain.paymentGatewayOrderId || '',
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

exports.adminGetOrders = asyncHandler(async (req, res) => {
  const {
    search,
    status,
    paymentStatus,
    shippingStatus,
    dateRange,
    startDate,
    endDate,
    sortBy = '-createdAt',
    page = 1,
    limit = 20,
  } = req.query;

  const query = {};

  if (search && String(search).trim()) {
    const searchRegex = { $regex: search, $options: 'i' };
    query.$or = [
      { orderNumber: searchRegex },
      { invoiceNumber: searchRegex },
      { 'shippingAddress.fullName': searchRegex },
      { 'billingAddress.fullName': searchRegex },
      { 'shippingAddress.phone': searchRegex },
      { 'billingAddress.phone': searchRegex },
    ];

    const searchObjectId = mongoose.Types.ObjectId.isValid(search)
      ? new mongoose.Types.ObjectId(search)
      : null;

    if (searchObjectId) {
      query.$or.push(
        { _id: searchObjectId },
        { user: searchObjectId }
      );
    }
  }

  if (status) {
    const statusList = Array.isArray(status)
      ? status
      : String(status).split(',').map((s) => s.trim()).filter(Boolean);
    const validStatuses = statusList.filter((s) => Order.VALID_STATUSES.includes(s));
    if (validStatuses.length > 0) {
      query.status = { $in: validStatuses };
    }
  }

  if (paymentStatus) {
    const psList = Array.isArray(paymentStatus)
      ? paymentStatus
      : String(paymentStatus).split(',').map((s) => s.trim()).filter(Boolean);
    const validPs = psList.filter((p) => Order.VALID_PAYMENT_STATUSES.includes(p));
    if (validPs.length > 0) {
      query.paymentStatus = { $in: validPs };
    }
  }

  if (shippingStatus) {
    const ssList = Array.isArray(shippingStatus)
      ? shippingStatus
      : String(shippingStatus).split(',').map((s) => s.trim()).filter(Boolean);
    const validSs = ssList.filter((s) => Order.VALID_SHIPPING_STATUSES.includes(s));
    if (validSs.length > 0) {
      query.shippingStatus = { $in: validSs };
    }
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  const validSortFields = [
    '-createdAt', 'createdAt', '-updatedAt', 'updatedAt',
    'status', '-status', 'totalPrice', '-totalPrice',
    'orderNumber', '-orderNumber',
  ];
  const sortOption = validSortFields.includes(sortBy) ? sortBy : '-createdAt';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate(ORDER_POPULATE)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum),
    Order.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum),
    hasMore: pageNum < Math.ceil(total / limitNum),
    data: orders.map(buildAdminOrderResponse),
  });
});

exports.adminGetOrder = asyncHandler(async (req, res) => {
  const orderId = req.params.id;

  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order ID',
    });
  }

  const order = await Order.findById(orderId).populate(ORDER_POPULATE);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  res.status(200).json({
    success: true,
    data: buildAdminOrderResponse(order),
  });
});

exports.adminUpdateOrderStatus = asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const {
    status: requestStatus,
    orderStatus,
    paymentStatus,
    shippingStatus,
    note,
    trackingNumber,
    courier,
    estimatedDeliveryDate,
  } = req.body;
  const status = normalizeStatusValue(requestStatus || orderStatus);
  const normalizedPaymentStatus = normalizeStatusValue(paymentStatus);
  const normalizedShippingStatus = normalizeStatusValue(shippingStatus);
  const noteText = note !== undefined && note !== null ? String(note) : '';

  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order ID',
    });
  }

  const order = await Order.findById(orderId).populate(ORDER_POPULATE);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  const currentStatus = order.status || 'new';
  const statusChanged = Boolean(status && status !== currentStatus);

  if (status && !Order.VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Valid values: ${Order.VALID_STATUSES.join(', ')}`,
    });
  }

  if (statusChanged && !Order.canTransitionStatus(currentStatus, status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status transition from "${currentStatus}" to "${status}"`,
    });
  }

  if (normalizedPaymentStatus && !Order.VALID_PAYMENT_STATUSES.includes(normalizedPaymentStatus)) {
    return res.status(400).json({
      success: false,
      message: `Invalid payment status. Valid values: ${Order.VALID_PAYMENT_STATUSES.join(', ')}`,
    });
  }

  if (normalizedShippingStatus && !Order.VALID_SHIPPING_STATUSES.includes(normalizedShippingStatus)) {
    return res.status(400).json({
      success: false,
      message: `Invalid shipping status. Valid values: ${Order.VALID_SHIPPING_STATUSES.join(', ')}`,
    });
  }

  const currentStatusShipping = getSynchronizedShippingStatus(currentStatus);
  if (!statusChanged && normalizedShippingStatus && currentStatusShipping && normalizedShippingStatus !== currentStatusShipping) {
    return res.status(400).json({
      success: false,
      message: `Shipping status must remain "${currentStatusShipping}" when order status is "${currentStatus}"`,
    });
  }

  if (statusChanged) {
    order.status = status;
  }

  if (statusChanged || noteText.trim()) {
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: statusChanged ? status : currentStatus,
      timestamp: new Date(),
      note: noteText,
      updatedBy: req.user._id,
    });
  }

  if (statusChanged) {
    if (status === 'shipped') {
      order.shippingStatus = 'shipped';
      order.shippedAt = new Date();
    } else if (status === 'delivered') {
      order.shippingStatus = 'delivered';
      order.deliveredAt = new Date();
      order.isDelivered = true;
    } else if (status === 'cancelled') {
      order.shippingStatus = 'not_shipped';
    }
  }

  if (normalizedPaymentStatus) {
    order.paymentStatus = normalizedPaymentStatus;
  }

  if (trackingNumber !== undefined && trackingNumber !== null) {
    order.trackingNumber = trackingNumber;
  }

  if (courier !== undefined && courier !== null) {
    order.courier = courier;
  }

  if (estimatedDeliveryDate !== undefined && estimatedDeliveryDate !== null) {
    order.estimatedDeliveryDate = new Date(estimatedDeliveryDate);
  }

  const synchronizedShippingStatus = statusChanged ? getSynchronizedShippingStatus(status) : '';
  if (!synchronizedShippingStatus && normalizedShippingStatus) {
    order.shippingStatus = normalizedShippingStatus;
  }

  await order.save();

  if (statusChanged) {
    sendOrderStatusNotificationEmail(order, status).catch((err) => {
      console.error('[adminOrderController] Failed to send status notification email:', err.message);
    });
  }

  res.status(200).json({
    success: true,
    message: 'Order updated successfully',
    data: buildAdminOrderResponse(order),
  });
});

exports.adminDownloadInvoice = asyncHandler(async (req, res) => {
  const orderId = req.params.id;

  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order ID',
    });
  }

  const order = await Order.findById(orderId).populate(ORDER_POPULATE);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  await streamInvoiceToResponse(order, res);
});

exports.adminDeleteOrder = asyncHandler(async (req, res) => {
  const orderId = req.params.id;

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

  const canDelete = ['new', 'cancelled'].includes(order.status);
  if (!canDelete) {
    return res.status(400).json({
      success: false,
      message: `Order cannot be deleted in "${order.status}" status. Only orders with "new" or "cancelled" status can be deleted.`,
    });
  }

  await order.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Order deleted successfully',
  });
});

