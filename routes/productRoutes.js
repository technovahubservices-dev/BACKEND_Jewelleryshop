const express = require('express');
const router = express.Router();
const uploadImageMemory = require('../middleware/uploadImageMemory');
const {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  seedProducts,
  checkSkuAvailability,
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
    .get(getProducts)
    .post(protect, admin, uploadImageMemory.array('images', 10), createProduct);

router.get('/check-sku', checkSkuAvailability);

router.post('/seed', protect, admin, seedProducts);

router.route('/:id')
  .get(getProduct)
  .put(protect, admin, uploadImageMemory.array('images', 10), updateProduct)
  .delete(protect, admin, deleteProduct);

// Multer upload error handler — MUST be registered after routes so it can
// intercept multer errors thrown by the inline upload middleware. Without this
// placement, upload failures (oversized file, wrong file type) bubble to the
// global error handler as a 500 with no useful context.
router.use((err, req, res, next) => {
  if (err && typeof err.code === 'string' && err.code.startsWith('LIMIT_')) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded image is too large. Maximum size is 25MB.'
        : err.message,
    });
  }
  if (err && err.isFileFilterError) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message,
    });
  }
  next(err);
});

module.exports = router;
