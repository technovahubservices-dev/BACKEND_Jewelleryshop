const express = require('express');
const router = express.Router();
const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  buyNow,
  checkout,
} = require('../controllers/cartController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
  .get(getCart)
  .post(addToCart)
  .delete(clearCart);

router.route('/checkout')
  .post(checkout);

router.route('/buy-now')
  .post(buyNow);

router.route('/:itemId')
  .put(updateCartItem)
  .delete(removeFromCart);

module.exports = router;
