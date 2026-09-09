const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const ContactEnquiry = require('../models/ContactEnquiry');

const DATE_PERIODS = {
  today: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { startDate: start, endDate: end };
  },
  yesterday: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { startDate: start, endDate: end };
  },
  week: () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startDate: start, endDate: end };
  },
  month: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { startDate: start, endDate: end };
  },
  last_month: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { startDate: start, endDate: end };
  },
  last_30_days: () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startDate: start, endDate: end };
  },
};

const getLowStockThreshold = async () => {
  try {
    return 10;
  } catch {
    return 10;
  }
};

exports.getAnalytics = asyncHandler(async (req, res) => {
  const { period = 'week', startDate, endDate } = req.query;

  let dateQuery = {};

  if (period === 'custom' && startDate && endDate) {
    dateQuery = {
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  } else if (DATE_PERIODS[period]) {
    const { startDate: ds, endDate: de } = DATE_PERIODS[period]();
    dateQuery = {
      createdAt: {
        $gte: ds,
        $lte: de,
      },
    };
  }

  const orderQuery = { ...dateQuery };
  const productQuery = {};

  const [
    allOrders,
    productsResult,
    totalCustomers,
    totalProducts,
  ] = await Promise.all([
    Order.find(orderQuery).sort('-createdAt').lean(),
    Product.find(productQuery).sort('-createdAt').lean(),
    User.countDocuments({}),
    Product.countDocuments(productQuery),
  ]);

  const totalProductsData = productsResult || [];
  const lowStockThreshold = 5;
  const lowStockProducts = totalProductsData.filter(
    (p) => (p.stock || 0) < lowStockThreshold
  );

  const totalSales = allOrders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
  const totalOrders = allOrders.length;

  const statusCounts = {};
  const paymentStatusCounts = {};
  const shippingStatusCounts = {};

  allOrders.forEach((o) => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    paymentStatusCounts[o.paymentStatus] = (paymentStatusCounts[o.paymentStatus] || 0) + 1;
    shippingStatusCounts[o.shippingStatus] = (shippingStatusCounts[o.shippingStatus] || 0) + 1;
  });

  const pendingOrders = statusCounts['pending_payment'] + (statusCounts['new'] || 0) + (statusCounts['confirmed'] || 0) || 0;
  const pendingPayments = statusCounts['pending_payment'] || 0;
  const activeOrders = totalOrders - (statusCounts['delivered'] || 0) - (statusCounts['cancelled'] || 0);
  const deliveredOrders = statusCounts['delivered'] || 0;
  const cancelledOrders = statusCounts['cancelled'] || 0;

  const inventoryValue = totalProductsData.reduce(
    (sum, p) => sum + (Number(p.price) || 0) * (Number(p.stock) || 0),
    0
  );

  const { startDate: periodStart, endDate: periodEnd } =
    period === 'custom'
      ? { startDate: new Date(startDate), endDate: new Date(endDate) }
      : DATE_PERIODS[period]();

  const chartData = [];
  const daysDiff = Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24));
  const step = daysDiff <= 7 ? 1 : Math.ceil(daysDiff / 30);

  for (let d = new Date(periodStart); d <= periodEnd; d.setDate(d.getDate() + step)) {
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

    const dayOrders = allOrders.filter(
      (o) => new Date(o.createdAt) >= dayStart && new Date(o.createdAt) < dayEnd
    );

    const dayRevenue = dayOrders.reduce(
      (sum, o) => sum + (Number(o.totalPrice) || 0),
      0
    );

    chartData.push({
      date: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue: dayRevenue,
      count: dayOrders.length,
    });
  }

  const productSalesMap = {};
  allOrders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const pid = typeof item.product === 'object' ? item.product._id : item.product;
      if (!pid) return;
      const key = pid.toString();
      if (!productSalesMap[key]) {
        const product = totalProductsData.find(
          (p) => p._id.toString() === key
        );
        productSalesMap[key] = {
          _id: pid,
          name: item.name || product?.name || 'Unknown Product',
          image: item.image || product?.primaryImage || (product?.images?.[0]?.url) || '',
          sku: item.sku || product?.sku || '',
          quantity: 0,
          revenue: 0,
        };
      }
      productSalesMap[key].quantity += Number(item.quantity) || 0;
      productSalesMap[key].revenue += Number(item.price) * Number(item.quantity) || 0;
    });
  });

  const topProducts = Object.values(productSalesMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const categorySalesMap = {};
  allOrders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const product = typeof item.product === 'object' ? item.product : null;
      const cat = product?.category || item.category || 'Other';
      if (!categorySalesMap[cat]) {
        categorySalesMap[cat] = { name: cat, revenue: 0, count: 0 };
      }
      const lineRevenue = Number(item.price) * Number(item.quantity) || 0;
      categorySalesMap[cat].revenue += lineRevenue;
      categorySalesMap[cat].count += Number(item.quantity) || 0;
    });
  });

  const topCategories = Object.values(categorySalesMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  const recentOrders = allOrders
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber,
      user: order.user || null,
      items: order.items || [],
      itemsPrice: order.itemsPrice || 0,
      taxPrice: order.taxPrice || 0,
      shippingPrice: order.shippingPrice || 0,
      discount: order.discount || 0,
      totalPrice: order.totalPrice || 0,
      status: order.status || 'new',
      paymentStatus: order.paymentStatus || 'pending',
      shippingStatus: order.shippingStatus || 'not_shipped',
      shippingAddress: order.shippingAddress || {},
      paymentMethod: order.paymentMethod || 'cod',
      trackingNumber: order.trackingNumber || '',
      courier: order.courier || '',
      createdAt: order.createdAt,
      statusHistory: order.statusHistory || [],
      isPaid: order.isPaid || false,
      isDelivered: order.isDelivered || false,
    }));

  res.status(200).json({
    success: true,
    data: {
      kpis: {
        totalSales,
        totalOrders,
        totalCustomers,
        totalProducts,
        inventoryValue,
        lowStockItems: lowStockProducts.length,
        pendingOrders,
        pendingPayments,
        activeOrders,
        deliveredOrders: statusCounts['delivered'] || 0,
        cancelledOrders: statusCounts['cancelled'] || 0,
        inProgressOrders: statusCounts['processing'] || 0,
        shippedOrders: statusCounts['shipped'] || 0,
      },
      statusBreakdown: statusCounts,
      paymentStatusBreakdown: paymentStatusCounts,
      shippingStatusBreakdown: shippingStatusCounts,
      chartData,
      topProducts,
      topCategories,
      recentOrders,
      lowStockProducts: lowStockProducts
        .sort((a, b) => (a.stock || 0) - (b.stock || 0))
        .slice(0, 10)
        .map((p) => ({
          _id: p._id,
          name: p.name,
          sku: p.sku || '',
          stock: p.stock || 0,
          minimumStock: p.minimumStock || 5,
          reservedStock: p.reservedStock || 0,
          price: p.price || 0,
          primaryImage: p.primaryImage || '',
          images: p.images || [],
          category: p.category || '',
        })),
      period: period,
      dateRange: {
        startDate: periodStart,
        endDate: periodEnd,
      },
    },
  });
});

exports.getOrderStatusCounts = asyncHandler(async (req, res) => {
  const statuses = Order.VALID_STATUSES;

  const counts = await Order.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const statusCounts = {};
  statuses.forEach((s) => {
    statusCounts[s] = 0;
  });
  counts.forEach((c) => {
    statusCounts[c._id] = c.count;
  });

  res.status(200).json({
    success: true,
    data: statusCounts,
  });
});
