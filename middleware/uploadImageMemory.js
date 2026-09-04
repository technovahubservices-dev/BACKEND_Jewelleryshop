const path = require('path');
const multer = require('multer');

const IMAGE_EXT_RE = /jpeg|jpg|png|webp|gif/;

const storage = multer.memoryStorage();

const imageFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (IMAGE_EXT_RE.test(ext.replace('.', ''))) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (jpeg, jpg, png, webp, gif) are allowed.'), false);
  }
};

const limits = {
  fileSize: 10 * 1024 * 1024,
};

const uploadImageMemory = multer({ storage, fileFilter: imageFileFilter, limits });

module.exports = uploadImageMemory;
