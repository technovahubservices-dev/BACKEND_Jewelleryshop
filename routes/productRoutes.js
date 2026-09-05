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
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
    .get(getProducts)
    .post(protect, admin, uploadImageMemory.array('images', 10), createProduct);

router.post('/seed', protect, admin, seedProducts);

router.route('/:id')
  .get(getProduct)
  .put(protect, admin, uploadImageMemory.array('images', 10), updateProduct)
  .delete(protect, admin, deleteProduct);

module.exports = router;
