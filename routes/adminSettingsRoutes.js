const express = require('express');
const router = express.Router();
const { getAdminSettings, updateAdminSettings } = require('../controllers/adminSettingsController');
const { protect, admin } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
  .get(admin, getAdminSettings)
  .put(admin, updateAdminSettings);

module.exports = router;
