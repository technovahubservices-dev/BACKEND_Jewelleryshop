const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const {
  deleteDriveFilesForUrls,
  normalizeGoogleDriveUrl,
  uploadRequestFileToGoogleDrive,
} = require('../utils/googleDriveStorage');

require('../models/HeroBanner');
require('../models/FeaturedProduct');
require('../models/Collection');
require('../models/PromoBanner');
require('../models/Blog');
require('../models/Testimonial');
require('../models/HomepageSetting');

const contentModels = {
  heroBanners: mongoose.model('HeroBanner'),
  featuredProducts: mongoose.model('FeaturedProduct'),
  collections: mongoose.model('Collection'),
  promoBanners: mongoose.model('PromoBanner'),
  blogs: mongoose.model('Blog'),
  testimonials: mongoose.model('Testimonial'),
  homepageSettings: mongoose.model('HomepageSetting'),
};

const CONTENT_TYPES = {
  heroBanners: 'Hero Banner',
  featuredProducts: 'Featured Product',
  collections: 'Collection',
  promoBanners: 'Promo Banner',
  blogs: 'Blog',
  testimonials: 'Testimonial',
};

const HOMEPAGE_IMAGE_URL_FIELDS = [
  'heroSectionBgImage',
  'footerLogoUrl',
];

const HOMEPAGE_IMAGE_URL_ARRAY_FIELDS = [
  { key: 'heroSlides', subKey: 'image' },
  { key: 'homepageTestimonials', subKey: 'image' },
  { key: 'categories', subKey: 'image' },
  { key: 'videoReels', subKey: 'thumbnail' },
  { key: 'festiveExclusiveImages', subKey: 'image' },
  { key: 'heritageCollectionImages', subKey: 'image' },
];

const normalizeHomepageImageUrls = (data) => {
  const result = { ...data };

  for (const field of HOMEPAGE_IMAGE_URL_FIELDS) {
    if (typeof result[field] === 'string') {
      result[field] = normalizeGoogleDriveUrl(result[field]);
    }
  }

  for (const { key, subKey } of HOMEPAGE_IMAGE_URL_ARRAY_FIELDS) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].map((item) => {
        if (item && typeof item === 'object' && typeof item[subKey] === 'string') {
          return { ...item, [subKey]: normalizeGoogleDriveUrl(item[subKey]) };
        }
        return item;
      });
    }
  }

  return result;
};

const normalizeContentItemImageUrls = (data) => {
  const result = { ...data };

  const contentImageFields = ['image', 'mobileImage'];
  for (const field of contentImageFields) {
    if (typeof result[field] === 'string') {
      result[field] = normalizeGoogleDriveUrl(result[field]);
    }
  }

  return result;
};

const getAll = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];
  const { search, isActive, sort = '-createdAt', page = 1, limit = 50 } = req.query;

  const query = {};

  if (search) {
    const searchableFields = ['title', 'subtitle', 'description', 'name', 'content'];
    query.$or = searchableFields.map((field) => ({ [field]: { $regex: search, $options: 'i' } }));
  }

  if (isActive !== undefined) {
    query.isActive = isActive === 'true';
  }

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const items = await Model.find(query)
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Model.countDocuments(query);

  const normalizedItems = items.map((item) => {
    const plain = typeof item?.toObject === 'function' ? item.toObject() : item;
    return normalizeContentItemImageUrls(plain);
  });

  res.status(200).json({
    success: true,
    count: items.length,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / parseInt(limit, 10)),
    data: normalizedItems,
  });
});

const getActive = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];
  const { position, limit = 50 } = req.query;

  const now = new Date();
  const query = {
    isActive: true,
    $or: [
      { startDate: { $exists: false } },
      { startDate: { $lte: now } },
    ],
    $and: [
      {
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gte: now } },
        ],
      },
    ],
  };

  if (position) {
    query.position = position;
  }

  const items = await Model.find(query)
    .populate(
      modelKey === 'featuredProducts'
        ? { path: 'product', select: 'name sku price discountPrice primaryImage images category' }
        : ''
    )
    .sort('sortOrder createdAt')
    .limit(parseInt(limit, 10));

  const normalizedItems = items.map((item) => {
    const plain = typeof item?.toObject === 'function' ? item.toObject() : item;
    return normalizeContentItemImageUrls(plain);
  });

  res.status(200).json({
    success: true,
    count: items.length,
    data: normalizedItems,
  });
});

const getById = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];

  let item;
  try {
    item = await Model.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID',
    });
  }

  if (!item) {
    return res.status(404).json({
      success: false,
      message: `${CONTENT_TYPES[modelKey] || 'Item'} not found`,
    });
  }

  const plainItem = typeof item?.toObject === 'function' ? item.toObject() : item;

  res.status(200).json({
    success: true,
    data: normalizeContentItemImageUrls(plainItem),
  });
});

const resolveUploadedImageFile = (req) => {
  return req.file
    || (req.files && (req.files.image?.[0] || req.files.file?.[0]))
    || null;
};

const create = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];
  const body = { ...req.body };

  const uploadedFile = resolveUploadedImageFile(req);
  if (uploadedFile) {
    const driveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: uploadedFile },
      { makePublic: true }
    );
    body.image = driveFile.url;
  }

  const normalizedBody = normalizeContentItemImageUrls(body);

  if (normalizedBody.sortOrder === undefined || normalizedBody.sortOrder === null || normalizedBody.sortOrder === '') {
    const maxOrder = await Model.findOne({}).sort('-sortOrder');
    normalizedBody.sortOrder = maxOrder ? maxOrder.sortOrder + 1 : 0;
  }

  const item = await Model.create(normalizedBody);

  const plainItem = typeof item?.toObject === 'function' ? item.toObject() : item;

  res.status(201).json({
    success: true,
    message: `${CONTENT_TYPES[modelKey] || 'Item'} created successfully`,
    url: plainItem.image || null,
    data: normalizeContentItemImageUrls(plainItem),
  });
});

const update = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];
  const body = { ...req.body };

  const uploadedFile = resolveUploadedImageFile(req);
  if (uploadedFile) {
    const driveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: uploadedFile },
      { makePublic: true }
    );
    body.image = driveFile.url;
  }

  const normalizedBody = normalizeContentItemImageUrls(body);

  let item;
  try {
    item = await Model.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID',
    });
  }

  if (!item) {
    return res.status(404).json({
      success: false,
      message: `${CONTENT_TYPES[modelKey] || 'Item'} not found`,
    });
  }

  Object.keys(normalizedBody).forEach((key) => {
    if (key === '_id' || key === '__v' || key === 'createdAt' || key === 'updatedAt') return;
    if (normalizedBody[key] !== undefined && normalizedBody[key] !== null) {
      item[key] = normalizedBody[key];
    }
  });

  if (normalizedBody.isActive !== undefined) {
    item.isActive = normalizedBody.isActive === true || normalizedBody.isActive === 'true';
  }

  const updated = await item.save();

  const plainUpdated = typeof updated?.toObject === 'function' ? updated.toObject() : updated;

  res.status(200).json({
    success: true,
    message: `${CONTENT_TYPES[modelKey] || 'Item'} updated successfully`,
    url: plainUpdated.image || null,
    data: normalizeContentItemImageUrls(plainUpdated),
  });
});

const remove = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];

  let item;
  try {
    item = await Model.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID',
    });
  }

  if (!item) {
    return res.status(404).json({
      success: false,
      message: `${CONTENT_TYPES[modelKey] || 'Item'} not found`,
    });
  }

  const imageUrls = [
    item.image,
    item.mobileImage,
    ...(Array.isArray(item.heroSlides) ? item.heroSlides.map((slide) => slide.image) : []),
  ].filter(Boolean);

  await deleteDriveFilesForUrls({
    userId: req.user._id,
    urls: imageUrls,
  });
  await item.deleteOne();

  res.status(200).json({
    success: true,
    message: `${CONTENT_TYPES[modelKey] || 'Item'} deleted successfully`,
  });
});

const reorder = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Items array is required',
    });
  }

  const session = await Model.startSession();
  session.startTransaction();

  try {
    for (const { id, sortOrder } of items) {
      await Model.findByIdAndUpdate(id, { sortOrder }, { session });
    }
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

const toggleActive = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];

  let item;
  try {
    item = await Model.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID',
    });
  }

  if (!item) {
    return res.status(404).json({
      success: false,
      message: `${CONTENT_TYPES[modelKey] || 'Item'} not found`,
    });
  }

  item.isActive = !item.isActive;
  await item.save();

  const plainItem = typeof item?.toObject === 'function' ? item.toObject() : item;

  res.status(200).json({
    success: true,
    message: `Status updated: ${item.isActive ? 'Active' : 'Inactive'}`,
    data: normalizeContentItemImageUrls(plainItem),
  });
});

const getHomepageSettings = asyncHandler(async (req, res) => {
  const settings = await mongoose.model('HomepageSetting').getSettings();
  const plain = typeof settings?.toObject === 'function' ? settings.toObject() : settings;
  res.status(200).json({
    success: true,
    data: normalizeHomepageImageUrls(plain),
  });
});

const updateHomepageSettings = asyncHandler(async (req, res) => {
  const settings = await mongoose.model('HomepageSetting').getSettings();
  const updates = normalizeHomepageImageUrls(req.body);

  const safeUpdates = {};
  for (const key of Object.keys(updates)) {
    if (key === '_id' || key === '__v' || key === 'createdAt' || key === 'updatedAt') continue;
    if (updates[key] !== undefined && updates[key] !== null) {
      safeUpdates[key] = updates[key];
    }
  }

  const updated = await mongoose.model('HomepageSetting').findOneAndUpdate(
    { _id: settings._id },
    { $set: safeUpdates },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    message: 'Homepage settings updated successfully',
    data: updated,
  });
});

const uploadImage = asyncHandler(async (req, res) => {
  const uploadedFile = req.file || req.files?.image?.[0] || req.files?.file?.[0];
  if (!uploadedFile) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded',
    });
  }
  const driveFile = await uploadRequestFileToGoogleDrive(
    { ...req, file: uploadedFile },
    { makePublic: true }
  );
  const url = driveFile.url;
  const settings = await mongoose.model('HomepageSetting').getSettings();
  const updated = await mongoose.model('HomepageSetting').findOneAndUpdate(
    { _id: settings._id },
    { $set: { heroSectionBgImage: url } },
    { new: true, runValidators: true }
  );
  console.log('[Homepage Image Upload] Uploaded image', {
    fileId: driveFile.id,
    url,
    originalName: uploadedFile.originalname,
    savedField: 'heroSectionBgImage',
  });
  res.status(200).json({
    success: true,
    message: 'Image uploaded successfully',
    url,
    data: updated,
  });
});

// Atomic tab update that also handles an optional single image upload (e.g. hero background).
// Accepts multipart/form-data with fields:
//   - tab: string (e.g. "hero")
//   - payload: JSON string OR repeated field[] entries (legacy shape)
//   - image: optional File (the new background image)
const TABS_WITH_IMAGE = {
  hero: 'heroSectionBgImage',
  // Header image uploads use the existing homepage hero background field.
  header: 'heroSectionBgImage',
};

const updateHomepageTabWithUpload = asyncHandler(async (req, res) => {
  const { tab } = req.body;

  if (!tab) {
    return res.status(400).json({
      success: false,
      message: 'tab is required',
    });
  }

  let payload = req.body.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'payload must be a valid JSON string when sent as a form field',
      });
    }
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'payload is required',
    });
  }

  const settings = await mongoose.model('HomepageSetting').getSettings();

  const updates = normalizeHomepageImageUrls(payload);

  const uploadedFile = req.file || req.files?.image?.[0] || req.files?.file?.[0];
  if (uploadedFile && TABS_WITH_IMAGE[tab]) {
    const imageField = TABS_WITH_IMAGE[tab];
    const driveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: uploadedFile },
      { makePublic: true }
    );
    updates[imageField] = normalizeGoogleDriveUrl(driveFile.url);
    console.log('[Homepage Settings] Saved uploaded image', {
      tab,
      imageField,
      fileId: driveFile.id,
      url: driveFile.url,
    });
  }

  const safeUpdates = {};
  for (const key of Object.keys(updates)) {
    if (key === '_id' || key === '__v' || key === 'createdAt' || key === 'updatedAt') continue;
    if (updates[key] !== undefined && updates[key] !== null) {
      safeUpdates[key] = updates[key];
    }
  }

  const updated = await mongoose.model('HomepageSetting').findOneAndUpdate(
    { _id: settings._id },
    { $set: safeUpdates },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    message: `Tab "${tab}" updated successfully`,
    data: updated,
  });
});

const updateHomepageTab = asyncHandler(async (req, res) => {
  const { tab, payload } = req.body;

  if (!tab || !payload || typeof payload !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'tab and payload are required',
    });
  }

  const settings = await mongoose.model('HomepageSetting').getSettings();

  const updates = normalizeHomepageImageUrls(payload);

  const safeUpdates = {};
  for (const key of Object.keys(updates)) {
    if (key === '_id' || key === '__v' || key === 'createdAt' || key === 'updatedAt') continue;
    if (updates[key] !== undefined && updates[key] !== null) {
      safeUpdates[key] = updates[key];
    }
  }

  const updated = await mongoose.model('HomepageSetting').findOneAndUpdate(
    { _id: settings._id },
    { $set: safeUpdates },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    message: `Tab "${tab}" updated successfully`,
    data: updated,
  });
});

module.exports = {
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
};
