const express = require('express');
const router = express.Router();
const {
  createQuotation,
  getAllQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
  uploadExcel,
} = require('../controllers/quotationController');
const { protect, admin } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

router.route('/')
  .get(protect, admin, getAllQuotations)
  .post(protect, admin, createQuotation);

router.route('/upload-excel')
  .post(protect, admin, upload.single('file'), uploadExcel);

router.route('/:id')
  .get(protect, admin, getQuotationById)
  .put(protect, admin, updateQuotation)
  .delete(protect, admin, deleteQuotation);

module.exports = router;
