const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const { uploadRequestFileToGoogleDrive } = require('../utils/googleDriveStorage');

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

  res.status(200).json({
    success: true,
    count: items.length,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / parseInt(limit, 10)),
    data: items,
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

  res.status(200).json({
    success: true,
    count: items.length,
    data: items,
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

  res.status(200).json({
    success: true,
    data: item,
  });
});

const create = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];
  const body = { ...req.body };

  if (req.file) {
    const driveFile = await uploadRequestFileToGoogleDrive(req, { makePublic: true });
    body.image = driveFile.url;
  }

  if (body.sortOrder === undefined || body.sortOrder === null || body.sortOrder === '') {
    const maxOrder = await Model.findOne({}).sort('-sortOrder');
    body.sortOrder = maxOrder ? maxOrder.sortOrder + 1 : 0;
  }

  const item = await Model.create(body);

  res.status(201).json({
    success: true,
    message: `${CONTENT_TYPES[modelKey] || 'Item'} created successfully`,
    data: item,
  });
});

const update = (modelKey) => asyncHandler(async (req, res) => {
  const Model = contentModels[modelKey];
  const body = { ...req.body };

  if (req.file) {
    const driveFile = await uploadRequestFileToGoogleDrive(req, { makePublic: true });
    body.image = driveFile.url;
  }

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

  Object.keys(body).forEach((key) => {
    if (key === '_id' || key === '__v' || key === 'createdAt' || key === 'updatedAt') return;
    if (body[key] !== undefined && body[key] !== null) {
      item[key] = body[key];
    }
  });

  if (body.isActive !== undefined) {
    item.isActive = body.isActive === true || body.isActive === 'true';
  }

  await item.save();

  res.status(200).json({
    success: true,
    message: `${CONTENT_TYPES[modelKey] || 'Item'} updated successfully`,
    data: item,
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

  res.status(200).json({
    success: true,
    message: `Status updated: ${item.isActive ? 'Active' : 'Inactive'}`,
    data: item,
  });
});

const getHomepageSettings = asyncHandler(async (req, res) => {
  const settings = await mongoose.model('HomepageSetting').getSettings();
  res.status(200).json({
    success: true,
    data: settings,
  });
});

const updateHomepageSettings = asyncHandler(async (req, res) => {
  const settings = await mongoose.model('HomepageSetting').getSettings();
  const updates = req.body;

  Object.keys(updates).forEach((key) => {
    settings[key] = updates[key];
  });

  await settings.save();

  res.status(200).json({
    success: true,
    message: 'Homepage settings updated successfully',
    data: settings,
  });
});

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded',
    });
  }
  const driveFile = await uploadRequestFileToGoogleDrive(req, { makePublic: true });
  const url = driveFile.url;
  res.status(200).json({
    success: true,
    message: 'Image uploaded successfully',
    url,
  });
});

// Atomic tab update that also handles an optional single image upload (e.g. hero background).
// Accepts multipart/form-data with fields:
//   - tab: string (e.g. "hero")
//   - payload: JSON string OR repeated field[] entries (legacy shape)
//   - image: optional File (the new background image)
const TABS_WITH_IMAGE = {
  hero: 'heroSectionBgImage',
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

  Object.keys(payload).forEach((key) => {
    settings[key] = payload[key];
  });

  // If a new file is uploaded AND this tab has an image slot, replace the path.
  // We only replace when a file is actually present so that callers updating only
  // text fields don't accidentally blank out the existing image.
  if (req.file && TABS_WITH_IMAGE[tab]) {
    const imageField = TABS_WITH_IMAGE[tab];
    const driveFile = await uploadRequestFileToGoogleDrive(req, { makePublic: true });
    settings[imageField] = driveFile.url;
  }

  await settings.save();

  res.status(200).json({
    success: true,
    message: `Tab "${tab}" updated successfully`,
    data: settings,
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

  if (payload && typeof payload === 'object') {
    Object.keys(payload).forEach((key) => {
      settings[key] = payload[key];
    });
  }

  await settings.save();

  res.status(200).json({
    success: true,
    message: `Tab "${tab}" updated successfully`,
    data: settings,
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
