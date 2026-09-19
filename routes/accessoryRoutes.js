const express = require('express');
const router = express.Router();

const {
  createAccessory,
  getAccessories,
  getAccessory,
  updateAccessory,
  deleteAccessory,
} = require('../controllers/accessoryController');

const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(getAccessories)
  .post(protect, admin, createAccessory);

router.route('/:id')
  .get(getAccessory)
  .put(protect, admin, updateAccessory)
  .delete(protect, admin, deleteAccessory);

module.exports = router;
