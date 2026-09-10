const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const ContactEnquiry = require('../models/ContactEnquiry');

const VALID_DATE_RANGES = {
  today: () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  },
  yesterday: () => {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  },
  'last-7-days': () => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  },
  'last-30-days': () => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  },
  'this-month': () => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  },
  'last-month': () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { start, end };
  },
};

const getDateRange = (req) => {
  const { dateRange, startDate, endDate } = req.query;

  if (startDate && endDate) {
    return {
      start: new Date(startDate),
      end: new Date(endDate),
    };
  }

  if (dateRange && VALID_DATE_RANGES[dateRange.toLowerCase()]) {
    return VALID_DATE_RANGES[dateRange.toLowerCase()]();
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const buildDateQuery = (dateRangeObj) => {
  if (!dateRangeObj) return {};
  return {
    createdAt: {
      $gte: dateRangeObj.start,
      $lte: dateRangeObj.end,
    },
  };
};

exports.getDashboard = asyncHandler(async (req, res) => {
  const dateRangeObj = getDateRange(req);
  const dateQuery = buildDateQuery(dateRangeObj);

  const [
    totalProducts,
    totalCustomers,
    ordersByStatus,
    ordersByPaymentStatus,
    ordersByShippingStatus,
    revenueAgg,
    totalOrdersAgg,
    contactEnquiryStats,
    recentOrders,
    topProductsAgg,
    topCategoriesAgg,
    categorySalesAgg,
    salesTrendAgg,
  ] = await Promise.all([
    Product.countDocuments({}),
    User.countDocuments({ isAdmin: { $ne: true } }),
    Order.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: null,
          new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
          confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          payment_received: { $sum: { $cond: [{ $eq: ['$status', 'payment_received'] }, 1, 0] } },
          processing: { $sum: { $cond: [{ $eq: ['$status', 'processing'] }, 1, 0] } },
          manufacturing: { $sum: { $cond: [{ $eq: ['$status', 'manufacturing'] }, 1, 0] } },
          quality_check: { $sum: { $cond: [{ $eq: ['$status', 'quality_check'] }, 1, 0] } },
          packed: { $sum: { $cond: [{ $eq: ['$status', 'packed'] }, 1, 0] } },
          shipped: { $sum: { $cond: [{ $eq: ['$status', 'shipped'] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          pending_payment: { $sum: { $cond: [{ $eq: ['$status', 'pending_payment'] }, 1, 0] } },
        },
      },
      { $limit: 1 },
    ]),
    Order.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: null,
          pending: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'failed'] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'refunded'] }, 1, 0] } },
          partially_refunded: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'partially_refunded'] }, 1, 0] } },
        },
      },
      { $limit: 1 },
    ]),
    Order.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: null,
          not_shipped: { $sum: { $cond: [{ $eq: ['$shippingStatus', 'not_shipped'] }, 1, 0] } },
          ready_to_ship: { $sum: { $cond: [{ $eq: ['$shippingStatus', 'ready_to_ship'] }, 1, 0] } },
          shipped: { $sum: { $cond: [{ $eq: ['$shippingStatus', 'shipped'] }, 1, 0] } },
          out_for_delivery: { $sum: { $cond: [{ $eq: ['$shippingStatus', 'out_for_delivery'] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$shippingStatus', 'delivered'] }, 1, 0] } },
        },
      },
      { $limit: 1 },
    ]),
    Order.aggregate([
      {
        $match: {
          ...dateQuery,
          status: { $in: ['confirmed', 'payment_received', 'processing', 'manufacturing', 'quality_check', 'packed', 'shipped', 'delivered'] },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalPrice' },
        },
      },
      { $limit: 1 },
    ]),
    Order.countDocuments({ ...dateQuery }),
     ContactEnquiry.aggregate([
      { $match: dateQuery },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
          archived: { $sum: { $cond: [{ $eq: ['$status', 'archived'] }, 1, 0] } },
        },
      },
      { $limit: 1 },
    ]),
    Order.find(dateQuery)
      .sort('-createdAt')
      .limit(10)
      .populate('user', 'name email phone')
      .lean(),
    Order.aggregate([
      {
        $match: {
          ...dateQuery,
          status: { $in: ['confirmed', 'payment_received', 'processing', 'manufacturing', 'quality_check', 'packed', 'shipped', 'delivered'] },
        },
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productInfo',
        },
      },
      { $unwind: '$productInfo' },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$productInfo.name' },
          sku: { $first: '$productInfo.sku' },
          primaryImage: { $first: '$productInfo.primaryImage' },
          quantitySold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.price' },
        },
      },
      { $sort: { quantitySold: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      {
        $match: {
          ...dateQuery,
          status: { $in: ['confirmed', 'payment_received', 'processing', 'manufacturing', 'quality_check', 'packed', 'shipped', 'delivered'] },
        },
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productInfo',
        },
      },
      { $unwind: '$productInfo' },
      {
        $group: {
          _id: '$productInfo.category',
          category: { $first: '$productInfo.category' },
          quantitySold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.price' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),
    Order.aggregate([
      {
        $match: {
          ...dateQuery,
          status: { $in: ['confirmed', 'payment_received', 'processing', 'manufacturing', 'quality_check', 'packed', 'shipped', 'delivered'] },
        },
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productInfo',
        },
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$productInfo.category', 'Uncategorized'] },
          category: { $first: { $ifNull: ['$productInfo.category', 'Uncategorized'] } },
          quantitySold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      {
        $match: {
          ...dateQuery,
          status: { $in: ['confirmed', 'payment_received', 'processing', 'manufacturing', 'quality_check', 'packed', 'shipped', 'delivered'] },
        },
      },
      {
        $project: {
          date: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          revenue: '$totalPrice',
          orderNumber: 1,
        },
      },
      {
        $group: {
          _id: '$date',
          revenue: { $sum: '$revenue' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const statusCounts = ordersByStatus[0] || {};
  const paymentCounts = ordersByPaymentStatus[0] || {};
  const shippingCounts = ordersByShippingStatus[0] || {};
  const revenueResult = revenueAgg[0] || { totalRevenue: 0 };
  const contactStats = contactEnquiryStats[0] || { total: 0, new: 0, read: 0, replied: 0, archived: 0 };

  res.status(200).json({
    success: true,
    dateRange: {
      start: dateRangeObj.start,
      end: dateRangeObj.end,
    },
    data: {
      totalSales: revenueResult.totalRevenue || 0,
      totalOrders: totalOrdersAgg,
      totalProducts,
      totalCustomers,
      pendingOrders: statusCounts.new || 0,
      processingOrders: statusCounts.processing || 0,
      shippedOrders: statusCounts.shipped || 0,
      deliveredOrders: statusCounts.delivered || 0,
      cancelledOrders: statusCounts.cancelled || 0,
      pendingPayments: paymentCounts.pending || 0,
      paidOrders: paymentCounts.paid || 0,
      recentOrders: recentOrders.map((order) => ({
        _id: order._id,
        orderNumber: order.orderNumber,
        invoiceNumber: order.invoiceNumber,
        customer: order.user ? { name: order.user.name, email: order.user.email, phone: order.user.phone } : null,
        totalPrice: order.totalPrice,
        paymentStatus: order.paymentStatus,
        status: order.status,
        shippingStatus: order.shippingStatus,
        createdAt: order.createdAt,
      })),
       topSellingProducts: topProductsAgg,
       topCategories: topCategoriesAgg,
       categorySales: categorySalesAgg,
       salesTrend: salesTrendAgg,
      contactEnquiries: {
        total: contactStats.total || 0,
        new: contactStats.new || 0,
        read: contactStats.read || 0,
        replied: contactStats.replied || 0,
        archived: contactStats.archived || 0,
      },
      orderStatusCounts: statusCounts,
      paymentStatusCounts: paymentCounts,
      shippingStatusCounts: shippingCounts,
    },
  });
});
