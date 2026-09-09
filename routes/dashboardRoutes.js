const express = require('express');
const router = express.Router();
const { getAnalytics, getOrderStatusCounts } = require('../controllers/dashboardController');
const { protect, admin } = require('../middleware/authMiddleware');

router.get('/analytics', protect, admin, getAnalytics);
router.get('/order-status-counts', protect, admin, getOrderStatusCounts);

module.exports = router;
