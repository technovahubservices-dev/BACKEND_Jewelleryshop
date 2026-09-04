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

router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Uploaded image is too large. Maximum size is 10MB.',
    });
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      message: 'Too many image files uploaded.',
    });
  }
  if (err && err instanceof Error) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Invalid image upload.',
    });
  }
  next(err);
});

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

module.exports = router;
