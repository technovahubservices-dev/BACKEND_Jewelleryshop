const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrders,
  getOrder,
  convertQuotationToOrder,
} = require('../controllers/orderController');
const paymentRoutes = require('./paymentRoutes');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getOrders)
  .post(protect, createOrder);

router.route('/convert-from-quotation/:quotationId')
  .post(protect, admin, convertQuotationToOrder);

router.route('/:id')
  .get(protect, getOrder);

router.use('/payment', paymentRoutes);

module.exports = router;
