const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
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
    .post(protect, admin, upload.single('image'), create(type));

  router.route(`/${type}/active`)
    .get(getActive(type));

  router.route(`/${type}/reorder`)
    .put(protect, admin, reorder(type));

  router.route(`/${type}/:id`)
    .get(protect, admin, getById(type))
    .put(protect, admin, upload.single('image'), update(type))
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
    upload.fields([
      { name: 'file', maxCount: 1 },
      { name: 'image', maxCount: 1 },
    ]),
    uploadImage
  );

router.route('/homepage/settings/updateTab')
  .put(protect, admin, updateHomepageTab);

router.route('/homepage/settings/updateTabWithUpload')
  .put(
    protect,
    admin,
    upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'file', maxCount: 1 },
    ]),
    updateHomepageTabWithUpload
  );

module.exports = router;
