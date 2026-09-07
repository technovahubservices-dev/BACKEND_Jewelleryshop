const express = require('express');
const router = express.Router();

const { getDriveMedia } = require('../controllers/driveProxyController');

router.get('/upload/drive/:fileId', getDriveMedia);

module.exports = router;
