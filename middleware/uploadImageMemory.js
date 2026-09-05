const path = require('path');
const multer = require('multer');

const IMAGE_EXT_RE = /jpeg|jpg|png|webp|gif/;
const VIDEO_EXT_RE = /mp4|mov|avi|webm|mpeg/;

const storage = multer.memoryStorage();

const limits = {
  fileSize: 25 * 1024 * 1024,
};

const mediaFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
  if (IMAGE_EXT_RE.test(ext) || VIDEO_EXT_RE.test(ext)) {
    cb(null, true);
  } else {
    const error = new Error('Only image (jpeg, jpg, png, webp, gif) or video (mp4, mov, avi, webm) files are allowed.');
    error.statusCode = 400;
    error.isFileFilterError = true;
    cb(error, false);
  }
};

const uploadImageMemory = multer({ storage, fileFilter: mediaFileFilter, limits });

module.exports = uploadImageMemory;
