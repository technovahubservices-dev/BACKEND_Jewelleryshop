const express = require('express');
const router = express.Router();
const {
  getProfile,
  updateProfile,
  changePassword,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/profile')
  .get(getProfile)
  .put(updateProfile);

router.route('/password')
  .put(changePassword);

router.route('/addresses')
  .get(getAddresses)
  .post(addAddress);

router.route('/addresses/:id')
  .put(updateAddress)
  .delete(deleteAddress);

router.route('/addresses/:id/default')
  .put(setDefaultAddress);

module.exports = router;
