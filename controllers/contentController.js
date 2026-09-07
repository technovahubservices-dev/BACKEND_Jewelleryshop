const path = require('path');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const {
  deleteDriveFilesForUrls,
  normalizeGoogleDriveUrl,
  buildPublicDriveImageUrl,
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

// Fields that hold Google Drive image URLs. YouTube URLs and direct video URLs
// in videoUrl are NOT normalized through the Drive normalizer — they are preserved as-is.
const HOMEPAGE_IMAGE_URL_ARRAY_FIELDS = [
  { key: 'heroSlides', subKey: 'image' },
  { key: 'homepageTestimonials', subKey: 'image' },
  { key: 'categories', subKey: 'image' },
  { key: 'videoReels', subKey: 'thumbnail' },
  { key: 'festiveExclusiveImages', subKey: 'image' },
  { key: 'heritageCollectionImages', subKey: 'image' },
];

// Homepage arrays that support explicit ordering via a sortOrder sub-field.
const HOMEPAGE_SORTABLE_ARRAYS = [
  'heroSlides',
  'homepageTestimonials',
  'categories',
  'videoReels',
  'festiveExclusiveImages',
  'heritageCollectionImages',
];

const sortHomepageArrays = (data) => {
  const result = { ...data };

  for (const key of HOMEPAGE_SORTABLE_ARRAYS) {
    if (Array.isArray(result[key])) {
      result[key] = [...result[key]].sort(
        (a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0)
      );
    }
  }

  return result;
};

const normalizeHomepageImageUrls = (data) => {
  let result = { ...data };

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

  result = sortHomepageArrays(result);

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
  res.set('Cache-Control', 'no-store');
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
    body.image = driveFile.viewUrl || driveFile.url;
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

  const oldImageUrls = [item.image, item.mobileImage].filter(
    (url) => typeof url === 'string' && url
  );

  const uploadedFile = resolveUploadedImageFile(req);
  if (uploadedFile) {
    const driveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: uploadedFile },
      { makePublic: true }
    );
    body.image = driveFile.viewUrl || driveFile.url;
  }

  const normalizedBody = normalizeContentItemImageUrls(body);

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

  // Delete old Drive images only after the new image has been uploaded
  // and the MongoDB record has been saved successfully.
  if (oldImageUrls.length > 0) {
    try {
      await deleteDriveFilesForUrls({
        userId: req.user._id,
        urls: oldImageUrls,
      });
    } catch (cleanupError) {
      console.error('Failed to delete old Drive images during update', {
        urls: oldImageUrls,
        error: cleanupError.message,
      });
    }
  }

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

  try {
    const bulkOps = items.map(({ id, sortOrder }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sortOrder } },
      },
    }));

    await Model.bulkWrite(bulkOps, { ordered: false });

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
    });
  } catch (error) {
    if (error.name === 'BulkWriteError') {
      throw new Error('One or more items could not be reordered');
    }
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
  res.set('Cache-Control', 'no-store');
  const settings = await mongoose.model('HomepageSetting').getSettings();
  const plain = typeof settings?.toObject === 'function' ? settings.toObject() : settings;
  const normalized = normalizeHomepageImageUrls(plain);

  // Public API: only return active video reels. Inactive reels are hidden
  // from the public-facing homepage but remain visible in admin endpoints.
  if (Array.isArray(normalized.videoReels)) {
    normalized.videoReels = normalized.videoReels.filter((reel) => reel.isActive !== false);
  }

  res.status(200).json({
    success: true,
    data: normalized,
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

  const plainUpdated = typeof updated?.toObject === 'function' ? updated.toObject() : updated;

  res.status(200).json({
    success: true,
    message: 'Homepage settings updated successfully',
    data: normalizeHomepageImageUrls(plainUpdated),
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
  const url = driveFile.viewUrl || driveFile.url;
  const settings = await mongoose.model('HomepageSetting').getSettings();

  const oldImageUrl = settings.heroSectionBgImage;

  const updated = await mongoose.model('HomepageSetting').findOneAndUpdate(
    { _id: settings._id },
    { $set: { heroSectionBgImage: url } },
    { new: true, runValidators: true }
  );

  if (oldImageUrl) {
    try {
      await deleteDriveFilesForUrls({
        userId: req.user._id,
        urls: [oldImageUrl],
      });
      console.log('[Homepage Image Upload] Deleted old Drive image', {
        oldImageUrl,
      });
    } catch (cleanupError) {
      console.error('[Homepage Image Upload] Failed to delete old Drive image', {
        oldImageUrl,
        error: cleanupError.message,
      });
    }
  }

  console.log('[Homepage Image Upload] Uploaded image', {
    fileId: driveFile.id,
    url,
    originalName: uploadedFile.originalname,
    savedField: 'heroSectionBgImage',
    replacedOldUrl: oldImageUrl || null,
  });
  res.status(200).json({
    success: true,
    message: 'Image uploaded successfully',
    url,
    data: normalizeHomepageImageUrls(typeof updated?.toObject === 'function' ? updated.toObject() : updated),
  });
});

const ensureString = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
    try {
      return value.toString();
    } catch (e) {
      return String(value);
    }
  }
  return String(value);
};

const ensureNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const ensureBoolean = (value, fallback = true) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value === 'true' || value === '1';
  }
  return fallback;
};

const normalizeVideoReelInput = (body) => {
  const result = {};

  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title === 'object') {
      throw new Error('title must be a string value');
    }
    result.title = ensureString(body.title);
  }

  if (body.thumbnail !== undefined && body.thumbnail !== null) {
    if (typeof body.thumbnail === 'object') {
      throw new Error('thumbnail must be a string value');
    }
    result.thumbnail = ensureString(body.thumbnail);
  }

  if (body.shopLink !== undefined && body.shopLink !== null) {
    if (typeof body.shopLink === 'object') {
      throw new Error('shopLink must be a string value');
    }
    result.shopLink = ensureString(body.shopLink);
  }

  if (body.price !== undefined && body.price !== null) {
    result.price = String(body.price);
  }

  if (body.isActive !== undefined) {
    result.isActive = ensureBoolean(body.isActive, true);
  }

  if (body.sortOrder !== undefined) {
    const parsed = parseInt(body.sortOrder, 10);
    result.sortOrder = Number.isFinite(parsed) ? parsed : 0;
  }

  return result;
};

const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const VIDEO_EXT_RE = /mp4|webm|ogg|mov|avi|mkv/;

const uploadVideoReel = asyncHandler(async (req, res) => {
  const uploadedFile = req.file || req.files?.video?.[0] || req.files?.file?.[0] || req.files?.image?.[0];

  if (!uploadedFile) {
    return res.status(400).json({
      success: false,
      message: 'No video file uploaded',
    });
  }

  const ext = path.extname(uploadedFile.originalname || '').replace('.', '').toLowerCase();
  if (!VIDEO_EXT_RE.test(ext)) {
    return res.status(400).json({
      success: false,
      message: 'Only video files (mp4, webm, ogg, mov, avi, mkv) are allowed.',
    });
  }

  const mimeType = uploadedFile.mimetype || '';
  if (!VIDEO_MIME_TYPES.some((mt) => mimeType.startsWith(mt) || mimeType === 'application/octet-stream')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid video MIME type. Supported: mp4, webm, ogg, mov, avi, mkv.',
    });
  }

  const driveFile = await uploadRequestFileToGoogleDrive(
    { ...req, file: uploadedFile },
    { makePublic: true }
  );

   const videoUrl = driveFile.viewUrl || driveFile.url;

  let normalized;
  try {
    normalized = normalizeVideoReelInput(req.body);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  const thumbnailFile = req.files?.thumbnail?.[0];
  let thumbnailUrl = normalized.thumbnail !== undefined ? normalized.thumbnail : '';

  if (thumbnailFile) {
    const thumbDriveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: thumbnailFile },
      { makePublic: true }
    );
    thumbnailUrl = thumbDriveFile.url;
    console.log('[Video Reel Upload] Thumbnail uploaded to Drive', {
      fileId: thumbDriveFile.id,
      thumbnailUrl,
    });
  }

  const settings = await mongoose.model('HomepageSetting').getSettings();

  const maxOrder = settings.videoReels.length > 0
    ? Math.max(...settings.videoReels.map((r) => (r.sortOrder != null ? r.sortOrder : 0))) + 1
    : 0;

  const newReel = {
    title: normalized.title !== undefined ? normalized.title : '',
    videoUrl,
    videoMetadata: {
      driveFileId: driveFile.id,
      originalName: uploadedFile.originalname,
      mimeType: driveFile.mimeType,
    },
     thumbnail: thumbnailUrl,
    price: normalized.price !== undefined ? normalized.price : '',
    shopLink: normalized.shopLink !== undefined ? normalized.shopLink : '',
    isActive: normalized.isActive !== undefined ? normalized.isActive : true,
    sortOrder: normalized.sortOrder !== undefined ? normalized.sortOrder : maxOrder,
  };

  settings.videoReels.push(newReel);
  await settings.save();

  const plain = typeof settings?.toObject === 'function' ? settings.toObject() : settings;

  console.log('[Video Reel Upload] Uploaded video', {
    fileId: driveFile.id,
    videoUrl,
    originalName: uploadedFile.originalname,
    mimeType: driveFile.mimeType,
  });

  res.status(201).json({
    success: true,
    message: 'Video reel created successfully',
    data: normalizeHomepageImageUrls(plain),
  });
});

const updateVideoReel = asyncHandler(async (req, res) => {
  const settings = await mongoose.model('HomepageSetting').getSettings();

  const reelIndex = settings.videoReels.findIndex(
    (reel) => String(reel._id) === String(req.params.id)
  );

  if (reelIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Video reel not found',
    });
  }

  const existingReel = settings.videoReels[reelIndex];
  const oldDriveFileId = existingReel.videoMetadata?.driveFileId;
  const oldVideoUrl = existingReel.videoUrl;

  let newVideoUrl = oldVideoUrl;
  let newVideoMetadata = existingReel.videoMetadata;

  const uploadedFile = req.file || req.files?.video?.[0] || req.files?.file?.[0] || req.files?.image?.[0];

  if (uploadedFile) {
    const ext = path.extname(uploadedFile.originalname || '').replace('.', '').toLowerCase();
    if (!VIDEO_EXT_RE.test(ext)) {
      return res.status(400).json({
        success: false,
        message: 'Only video files (mp4, webm, ogg, mov, avi, mkv) are allowed.',
      });
    }

    const mimeType = uploadedFile.mimetype || '';
    if (!VIDEO_MIME_TYPES.some((mt) => mimeType.startsWith(mt) || mimeType === 'application/octet-stream')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video MIME type. Supported: mp4, webm, ogg, mov, avi, mkv.',
      });
    }

    const driveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: uploadedFile },
      { makePublic: true }
    );

    newVideoUrl = driveFile.viewUrl || driveFile.url;
    newVideoMetadata = {
      driveFileId: driveFile.id,
      originalName: uploadedFile.originalname,
      mimeType: driveFile.mimeType,
    };

    settings.videoReels[reelIndex].videoUrl = newVideoUrl;
    settings.videoReels[reelIndex].videoMetadata = newVideoMetadata;
  }

  const thumbnailFile = req.files?.thumbnail?.[0];
  if (thumbnailFile) {
    const thumbDriveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: thumbnailFile },
      { makePublic: true }
    );
    settings.videoReels[reelIndex].thumbnail = thumbDriveFile.url;
    console.log('[Video Reel Update] Thumbnail uploaded to Drive', {
      fileId: thumbDriveFile.id,
      thumbnailUrl: thumbDriveFile.url,
    });
  }

  let normalized;
  try {
    normalized = normalizeVideoReelInput(req.body);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (normalized.title !== undefined) {
    settings.videoReels[reelIndex].title = normalized.title;
  }
  if (normalized.thumbnail !== undefined) {
    settings.videoReels[reelIndex].thumbnail = normalized.thumbnail;
  }
  if (normalized.price !== undefined) {
    settings.videoReels[reelIndex].price = normalized.price;
  }
  if (normalized.shopLink !== undefined) {
    settings.videoReels[reelIndex].shopLink = normalized.shopLink;
  }
   if ('isActive' in normalized) {
    settings.videoReels[reelIndex].isActive = normalized.isActive;
  }
  if (normalized.sortOrder !== undefined) {
    settings.videoReels[reelIndex].sortOrder = normalized.sortOrder;
  }

  const videoChanged = newVideoUrl !== oldVideoUrl;

  await settings.save();

  if (videoChanged && oldDriveFileId) {
    try {
      await deleteDriveFilesForUrls({
        userId: req.user._id,
        urls: [oldVideoUrl],
      });
      console.log('[Video Reel Update] Deleted old Drive file', {
        oldDriveFileId,
        oldVideoUrl,
      });
    } catch (cleanupError) {
      console.error('[Video Reel Update] Failed to delete old Drive file', {
        oldDriveFileId,
        error: cleanupError.message,
      });
    }
  }

  const plain = typeof settings?.toObject === 'function' ? settings.toObject() : settings;

  res.status(200).json({
    success: true,
    message: 'Video reel updated successfully',
    data: normalizeHomepageImageUrls(plain),
  });
});

const deleteVideoReel = asyncHandler(async (req, res) => {
  const settings = await mongoose.model('HomepageSetting').getSettings();

  const reelIndex = settings.videoReels.findIndex(
    (reel) => String(reel._id) === String(req.params.id)
  );

  if (reelIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Video reel not found',
    });
  }

  const reel = settings.videoReels[reelIndex];
  const oldVideoUrl = reel.videoUrl;
  const driveFileId = reel.videoMetadata?.driveFileId;

  settings.videoReels.splice(reelIndex, 1);
  await settings.save();

  if (oldVideoUrl && driveFileId) {
    try {
      await deleteDriveFilesForUrls({
        userId: req.user._id,
        urls: [oldVideoUrl],
      });
      console.log('[Video Reel Delete] Deleted Drive file', {
        driveFileId,
        url: oldVideoUrl,
      });
    } catch (cleanupError) {
      console.error('[Video Reel Delete] Failed to delete Drive file', {
        driveFileId,
        error: cleanupError.message,
      });
    }
  }

  const plain = typeof settings?.toObject === 'function' ? settings.toObject() : settings;

  res.status(200).json({
    success: true,
    message: 'Video reel deleted successfully',
    data: normalizeHomepageImageUrls(plain),
  });
});

const reorderVideoReels = asyncHandler(async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Items array is required',
    });
  }

  const settings = await mongoose.model('HomepageSetting').getSettings();

  const updates = {};

  items.forEach(({ id, sortOrder }) => {
    const idx = settings.videoReels.findIndex((reel) => String(reel._id) === String(id));
    if (idx !== -1) {
      updates[idx] = parseInt(sortOrder, 10);
    }
  });

  Object.keys(updates).forEach((idx) => {
    settings.videoReels[Number(idx)].sortOrder = updates[idx];
  });

  settings.markModified('videoReels');
  await settings.save();

  const freshSettings = await mongoose.model('HomepageSetting').getSettings();
  const plain = typeof freshSettings?.toObject === 'function' ? freshSettings.toObject() : freshSettings;

  res.status(200).json({
    success: true,
    message: 'Video reel order updated successfully',
    data: normalizeHomepageImageUrls(plain),
  });
});

const toggleVideoReel = asyncHandler(async (req, res) => {
  const settings = await mongoose.model('HomepageSetting').getSettings();

  const reelIndex = settings.videoReels.findIndex(
    (reel) => String(reel._id) === String(req.params.id)
  );

  if (reelIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Video reel not found',
    });
  }

  settings.videoReels[reelIndex].isActive = !settings.videoReels[reelIndex].isActive;
  await settings.save();

  const plain = typeof settings?.toObject === 'function' ? settings.toObject() : settings;

  res.status(200).json({
    success: true,
    message: `Status updated: ${settings.videoReels[reelIndex].isActive ? 'Active' : 'Inactive'}`,
    data: normalizeHomepageImageUrls(plain),
  });
});

const getVideoReelsPublic = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const settings = await mongoose.model('HomepageSetting').getSettings();
  const plain = typeof settings?.toObject === 'function' ? settings.toObject() : settings;
  const normalized = normalizeHomepageImageUrls(plain);

  const activeReels = Array.isArray(normalized.videoReels)
    ? normalized.videoReels.filter((reel) => reel.isActive !== false)
    : [];

  res.status(200).json({
    success: true,
    count: activeReels.length,
    data: activeReels,
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
  const oldImageUrls = [];
  if (uploadedFile && TABS_WITH_IMAGE[tab]) {
    const imageField = TABS_WITH_IMAGE[tab];

    if (typeof settings[imageField] === 'string' && settings[imageField]) {
      oldImageUrls.push(settings[imageField]);
    }

    const driveFile = await uploadRequestFileToGoogleDrive(
      { ...req, file: uploadedFile },
      { makePublic: true }
    );
    updates[imageField] = normalizeGoogleDriveUrl(driveFile.viewUrl || driveFile.url);
    console.log('[Homepage Settings] Saved uploaded image', {
      tab,
      imageField,
      fileId: driveFile.id,
      url: driveFile.url,
      replacedOldUrl: settings[imageField] || null,
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

  // Delete old Drive files only after the new image has been uploaded and MongoDB saved.
  if (oldImageUrls.length > 0) {
    try {
      await deleteDriveFilesForUrls({
        userId: req.user._id,
        urls: oldImageUrls,
      });
    } catch (cleanupError) {
      console.error('[Homepage Settings] Failed to delete old Drive image', {
        urls: oldImageUrls,
        error: cleanupError.message,
      });
    }
  }

  const plainUpdated = typeof updated?.toObject === 'function' ? updated.toObject() : updated;

  res.status(200).json({
    success: true,
    message: `Tab "${tab}" updated successfully`,
    url: plainUpdated[TABS_WITH_IMAGE[tab]] || plainUpdated.heroSectionBgImage || null,
    data: normalizeHomepageImageUrls(plainUpdated),
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

  const plainUpdated = typeof updated?.toObject === 'function' ? updated.toObject() : updated;

  res.status(200).json({
    success: true,
    message: `Tab "${tab}" updated successfully`,
    data: normalizeHomepageImageUrls(plainUpdated),
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
  uploadVideoReel,
  updateVideoReel,
  deleteVideoReel,
  reorderVideoReels,
  toggleVideoReel,
  getVideoReelsPublic,
};
