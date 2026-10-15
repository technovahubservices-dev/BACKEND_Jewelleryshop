const express = require('express');
const router = express.Router();
const {
  createPaymentOrder,
  getPaymentStatus,
  verifyPayment,
  retryPayment,
  handleWebhook,
} = require('../controllers/paymentController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/create-payment-order')
  .post(protect, createPaymentOrder);

router.route('/status/:id')
  .get(protect, getPaymentStatus);

router.route('/verify-payment')
  .post(protect, verifyPayment);

router.route('/:id/retry-payment')
  .post(protect, retryPayment);

router.route('/webhook/razorpay')
  .post(express.raw({ type: 'application/json' }), handleWebhook);

module.exports = router;
