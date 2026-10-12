const { Readable } = require('stream');

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
  if (!mimeType) return '';

  if (isVideo) {
    return VIDEO_MIME_TYPES[mimeType] || mimeType;
  }

  return IMAGE_MIME_TYPES[mimeType] || mimeType;
};

const streamDriveFile = (req, res, driveResponse, mimeType, contentLength) => {
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Type'
  );

  res.setHeader('Content-Type', mimeType || 'application/octet-stream');

  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  // Allow browsers and shared caches to reuse successful media responses.
  res.setHeader('Cache-Control', 'public, max-age=604800');

  if (!driveResponse.body) {
    return res.status(502).send('Google Drive returned an empty response');
  }

  const driveStream = Readable.fromWeb(driveResponse.body);

  driveStream.on('error', (err) => {
    console.error('Google Drive stream error:', err.message);

    if (!res.headersSent) {
      res.status(500).send('Error streaming file');
    } else {
      res.destroy(err);
    }
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      driveStream.destroy();
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

    // Public product images may not have an authenticated user.
    if (!adminUserId) {
      const GoogleDriveConnection = require('../models/GoogleDriveConnection');

      const firstConnection = await GoogleDriveConnection.findOne({})
        .sort({ createdAt: -1 });

      if (firstConnection) {
        adminUserId = firstConnection.user;
      }
    }

    const {
      getDriveFileMetadata,
      downloadDriveFileStream,
    } = require('../utils/googleDriveStorage');

    const requestedType = req.query.type;
    let mimeType = req.query.mime || '';
    let isVideo = requestedType === 'video';

    if (requestedType === 'image') {
      // Skip the separate metadata request for explicitly identified images.
      mimeType = getMimeType(mimeType || 'image/jpeg', false);
    } else {
      // Preserve metadata detection for requests with unknown media type.
      try {
        const metadata = await getDriveFileMetadata(adminUserId, fileId);

        mimeType = metadata.mimeType || mimeType;

        if (metadata.mimeType?.startsWith('video/')) {
          isVideo = true;
        }
      } catch (metaErr) {
        if (
          metaErr.code !== 'DRIVE_FILE_NOT_FOUND' &&
          metaErr.code !== 404
        ) {
          console.error(
            'Failed to fetch Drive metadata:',
            metaErr.message
          );
        }

        // Continue to the download request; it reports access and missing-file
        // errors if the file cannot actually be retrieved.
      }

      mimeType = getMimeType(mimeType, isVideo);
    }

    const driveResponse = await downloadDriveFileStream(adminUserId, fileId);

    // Prefer the MIME type returned by Google Drive when available.
    const responseMimeType = getMimeType(
      driveResponse.headers.get('content-type')?.split(';')[0] ||
        mimeType ||
        (isVideo ? 'video/mp4' : 'image/jpeg'),
      isVideo
    );

    const contentLengthHeader = driveResponse.headers.get('content-length');
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : null;

    return streamDriveFile(
      req,
      res,
      driveResponse,
      responseMimeType,
      contentLength
    );
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
    return next(err);
  }
};

module.exports = { getDriveMedia };
