const express = require('express');
const router = express.Router();
const uploadImageMemory = require('../middleware/uploadImageMemory');
const {
  createAccessoryCategory,
  getAccessoryCategories,
  getActiveAccessoryCategories,
  getAccessoryCategory,
  updateAccessoryCategory,
  deleteAccessoryCategory,
  createAccessoryProduct,
  getAccessoryProducts,
  getActiveAccessoryProducts,
  getAccessoryProductsByCategory,
  getActiveAccessoryProductsByCategory,
  getAccessoryProduct,
  getActiveAccessoryProduct,
  updateAccessoryProduct,
  deleteAccessoryProduct,
} = require('../controllers/accessoryController');
const { protect, admin } = require('../middleware/authMiddleware');

router.get('/public/categories', getActiveAccessoryCategories);
router.get('/public/products', getActiveAccessoryProducts);
router.get('/public/products/:id', getActiveAccessoryProduct);
router.get('/public/categories/:categoryId/products', getActiveAccessoryProductsByCategory);

router.route('/categories')
  .get(getAccessoryCategories)
  .post(protect, admin, createAccessoryCategory);

router.route('/categories/:id')
  .get(getAccessoryCategory)
  .put(protect, admin, updateAccessoryCategory)
  .delete(protect, admin, deleteAccessoryCategory);

router.route('/categories/:categoryId/products')
  .get(protect, admin, getAccessoryProductsByCategory)
  .post(protect, admin, uploadImageMemory.array('images', 10), createAccessoryProduct);

router.route('/products')
  .get(protect, admin, getAccessoryProducts);

router.get('/products/category/:categoryId', getActiveAccessoryProductsByCategory);

router.route('/products/:id')
  .get(protect, admin, getAccessoryProduct)
  .put(protect, admin, uploadImageMemory.array('images', 10), updateAccessoryProduct)
  .delete(protect, admin, deleteAccessoryProduct);

router.route('/')
  .get(getAccessoryCategories)
  .post(protect, admin, createAccessoryCategory);

router.route('/:id')
  .get(getAccessoryCategory)
  .put(protect, admin, updateAccessoryCategory)
  .delete(protect, admin, deleteAccessoryCategory);

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
