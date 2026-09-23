const path = require('path');
const multer = require('multer');

const IMAGE_EXTENSIONS = new Set([
  'jpeg',
  'jpg',
  'png',
  'webp',
  'gif',
  'avif',
  'heic',
  'heif',
  'bmp',
  'tiff',
  'jfif',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'avi',
  'webm',
  'mpeg',
  'ogv',
  'wmv',
  'm4v',
  'mkv',
]);

const storage = multer.memoryStorage();

const limits = {
  fileSize: 25 * 1024 * 1024,
};

const mediaFileFilter = (req, file, cb) => {
  const ext = path
    .extname(file.originalname || '')
    .replace('.', '')
    .toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) {
    return cb(null, true);
  }

  const error = new Error(
    'Only image (jpeg, jpg, png, webp, gif, avif, heic, heif, bmp, tiff, jfif) or video (mp4, mov, avi, webm, mpeg, ogv, wmv, m4v, mkv) files are allowed.'
  );

  error.statusCode = 400;
  error.isFileFilterError = true;

  return cb(error, false);
};

const uploadImageMemory = multer({
  storage,
  fileFilter: mediaFileFilter,
  limits,
});

module.exports = uploadImageMemory;
