const express = require('express');

const router = express.Router();

const {
  adminGetOrders,
  adminGetOrder,
  adminUpdateOrderStatus,
  adminDownloadInvoice,
  adminDeleteOrder,
} = require('../controllers/adminOrderController');

const {
  protect,
  admin,
} = require('../middleware/authMiddleware');

router
  .route('/')
  .get(protect, admin, adminGetOrders);

router
  .route('/:id')
  .get(protect, admin, adminGetOrder)
  .put(protect, admin, adminUpdateOrderStatus)
  .delete(protect, admin, adminDeleteOrder);

router.get(
  '/:id/invoice',
  protect,
  admin,
  adminDownloadInvoice
);

module.exports = router;