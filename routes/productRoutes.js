const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadImage');
const {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(getProducts)
  .post(protect, admin, upload.array('images', 10), createProduct);

router.route('/:id')
  .get(getProduct)
  .put(protect, admin, upload.array('images', 10), updateProduct)
  .delete(protect, admin, deleteProduct);

module.exports = router;
