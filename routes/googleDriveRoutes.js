const express = require('express');
const router = express.Router();
const { getGoogleDriveStatus, disconnectGoogleDrive } = require('../controllers/googleDriveController');
const { protect, admin } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/google-drive/status')
  .get(admin, getGoogleDriveStatus);

router.route('/google-drive/disconnect')
  .post(admin, disconnectGoogleDrive);

module.exports = router;
