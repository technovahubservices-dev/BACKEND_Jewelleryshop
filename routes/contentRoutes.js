const express = require('express');
const router = express.Router();
const uploadImageMemory = require('../middleware/uploadImageMemory');
const {
  getAll,
  getActive,
  getById,
  create,
  update,
  remove,
  reorder,
  toggleActive,
  getHomepageSettings,
  updateHomepageSettings,
  updateHomepageTab,
  updateHomepageTabWithUpload,
  uploadImage,
} = require('../controllers/contentController');
const { protect, admin } = require('../middleware/authMiddleware');

const CMS_IMAGE_FIELDS = [
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 },
];

const contentImageMiddleware = uploadImageMemory.fields(CMS_IMAGE_FIELDS);

const CONTENT_TYPES = [
  'heroBanners',
  'featuredProducts',
  'collections',
  'promoBanners',
  'blogs',
  'testimonials',
];

CONTENT_TYPES.forEach((type) => {
  router.route(`/${type}`)
    .get(protect, admin, getAll(type))
    .post(protect, admin, contentImageMiddleware, create(type));

  router.route(`/${type}/active`)
    .get(getActive(type));

  router.route(`/${type}/reorder`)
    .put(protect, admin, reorder(type));

  router.route(`/${type}/:id`)
    .get(protect, admin, getById(type))
    .put(protect, admin, contentImageMiddleware, update(type))
    .delete(protect, admin, remove(type));

  router.route(`/${type}/:id/toggle`)
    .put(protect, admin, toggleActive(type));
});

router.route('/homepage/settings')
  .get(getHomepageSettings)
  .put(protect, admin, updateHomepageSettings);

router.route('/homepage/upload')
  .post(
    protect,
    admin,
    contentImageMiddleware,
    uploadImage
  );

router.route('/homepage/settings/updateTab')
  .put(protect, admin, updateHomepageTab);

router.route('/homepage/settings/updateTabWithUpload')
  .put(
    protect,
    admin,
    contentImageMiddleware,
    updateHomepageTabWithUpload
  );

// Multer upload error handler — MUST be registered after the routes so it can
// actually intercept multer errors thrown by the inline `contentImageMiddleware`.
// Without this placement, upload failures (oversized file, wrong file type)
// would bubble to the global error handler as a 500 with no useful context.
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
