const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const googleDrive = require('../utils/googleDrive');

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
  const allowedImageTypes = /jpeg|jpg|png|webp|gif/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedImageTypes.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'), false);
  }
};

const limits = {
  fileSize: 5 * 1024 * 1024,
};

const uploadImage = multer({ storage, fileFilter, limits });

async function uploadFilesToDrive(files) {
  if (!files || files.length === 0) return [];

  const results = [];

  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file.path);
      const driveResult = await googleDrive.uploadFile(
        buffer,
        file.originalname,
        file.mimetype
      );

      fs.unlinkSync(file.path);

      results.push(driveResult.url);
    } catch (error) {
      console.error('Failed to upload file to Drive:', file.originalname, error.message);
      results.push(`/uploads/${file.filename}`);
    }
  }

  return results;
}

uploadImage.uploadFilesToDrive = uploadFilesToDrive;

module.exports = uploadImage;
