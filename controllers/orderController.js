const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

exports.createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, paymentMethod, itemsPrice, taxPrice, shippingPrice, totalPrice, idempotencyKey } = req.body;

  if (idempotencyKey) {
    const existingOrder = await Order.findOne({ idempotencyKey });
    if (existingOrder) {
      await Order.populate(existingOrder, { path: 'items.product' });
      return res.status(200).json({
        success: true,
        message: 'Order already exists',
        data: existingOrder,
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

    orderItems.push({
      product: product._id,
      name: item.name || product.name,
      image: item.image || product.primaryImage || (product.images && product.images[0]) || '',
      price: item.price || product.price,
      quantity: item.quantity || 1,
    });
  }

  const userId = req.user && mongoose.Types.ObjectId.isValid(req.user._id)
    ? req.user._id
    : undefined;

  const isPrepaid = paymentMethod && paymentMethod !== 'cod';

  const order = await Order.create({
    user: userId,
    items: orderItems,
    shippingAddress,
    paymentMethod: paymentMethod || 'cod',
    itemsPrice: itemsPrice || 0,
    taxPrice: taxPrice || 0,
    shippingPrice: shippingPrice || 0,
    totalPrice: totalPrice || 0,
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
      const updatedProduct = await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: -item.quantity } },
        { new: true }
      );
    }
  }

  await Order.populate(order, { path: 'items.product' });

  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    data: order,
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

  const { status, sort = '-createdAt', startDate, endDate } = req.query;

  if (status) {
    query.status = status;
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

  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('items.product')
    .populate('quotationId', 'quotationNumber status')
    .sort(sort);

  res.status(200).json({
    success: true,
    count: orders.length,
    data: orders,
  });
});

exports.getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email')
    .populate('items.product')
    .populate('quotationId', 'quotationNumber status');

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found',
    });
  }

  if (!order.user) {
    return res.status(200).json({
      success: true,
      data: order,
    });
  }

  if (req.user && (order.user._id.toString() !== req.user._id.toString()) && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to view this order',
    });
  }

  res.status(200).json({
    success: true,
    data: order,
  });
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

    if (product) {
      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`,
        });
      }
    }

    const metalRate = Number(item.metalRate) || 0;
    const netWeight = Number(item.netWeight) || 0;
    const makingCharges = Number(item.makingCharges) || 0;
    const wastage = Number(item.wastage) || 0;
    const stoneCharges = Number(item.stoneCharges) || 0;
    const quantity = Number(item.quantity) || 1;
    const discount = Number(item.discount) || 0;
    const gst = Number(item.gst) || 0;

    const metalValue = metalRate * netWeight;
    const lineSubtotal = metalValue + makingCharges + wastage + stoneCharges;
    const taxableAmount = Math.max(0, lineSubtotal - discount);
    const gstAmount = taxableAmount * (gst / 100);

    subtotal += lineSubtotal;
    totalDiscount += discount;
    totalGst += gstAmount;

    orderItems.push({
      product: item.product || null,
      name: item.name,
      image: item.image || product?.primaryImage || (product?.images && product.images[0]) || '',
      price: taxableAmount,
      quantity,
    });
  }

  const itemsPrice = subtotal - totalDiscount;
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
        const product = await Product.findById(item.product);
        if (product) {
          const previousStock = product.stock;
          const updatedProduct = await Product.findByIdAndUpdate(
            item.product,
            { $inc: { stock: -item.quantity } },
            { new: true }
          );
        }
      }
    }
  }

  quotation.status = 'converted';
  quotation.orderId = order._id;
  await quotation.save();

  await Order.populate(order, { path: 'items.product' });
  await Order.populate(order, { path: 'quotationId' });

  res.status(201).json({
    success: true,
    message: 'Order created from quotation successfully',
    data: order,
  });
});
