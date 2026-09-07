const path = require('path');
const { Readable } = require('stream');
const { getGoogleDriveFileId } = require('../utils/googleDriveStorage');

const IMAGE_MIME_TYPES = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
  'image/svg+xml': 'image/svg+xml',
  'image/bmp': 'image/bmp',
  'image/tiff': 'image/tiff',
  'image/heic': 'image/heic',
  'image/heif': 'image/heif',
  'image/avif': 'image/avif',
  'application/octet-stream': 'application/octet-stream',
};

const VIDEO_MIME_TYPES = {
  'video/mp4': 'video/mp4',
  'video/webm': 'video/webm',
  'video/quicktime': 'video/quicktime',
  'video/x-m4v': 'video/m4v',
  'video/x-msvideo': 'video/x-msvideo',
  'video/ogg': 'video/ogg',
  'video/avi': 'video/x-msvideo',
  'video/mov': 'video/quicktime',
  'video/mkv': 'video/x-matroska',
  'application/octet-stream': 'application/octet-stream',
};

const getMimeType = (mimeType, isVideo = false) => {
  if (isVideo) {
    return VIDEO_MIME_TYPES[mimeType] || mimeType;
  }
  return IMAGE_MIME_TYPES[mimeType] || mimeType;
};

const streamDriveFile = (req, res, driveResponse, mimeType, contentLength) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const driveStream = Readable.fromWeb(driveResponse.body);

  driveStream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).send('Error streaming file');
    }
  });
  driveStream.pipe(res);
};

const getDriveMedia = async (req, res, next) => {
  const { fileId } = req.params;

  if (!fileId) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_FILE_ID',
      message: 'File ID is required',
    });
  }

  try {
    let adminUserId = req.user?._id;

    if (!adminUserId) {
      const GoogleDriveConnection = require('../models/GoogleDriveConnection');
      const firstConnection = await GoogleDriveConnection.findOne({}).sort({ createdAt: -1 });
      if (firstConnection) {
        adminUserId = firstConnection.user;
      }
    }

    const {
      getDriveFileMetadata,
      downloadDriveFileStream,
    } = require('../utils/googleDriveStorage');

    let mimeType = req.query.mime;
    let isVideo = false;

    try {
      const metadata = await getDriveFileMetadata(adminUserId, fileId);
      mimeType = metadata.mimeType || mimeType;
      if (metadata.mimeType && metadata.mimeType.startsWith('video/')) {
        isVideo = true;
      }
    } catch (metaErr) {
      if (metaErr.code !== 'DRIVE_FILE_NOT_FOUND' && metaErr.code !== 404) {
        console.error('Failed to fetch Drive metadata:', metaErr.message);
      }
    }

    mimeType = getMimeType(mimeType, isVideo);

    const driveStream = await downloadDriveFileStream(adminUserId, fileId);

    if (!mimeType) {
      mimeType = isVideo ? 'video/mp4' : 'application/octet-stream';
    }

    const contentLength = driveStream.headers.get('content-length')
      ? Number(driveStream.headers.get('content-length'))
      : null;

    streamDriveFile(req, res, driveStream, mimeType, contentLength);
  } catch (err) {
    if (err.code === 'DRIVE_FILE_NOT_FOUND' || err.code === 404) {
      return res.status(404).json({
        success: false,
        code: 'DRIVE_FILE_NOT_FOUND',
        message: 'File not found in Google Drive',
      });
    }
    if (err.code === 'DRIVE_ACCESS_ERROR' || err.code === 403) {
      return res.status(403).json({
        success: false,
        code: 'DRIVE_ACCESS_ERROR',
        message: 'Access denied to Google Drive file',
      });
    }
    if (err.code === 'DRIVE_CONFIG_ERROR') {
      return res.status(503).json({
        success: false,
        code: 'DRIVE_CONFIG_ERROR',
        message: 'Google Drive is not configured on the server',
      });
    }
    if (err.code === 'DRIVE_NOT_AUTHORIZED') {
      return res.status(503).json({
        success: false,
        code: 'DRIVE_NOT_AUTHORIZED',
        message: 'Google Drive is not authorized on the server',
      });
    }
    console.error('Drive proxy error:', err.message);
    next(err);
  }
};

module.exports = { getDriveMedia };

