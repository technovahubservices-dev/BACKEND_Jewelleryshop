const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrders,
  getOrder,
  getMyOrders,
  getOrderInvoice,
  convertQuotationToOrder,
  sendOrderStatusNotification,
} = require('../controllers/orderController');
const paymentRoutes = require('./paymentRoutes');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getOrders)
  .post(protect, createOrder);

router.get('/my-orders', protect, getMyOrders);

router.route('/convert-from-quotation/:quotationId')
  .post(protect, admin, convertQuotationToOrder);

router.route('/:id')
  .get(protect, getOrder);

router.get('/:id/invoice', protect, getOrderInvoice);

router.put('/:id/status', protect, admin, sendOrderStatusNotification);

router.use('/payment', paymentRoutes);

module.exports = router;
