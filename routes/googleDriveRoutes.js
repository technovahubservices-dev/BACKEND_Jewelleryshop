const express = require('express');

const router = express.Router();

const {
  getGoogleDriveStatus,
  disconnectGoogleDrive,
  startGoogleDriveAuth,
  handleGoogleDriveCallback,
} = require('../controllers/googleDriveController');

const { protect, admin } = require('../middleware/authMiddleware');

router.get('/google-drive', protect, admin, startGoogleDriveAuth);

router.get('/google-drive/callback', handleGoogleDriveCallback);

router.use(protect);

router.route('/google-drive/status')
  .get(admin, getGoogleDriveStatus);

router.route('/google-drive/disconnect')
  .post(admin, disconnectGoogleDrive);

module.exports = router;
