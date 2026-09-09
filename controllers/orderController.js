const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const { streamInvoiceToResponse } = require('../services/invoiceService');
const { sendOrderConfirmationEmail, sendOrderStatusNotificationEmail } = require('../services/mailer');

const ORDER_POPULATE = [
  { path: 'user', select: 'name email phone' },
  { path: 'items.product' },
  { path: 'quotationId', select: 'quotationNumber status' },
];

const buildOrderResponse = (order) => {
  const plain = typeof order?.toObject === 'function'
    ? order.toObject()
    : { ...order };

  const items = (plain.items || []).map((item) => {
    const product = typeof item.product === 'object' && item.product ? item.product : {};
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    const discountPercent = Number(item.discount) || 0;
    const gstPercent = Number(item.gst) || 18;
    const gross = price * qty;
    const discountAmount = gross * (discountPercent / 100);
    const taxableValue = Math.max(0, gross - discountAmount);
    const gstAmount = taxableValue * (gstPercent / 100);
    const lineTotal = Number.isFinite(Number(item.lineTotal))
      ? Number(item.lineTotal)
      : (taxableValue + gstAmount);

    return {
      product: item.product,
      name: item.name,
      image: item.image,
      sku: item.sku || (product && product.sku) || '',
      price: price,
      quantity: qty,
      discount: discountPercent,
      gst: gstPercent,
      lineTotal,
    };
  });

  return {
    _id: plain._id,
    orderNumber: plain.orderNumber || '',
    invoiceNumber: plain.invoiceNumber || '',
    user: plain.user,
    items,
    shippingAddress: plain.shippingAddress,
    billingAddress: plain.billingAddress || plain.shippingAddress,
    paymentMethod: plain.paymentMethod || 'cod',
    itemsPrice: plain.itemsPrice || 0,
    taxPrice: plain.taxPrice || 0,
    shippingPrice: plain.shippingPrice || 0,
    discount: plain.discount || 0,
    totalPrice: plain.totalPrice || 0,
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
    deliveredAt: plain.deliveredAt,
    estimatedDeliveryDate: plain.estimatedDeliveryDate,
    statusHistory: plain.statusHistory || [],
    quotationId: plain.quotationId,
    paymentGateway: plain.paymentGateway,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

const sendOrderEmailSafe = async (order) => {
  try {
    await sendOrderConfirmationEmail(order);
  } catch (err) {
    console.error('[orderController] Failed to send order confirmation email:', err.message);
  }
};

exports.createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, paymentMethod, itemsPrice, taxPrice, shippingPrice, totalPrice, discount, idempotencyKey } = req.body;

  if (idempotencyKey) {
    const existingOrder = await Order.findOne({ idempotencyKey });
    if (existingOrder) {
      await Order.populate(existingOrder, ORDER_POPULATE);
      return res.status(200).json({
        success: true,
        message: 'Order already exists',
        data: buildOrderResponse(existingOrder),
      });
    }
  }

  if (!items || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Order must contain at least one item',
    });
  }

  if (!shippingAddress || !shippingAddress.fullName || !shippingAddress.address || !shippingAddress.city || !shippingAddress.state) {
    return res.status(400).json({
      success: false,
      message: 'Shipping address is required',
    });
  }

  const orderItems = [];
  let calculatedItemsPrice = 0;

  for (const item of items) {
    if (!item.product || !mongoose.Types.ObjectId.isValid(item.product)) {
      return res.status(400).json({
        success: false,
        message: `Invalid product ID format: ${item.product}`,
      });
    }

    const product = await Product.findById(item.product);
    if (!product) {
      return res.status(400).json({
        success: false,
        message: `Product not found: ${item.product}`,
      });
    }

    if (product.stock < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`,
      });
    }

    const price = product.discountPrice && product.discountPrice > 0
      ? product.discountPrice
      : product.price;

    const lineTotal = price * item.quantity;
    calculatedItemsPrice += lineTotal;

    orderItems.push({
      product: product._id,
      name: item.name || product.name,
      image: item.image || product.primaryImage || (product.images && product.images[0] && (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url)) || '',
      sku: product.sku || '',
      price: price,
      quantity: item.quantity,
      discount: item.discount || 0,
      gst: item.gst !== undefined ? item.gst : 18,
      lineTotal,
    });
  }

  const userId = req.user && mongoose.Types.ObjectId.isValid(req.user._id)
    ? req.user._id
    : undefined;

  const isPrepaid = paymentMethod && paymentMethod !== 'cod';
  const calculatedTotalPrice = calculatedItemsPrice + (Number(taxPrice) || 0) + (Number(shippingPrice) || 0) - (Number(discount) || 0);

  const order = await Order.create({
    user: userId,
    items: orderItems,
    shippingAddress: {
      fullName: shippingAddress.fullName,
      phone: shippingAddress.phone || '',
      address: shippingAddress.address,
      landmark: shippingAddress.landmark || '',
      city: shippingAddress.city,
      state: shippingAddress.state,
      pincode: shippingAddress.pincode || '',
    },
    billingAddress: shippingAddress.billingAddress
      ? {
          fullName: shippingAddress.billingAddress.fullName,
          phone: shippingAddress.billingAddress.phone || '',
          address: shippingAddress.billingAddress.address,
          landmark: shippingAddress.billingAddress.landmark || '',
          city: shippingAddress.billingAddress.city,
          state: shippingAddress.billingAddress.state,
          pincode: shippingAddress.billingAddress.pincode || '',
        }
      : undefined,
    paymentMethod: paymentMethod || 'cod',
    itemsPrice: calculatedItemsPrice,
    taxPrice: Number(taxPrice) || 0,
    shippingPrice: Number(shippingPrice) || 0,
    discount: Number(discount) || 0,
    totalPrice: calculatedTotalPrice,
    isPaid: false,
    status: isPrepaid ? 'pending_payment' : 'new',
    paymentStatus: 'pending',
    shippingStatus: 'not_shipped',
    idempotencyKey: idempotencyKey || undefined,
    statusHistory: [
      {
        status: isPrepaid ? 'pending_payment' : 'new',
        timestamp: new Date(),
        note: isPrepaid ? 'Order awaiting payment' : 'Order placed',
        updatedBy: userId,
      },
    ],
  });

  if (!isPrepaid) {
    for (const item of orderItems) {
      if (item.product && mongoose.Types.ObjectId.isValid(item.product)) {
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: -item.quantity } },
          { new: true }
        );
      }
    }
  }

  await Order.populate(order, ORDER_POPULATE);

  sendOrderEmailSafe(order).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    data: buildOrderResponse(order),
  });
});

exports.getMyOrders = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status, sortBy = '-createdAt' } = req.query;

  const query = { user: userId };

  if (status) {
    query.status = status;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const skip = (pageNum - 1) * limitNum;

  const validSortFields = ['-createdAt', 'createdAt', '-updatedAt', 'updatedAt', '-totalPrice', 'totalPrice', '-orderNumber', 'orderNumber', 'status'];
  const sortOption = validSortFields.includes(sortBy) ? sortBy : '-createdAt';

  const [orders, total] = await Promise.all([
    Order.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .populate(ORDER_POPULATE),
    Order.countDocuments(query),
  ]);

  const pages = Math.ceil(total / limitNum);

  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    page: pageNum,
    pages,
    hasMore: pageNum < pages,
    data: orders.map(buildOrderResponse),
  });
});

exports.getOrders = asyncHandler(async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no user',
    });
  }

  let query = {};

  if (!req.user.isAdmin) {
    query.user = req.user._id;
  }

  const { status, paymentStatus, shippingStatus, search, sort = '-createdAt', startDate, endDate, page = 1, limit = 20 } = req.query;

  if (status) {
    query.status = status;
  }

  if (paymentStatus) {
    query.paymentStatus = paymentStatus;
  }

  if (shippingStatus) {
    query.shippingStatus = shippingStatus;
  }

  if (search) {
    const searchTerm = String(search).trim();
    if (searchTerm) {
      const User = require('../models/User');
      const matchingUserIds = await User.find(
        { $or: [{ name: { $regex: searchTerm, $options: 'i' } }, { email: { $regex: searchTerm, $options: 'i' } }] },
        { _id: 1 }
      ).lean();
      const userIds = matchingUserIds.map((u) => u._id);

      const searchRegex = { $regex: searchTerm, $options: 'i' };
      const orConditions = [
        { orderNumber: searchRegex },
        { invoiceNumber: searchRegex },
        { trackingNumber: searchRegex },
        { 'shippingAddress.fullName': searchRegex },
        { 'shippingAddress.phone': searchRegex },
      ];

      if (userIds.length > 0) {
        orConditions.push({ user: { $in: userIds } });
      }

      query.$or = orConditions;
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

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const validSortFields = ['-createdAt', 'createdAt', '-updatedAt', 'updatedAt', 'status', '-status', 'totalPrice', '-totalPrice'];
  const sortOption = validSortFields.includes(sort) ? sort : '-createdAt';

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate(ORDER_POPULATE)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum),
    Order.countDocuments(query),
  ]);

  const pages = Math.ceil(total / limitNum);

  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    page: pageNum,
    pages,
    hasMore: pageNum < pages,
    data: orders.map(buildOrderResponse),
  });
});

exports.getOrder = asyncHandler(async (req, res) => {
  const orderId = req.params.id || req.params.orderId;

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

  if (req.user && order.user && order.user._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to view this order',
    });
  }

  res.status(200).json({
    success: true,
    data: buildOrderResponse(order),
  });
});

exports.getOrderInvoice = asyncHandler(async (req, res) => {
  const orderId = req.params.id || req.params.orderId;

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

  if (req.user && order.user && order.user._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this invoice',
    });
  }

  await streamInvoiceToResponse(order, res);
});

exports.downloadInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order ID',
    });
  }

  const order = await Order.findById(id)
    .populate('user', 'name email')
    .populate('items.product');

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  if (req.user && (order.user && order.user._id.toString() !== req.user._id.toString()) && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to view this order',
    });
  }

  try {
    await streamInvoiceToResponse(order, res);
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate invoice',
      });
    }
  }
});

exports.convertQuotationToOrder = asyncHandler(async (req, res) => {
  const { quotationId } = req.params;
  const { paymentMethod = 'cod', shippingAddress } = req.body;

  if (!mongoose.Types.ObjectId.isValid(quotationId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid quotation ID',
    });
  }

  const Quotation = require('../models/Quotation');
  const quotation = await Quotation.findById(quotationId);

  if (!quotation) {
    return res.status(404).json({
      success: false,
      message: 'Quotation not found',
    });
  }

  if (quotation.status === 'converted') {
    return res.status(400).json({
      success: false,
      message: 'Quotation has already been converted to an order',
    });
  }

  if (quotation.status !== 'accepted') {
    return res.status(400).json({
      success: false,
      message: `Cannot convert quotation with status "${quotation.status}". Only accepted quotations can be converted.`,
    });
  }

  if (!quotation.items || quotation.items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Quotation has no items',
    });
  }

  const orderItems = [];
  let subtotal = 0;
  let totalGst = 0;
  let totalDiscount = 0;

  for (const item of quotation.items) {
    const product = item.product ? await Product.findById(item.product) : null;

    const qty = Math.max(1, Number(item.qty) || Number(item.quantity) || 1);

    if (product && product.stock < qty) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${qty}`,
      });
    }

    const price = Number(item.price) || (product ? product.price : 0);
    const discount = Number(item.discount) || 0;
    const gst = Number(item.gst) || 0;

    const gross = price * qty;
    const discountAmount = gross * (discount / 100);
    const taxableAmount = Math.max(0, gross - discountAmount);
    const gstAmount = taxableAmount * (gst / 100);
    const lineTotal = taxableAmount + gstAmount;

    subtotal += lineTotal;
    totalDiscount += discountAmount;
    totalGst += gstAmount;

    orderItems.push({
      product: item.product || null,
      name: item.productName || item.name || (product ? product.name : ''),
      image: item.image || product?.primaryImage || (product?.images && product.images[0] && (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url)) || '',
      sku: product?.sku || item.sku || '',
      price,
      quantity: qty,
      discount,
      gst,
      lineTotal,
    });
  }

  const itemsPrice = subtotal;
  const taxPrice = totalGst;
  const shippingPrice = 0;
  const totalPrice = itemsPrice + taxPrice + shippingPrice;

  const userId = req.user && mongoose.Types.ObjectId.isValid(req.user._id)
    ? req.user._id
    : undefined;

  const isPrepaid = paymentMethod && paymentMethod !== 'cod';

  const order = await Order.create({
    user: userId,
    quotationId: quotation._id,
    items: orderItems,
    shippingAddress: shippingAddress || {
      fullName: quotation.customer.name,
      address: quotation.customer.address || 'Address not provided',
      city: '',
      state: '',
    },
    paymentMethod: paymentMethod || 'cod',
    itemsPrice,
    taxPrice,
    shippingPrice,
    totalPrice,
    isPaid: false,
    status: isPrepaid ? 'pending_payment' : 'new',
    paymentStatus: 'pending',
    shippingStatus: 'not_shipped',
    statusHistory: [
      {
        status: isPrepaid ? 'pending_payment' : 'new',
        timestamp: new Date(),
        note: 'Order created from quotation',
        updatedBy: userId,
      },
    ],
  });

  if (!isPrepaid) {
    for (const item of orderItems) {
      if (item.product && mongoose.Types.ObjectId.isValid(item.product)) {
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: -item.quantity } },
          { new: true }
        );
      }
    }
  }

  quotation.status = 'converted';
  quotation.orderId = order._id;
  await quotation.save();

  await Order.populate(order, ORDER_POPULATE);

  sendOrderEmailSafe(order).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Order created from quotation successfully',
    data: buildOrderResponse(order),
  });
});

exports.sendOrderStatusNotification = asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const { status, note } = req.body;

  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order ID',
    });
  }

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required',
    });
  }

  const VALID_ORDER_STATUSES = [
    'new', 'confirmed', 'payment_received', 'processing',
    'manufacturing', 'quality_check', 'packed', 'shipped',
    'delivered', 'cancelled', 'pending_payment',
  ];

  if (!VALID_ORDER_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Valid values: ' + VALID_ORDER_STATUSES.join(', '),
    });
  }

  const order = await Order.findById(orderId).populate(ORDER_POPULATE);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  order.status = status;
  order.statusHistory = order.statusHistory || [];
  order.statusHistory.push({
    status,
    timestamp: new Date(),
    note: note || '',
    updatedBy: req.user._id,
  });

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

  await order.save();

  sendOrderStatusNotificationEmail(order, status).catch((err) => {
    console.error('[orderController] Failed to send status notification email:', err.message);
  });

  res.status(200).json({
    success: true,
    message: 'Order status updated',
    data: buildOrderResponse(order),
  });
});
