const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '../utils/jkr-fashion-c8363bb3d0b3.json');

const auth = new google.auth.GoogleAuth({
  keyFile: CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });

router.get('/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const headResponse = await drive.files.get({
      fileId,
      fields: 'mimeType,size',
    });

    res.setHeader('Content-Type', headResponse.data.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    response.data.pipe(res);
  } catch (error) {
    console.error('Drive proxy error:', error.message);
    if (error.code === '404') {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    res.status(500).json({ success: false, message: 'Error fetching image' });
  }
});

module.exports = router;
