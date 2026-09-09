const express = require('express');
const router = express.Router();
const { getStoreSettings, getPublicStoreSettings, updateStoreSettings } = require('../controllers/storeController');
const { protect, admin } = require('../middleware/authMiddleware');

router.get('/public', getPublicStoreSettings);

router.use(protect);

router.route('/')
  .get(admin, getStoreSettings)
  .put(admin, updateStoreSettings);

module.exports = router;
