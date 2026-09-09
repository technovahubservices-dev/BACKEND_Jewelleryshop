const express = require('express');
const router = express.Router();
const { getDashboard } = require('../controllers/adminDashboardController');
const { protect, admin } = require('../middleware/authMiddleware');

router.get('/dashboard', protect, admin, getDashboard);

module.exports = router;
