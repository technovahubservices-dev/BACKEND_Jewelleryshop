const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const uploadDir = path.join(__dirname, '../..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|webp|gif|mp4|mov|avi/;
  const allowedDocTypes = /xlsx|xls|csv|pdf/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedImageTypes.test(ext) || allowedDocTypes.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, Excel, and PDF files are allowed.'), false);
  }
};

const limits = {
  fileSize: 5 * 1024 * 1024,
};

const upload = multer({ storage, fileFilter, limits });

module.exports = upload;