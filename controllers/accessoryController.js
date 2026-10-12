const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const AccessoryCategory = require('../models/AccessoryCategory');
const AccessoryProduct = require('../models/AccessoryProduct');
const {
  deleteDriveFilesForUrls,
  normalizeGoogleDriveUrl,
  uploadRequestFilesToGoogleDrive,
} = require('../utils/googleDriveStorage');

const VALID_PRODUCT_STATUSES = ['active', 'inactive', 'draft'];

const generateSlug = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);
const sendValidationError = (res, message) => res.status(400).json({ success: false, message });

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};

const parseJsonOrCsv = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
};

const parseAttributes = (value) => {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const extractImageUrl = (img) => {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (typeof img === 'object') return img.url || img.imageUrl || img.src || img.path || '';
  return '';
};

const normalizeImage = (img, index) => {
  const url = normalizeGoogleDriveUrl(extractImageUrl(img));
  return {
    url,
    alt: typeof img === 'object' && img !== null ? (img.alt || img.title || '') : '',
    order: typeof img === 'object' && img !== null && img.order !== undefined ? Number(img.order) || 0 : index,
  };
};

const getImagesFromBody = (req) => [
  ...parseJsonOrCsv(req.body.imageUrls),
  ...parseJsonOrCsv(req.body.images),
].map(normalizeImage).filter((img) => img.url);

const validateImageUploadFiles = (req, res) => {
  if (!req.files || req.files.length === 0) return true;

  const invalidUpload = req.files.some((file) => !String(file.mimetype || '').startsWith('image/'));
  if (invalidUpload) {
    sendValidationError(res, 'Invalid file type. Only image files are allowed.');
    return false;
  }

  return true;
};

const buildCategoryDuplicateQuery = (name, slug, excludeId) => {
  const query = {
    $or: [
      { name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
      { slug },
    ],
  };

  if (excludeId) query._id = { $ne: excludeId };
  return query;
};

const buildProductResponse = (product) => {
  const plain = typeof product?.toObject === 'function' ? product.toObject() : { ...product };
  plain.images = Array.isArray(plain.images)
    ? plain.images.map((img, index) => normalizeImage(img, index)).sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];
  plain.primaryImage = plain.primaryImage
    ? normalizeGoogleDriveUrl(plain.primaryImage)
    : (plain.images[0]?.url || '');
  plain.isAvailable = plain.status === 'active' && Number(plain.stock) > 0;
  return plain;
};

const listProducts = asyncHandler(async (req, res, forcedQuery = {}) => {
  const {
    search,
    category,
    status,
    minPrice,
    maxPrice,
    inStock,
    brand,
    sort = '-createdAt',
    page = 1,
    limit = 20,
  } = req.query;

  const query = { ...forcedQuery };

  if (search && String(search).trim()) {
    const searchRegex = { $regex: String(search).trim(), $options: 'i' };
    query.$or = [{ name: searchRegex }, { description: searchRegex }, { brand: searchRegex }];
  }

  if (category && !query.category) {
    if (!isValidObjectId(category)) return sendValidationError(res, 'Invalid accessory category ID');
    query.category = category;
  }

  if (brand) query.brand = { $regex: `^${escapeRegex(String(brand).trim())}$`, $options: 'i' };

  if (!query.status && status && String(status).toLowerCase() !== 'all') {
    const normalizedStatus = String(status).toLowerCase();
    if (!VALID_PRODUCT_STATUSES.includes(normalizedStatus)) {
      return sendValidationError(res, `Invalid status. Valid values: ${VALID_PRODUCT_STATUSES.join(', ')}`);
    }
    query.status = normalizedStatus;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    query.price = {};
    if (minPrice !== undefined && minPrice !== '') {
      const min = Number(minPrice);
      if (Number.isNaN(min) || min < 0) return sendValidationError(res, 'Minimum price must be a non-negative number');
      query.price.$gte = min;
    }
    if (maxPrice !== undefined && maxPrice !== '') {
      const max = Number(maxPrice);
      if (Number.isNaN(max) || max < 0) return sendValidationError(res, 'Maximum price must be a non-negative number');
      query.price.$lte = max;
    }
  }

  if (inStock === 'true' || inStock === true) query.stock = { $gt: 0 };
  if (inStock === 'false' || inStock === false) query.stock = { $lte: 0 };

  const validSortFields = ['-createdAt', 'createdAt', '-updatedAt', 'updatedAt', 'name', '-name', 'price', '-price', 'stock', '-stock'];
  const sortOption = validSortFields.includes(sort) ? sort : '-createdAt';
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [products, total] = await Promise.all([
    AccessoryProduct.find(query)
      .populate('category', 'name slug description image isActive')
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum),
    AccessoryProduct.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum),
    hasMore: pageNum < Math.ceil(total / limitNum),
    data: products.map(buildProductResponse),
  });
});

exports.createAccessoryCategory = asyncHandler(async (req, res) => {
  const { name, description, image, isActive } = req.body;

  if (!name || !String(name).trim()) return sendValidationError(res, 'Accessory category name is required');

  const trimmedName = String(name).trim();
  const slug = generateSlug(trimmedName);
  const existing = await AccessoryCategory.findOne(buildCategoryDuplicateQuery(trimmedName, slug));

  if (existing) return sendValidationError(res, 'Accessory category with this name already exists');

  const category = await AccessoryCategory.create({
    name: trimmedName,
    slug,
    description: description || '',
    image: image ? normalizeGoogleDriveUrl(String(image).trim()) : '',
    isActive: parseBoolean(isActive, true),
  });

  res.status(201).json({
    success: true,
    message: 'Accessory category created successfully',
    data: category,
  });
});

exports.getAccessoryCategories = asyncHandler(async (req, res) => {
  const query = {};
  if (String(req.query.active || '').toLowerCase() === 'true') query.isActive = true;

  const categories = await AccessoryCategory.find(query).sort('-createdAt');

  res.status(200).json({
    success: true,
    count: categories.length,
    data: categories,
  });
});

exports.getActiveAccessoryCategories = asyncHandler(async (req, res) => {
  const categories = await AccessoryCategory.find({ isActive: true }).sort('-createdAt');
  res.status(200).json({ success: true, count: categories.length, data: categories });
});

exports.getAccessoryCategory = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return sendValidationError(res, 'Invalid accessory category ID');

  const category = await AccessoryCategory.findById(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: 'Accessory category not found' });

  res.status(200).json({ success: true, data: category });
});

exports.updateAccessoryCategory = asyncHandler(async (req, res) => {
  const { name, description, image, isActive } = req.body;

  if (!isValidObjectId(req.params.id)) return sendValidationError(res, 'Invalid accessory category ID');

  const category = await AccessoryCategory.findById(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: 'Accessory category not found' });

  if (name !== undefined) {
    if (!String(name).trim()) return sendValidationError(res, 'Accessory category name is required');

    const trimmedName = String(name).trim();
    const slug = generateSlug(trimmedName);
    const existing = await AccessoryCategory.findOne(buildCategoryDuplicateQuery(trimmedName, slug, category._id));
    if (existing) return sendValidationError(res, 'Accessory category with this name already exists');

    category.name = trimmedName;
    category.slug = slug;
  }

  if (description !== undefined) category.description = description || '';
  if (image !== undefined) category.image = image ? normalizeGoogleDriveUrl(String(image).trim()) : '';
  if (isActive !== undefined) category.isActive = parseBoolean(isActive, category.isActive);

  await category.save();

  res.status(200).json({
    success: true,
    message: 'Accessory category updated successfully',
    data: category,
  });
});

exports.deleteAccessoryCategory = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return sendValidationError(res, 'Invalid accessory category ID');

  const category = await AccessoryCategory.findById(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: 'Accessory category not found' });

  const productsUsingCategory = await AccessoryProduct.countDocuments({ category: category._id });
  if (productsUsingCategory > 0) {
    return sendValidationError(res, `This accessory category contains ${productsUsingCategory} product(s) and cannot be deleted.`);
  }

  await category.deleteOne();
  res.status(200).json({ success: true, message: 'Accessory category deleted successfully' });
});

exports.createAccessoryProduct = asyncHandler(async (req, res) => {
  const categoryId = req.params.categoryId || req.body.category || req.body.categoryId;
  const { name, description, price, stock, brand, attributes, status } = req.body;

  if (!isValidObjectId(categoryId)) return sendValidationError(res, 'Invalid accessory category ID');
  if (!name || !String(name).trim()) return sendValidationError(res, 'Accessory product name is required');

  const parsedPrice = Number(price);
  if (price === undefined || price === '' || Number.isNaN(parsedPrice) || parsedPrice < 0) {
    return sendValidationError(res, 'Price must be a non-negative number');
  }

  const parsedStock = stock === undefined || stock === '' ? 0 : Number(stock);
  if (!Number.isInteger(parsedStock) || parsedStock < 0) {
    return sendValidationError(res, 'Stock must be a non-negative integer');
  }

  const normalizedStatus = status ? String(status).toLowerCase() : 'active';
  if (!VALID_PRODUCT_STATUSES.includes(normalizedStatus)) {
    return sendValidationError(res, `Invalid status. Valid values: ${VALID_PRODUCT_STATUSES.join(', ')}`);
  }

  const category = await AccessoryCategory.findById(categoryId);
  if (!category) return res.status(404).json({ success: false, message: 'Accessory category not found' });

  if (!validateImageUploadFiles(req, res)) return;

  const existingImages = getImagesFromBody(req);
  const driveFiles = await uploadRequestFilesToGoogleDrive(req, { makePublic: true });
  const uploadedImages = driveFiles.map((file, index) => ({
    url: file.viewUrl || file.url,
    alt: '',
    order: existingImages.length + index,
  }));
  const images = [...existingImages, ...uploadedImages];

  const product = await AccessoryProduct.create({
    category: category._id,
    name: String(name).trim(),
    description: description || '',
    price: parsedPrice,
    stock: parsedStock,
    brand: brand ? String(brand).trim() : '',
    attributes: parseAttributes(attributes),
    images,
    primaryImage: images[0]?.url || '',
    status: normalizedStatus,
  });

  await product.populate('category', 'name slug description image isActive');

  res.status(201).json({
    success: true,
    message: 'Accessory product created successfully',
    data: buildProductResponse(product),
  });
});

exports.getAccessoryProducts = asyncHandler(async (req, res) => listProducts(req, res));
exports.getActiveAccessoryProducts = asyncHandler(async (req, res) => listProducts(req, res, { status: 'active' }));

exports.getAccessoryProductsByCategory = asyncHandler(async (req, res) => {
  const categoryId = req.params.categoryId;
  if (!isValidObjectId(categoryId)) return sendValidationError(res, 'Invalid accessory category ID');

  const category = await AccessoryCategory.findById(categoryId);
  if (!category) return res.status(404).json({ success: false, message: 'Accessory category not found' });

  return listProducts(req, res, { category: category._id });
});

exports.getActiveAccessoryProductsByCategory = asyncHandler(async (req, res) => {
  const categoryId = req.params.categoryId;
  if (!isValidObjectId(categoryId)) return sendValidationError(res, 'Invalid accessory category ID');

  const category = await AccessoryCategory.findOne({ _id: categoryId, isActive: true });
  if (!category) return res.status(404).json({ success: false, message: 'Active accessory category not found' });

  return listProducts(req, res, { category: category._id, status: 'active' });
});

exports.getAccessoryProduct = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return sendValidationError(res, 'Invalid accessory product ID');

  const product = await AccessoryProduct.findById(req.params.id)
    .populate('category', 'name slug description image isActive');

  if (!product) return res.status(404).json({ success: false, message: 'Accessory product not found' });

  res.status(200).json({ success: true, data: buildProductResponse(product) });
});

exports.getActiveAccessoryProduct = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return sendValidationError(res, 'Invalid accessory product ID');

  const product = await AccessoryProduct.findOne({ _id: req.params.id, status: 'active' })
    .populate('category', 'name slug description image isActive');

  if (!product || !product.category || product.category.isActive === false) {
    return res.status(404).json({ success: false, message: 'Active accessory product not found' });
  }

  res.status(200).json({ success: true, data: buildProductResponse(product) });
});

exports.updateAccessoryProduct = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return sendValidationError(res, 'Invalid accessory product ID');

  const product = await AccessoryProduct.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Accessory product not found' });

  const { category, categoryId, name, description, price, stock, brand, attributes, status } = req.body;
  const nextCategoryId = categoryId || category;

  if (nextCategoryId !== undefined) {
    if (!isValidObjectId(nextCategoryId)) return sendValidationError(res, 'Invalid accessory category ID');
    const nextCategory = await AccessoryCategory.findById(nextCategoryId);
    if (!nextCategory) return res.status(404).json({ success: false, message: 'Accessory category not found' });
    product.category = nextCategory._id;
  }

  if (name !== undefined) {
    if (!String(name).trim()) return sendValidationError(res, 'Accessory product name is required');
    product.name = String(name).trim();
    product.slug = generateSlug(product.name);
  }

  if (price !== undefined && price !== '') {
    const parsedPrice = Number(price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) return sendValidationError(res, 'Price must be a non-negative number');
    product.price = parsedPrice;
  }

  if (stock !== undefined && stock !== '') {
    const parsedStock = Number(stock);
    if (!Number.isInteger(parsedStock) || parsedStock < 0) return sendValidationError(res, 'Stock must be a non-negative integer');
    product.stock = parsedStock;
  }

  if (status !== undefined && status !== '') {
    const normalizedStatus = String(status).toLowerCase();
    if (!VALID_PRODUCT_STATUSES.includes(normalizedStatus)) {
      return sendValidationError(res, `Invalid status. Valid values: ${VALID_PRODUCT_STATUSES.join(', ')}`);
    }
    product.status = normalizedStatus;
  }

  if (description !== undefined) product.description = description || '';
  if (brand !== undefined) product.brand = brand ? String(brand).trim() : '';
  if (attributes !== undefined) product.attributes = parseAttributes(attributes);
  if (!validateImageUploadFiles(req, res)) return;

  const oldImageUrls = (product.images || []).map(extractImageUrl);
  const requestHasImages = req.body.imageUrls !== undefined || req.body.images !== undefined;
  const keptImages = requestHasImages ? getImagesFromBody(req) : (product.images || []).map(normalizeImage);
  const driveFiles = await uploadRequestFilesToGoogleDrive(req, { makePublic: true });
  const uploadedImages = driveFiles.map((file, index) => ({
    url: file.viewUrl || file.url,
    alt: '',
    order: keptImages.length + index,
  }));

  if (requestHasImages || uploadedImages.length > 0) {
    const nextImages = [...keptImages, ...uploadedImages];
    const nextUrlSet = new Set(nextImages.map((img) => normalizeGoogleDriveUrl(img.url)));
    const removableUrls = oldImageUrls.filter((url) => url && !nextUrlSet.has(normalizeGoogleDriveUrl(url)));

    if (removableUrls.length > 0) {
      await deleteDriveFilesForUrls({ userId: req.user._id, urls: removableUrls });
    }

    product.images = nextImages;
    product.primaryImage = nextImages[0]?.url || '';
  }

  await product.save();
  await product.populate('category', 'name slug description image isActive');

  res.status(200).json({
    success: true,
    message: 'Accessory product updated successfully',
    data: buildProductResponse(product),
  });
});

exports.deleteAccessoryProduct = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return sendValidationError(res, 'Invalid accessory product ID');

  const product = await AccessoryProduct.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Accessory product not found' });

  await deleteDriveFilesForUrls({ userId: req.user._id, urls: (product.images || []).map(extractImageUrl) });
  await product.deleteOne();

  res.status(200).json({ success: true, message: 'Accessory product deleted successfully' });
});

exports.createAccessory = exports.createAccessoryCategory;
exports.getAccessories = exports.getAccessoryCategories;
exports.getAccessory = exports.getAccessoryCategory;
exports.updateAccessory = exports.updateAccessoryCategory;
exports.deleteAccessory = exports.deleteAccessoryCategory;
