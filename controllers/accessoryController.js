const Accessory = require('../models/Accessory');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const generateSlug = (name) =>
  name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim('-');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

const buildDuplicateQuery = (name, slug, excludeId) => {
  const query = {
    $or: [
      { name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
      { slug },
    ],
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return query;
};

const sendValidationError = (res, message) =>
  res.status(400).json({
    success: false,
    message,
  });

const sendSaveError = (res, error) => {
  if (error.code === 11000) {
    return sendValidationError(res, 'Accessory with this name already exists');
  }

  if (error.name === 'ValidationError') {
    return sendValidationError(res, error.message);
  }

  throw error;
};

exports.createAccessory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Accessory name is required',
    });
  }

  const trimmedName = name.trim();
  const slug = generateSlug(trimmedName);

  const existing = await Accessory.findOne(buildDuplicateQuery(trimmedName, slug));

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'Accessory with this name already exists',
    });
  }

  let accessory;
  try {
    accessory = await Accessory.create({
      name: trimmedName,
      slug,
      description: description || '',
      isActive: isActive !== undefined ? isActive : true,
    });
  } catch (error) {
    return sendSaveError(res, error);
  }

  res.status(201).json({
    success: true,
    message: 'Accessory created successfully',
    data: accessory,
  });
});

exports.getAccessories = asyncHandler(async (req, res) => {
  const accessories = await Accessory.find({}).sort('-createdAt');

  res.status(200).json({
    success: true,
    count: accessories.length,
    data: accessories,
  });
});

exports.getAccessory = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid accessory ID',
    });
  }

  const accessory = await Accessory.findById(req.params.id);

  if (!accessory) {
    return res.status(404).json({
      success: false,
      message: 'Accessory not found',
    });
  }

  res.status(200).json({
    success: true,
    data: accessory,
  });
});

exports.updateAccessory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;

  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid accessory ID',
    });
  }

  const accessory = await Accessory.findById(req.params.id);

  if (!accessory) {
    return res.status(404).json({
      success: false,
      message: 'Accessory not found',
    });
  }

  if (name !== undefined) {
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Accessory name is required',
      });
    }

    const trimmedName = name.trim();
    const slug = generateSlug(trimmedName);

    if (trimmedName.toLowerCase() !== accessory.name.toLowerCase() || slug !== accessory.slug) {
      const existing = await Accessory.findOne(buildDuplicateQuery(trimmedName, slug, accessory._id));

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Accessory with this name already exists',
        });
      }

      accessory.name = trimmedName;
      accessory.slug = generateSlug(trimmedName);
    }
  }

  if (description !== undefined) accessory.description = description;
  if (isActive !== undefined) accessory.isActive = isActive;

  try {
    await accessory.save();
  } catch (error) {
    return sendSaveError(res, error);
  }

  res.status(200).json({
    success: true,
    message: 'Accessory updated successfully',
    data: accessory,
  });
});

exports.deleteAccessory = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid accessory ID',
    });
  }

  const accessory = await Accessory.findById(req.params.id);

  if (!accessory) {
    return res.status(404).json({
      success: false,
      message: 'Accessory not found',
    });
  }

  const productsUsingAccessory = await Product.countDocuments({
    subcategory: accessory.name,
  });

  if (productsUsingAccessory > 0) {
    return res.status(400).json({
      success: false,
      message: `This accessory is currently used by ${productsUsingAccessory} product(s) and cannot be deleted.`,
    });
  }

  await accessory.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Accessory deleted successfully',
  });
});
