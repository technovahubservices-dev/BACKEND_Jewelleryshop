const express = require('express');
const router = express.Router();
const { getStoreSettings, updateStoreSettings } = require('../controllers/storeController');
const { protect, admin } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
  .get(admin, getStoreSettings)
  .put(admin, updateStoreSettings);

module.exports = router;
