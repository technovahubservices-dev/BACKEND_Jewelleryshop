const Accessory = require('../models/Accessory');
const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');

const generateSlug = (name) =>
  name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim('-');

exports.createAccessory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Accessory name is required',
    });
  }

  const trimmedName = name.trim();

  const existing = await Accessory.findOne({
    name: { $regex: `^${trimmedName}$`, $options: 'i' },
  });

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'Accessory with this name already exists',
    });
  }

  const accessory = await Accessory.create({
    name: trimmedName,
    slug: generateSlug(trimmedName),
    description: description || '',
    isActive: isActive !== undefined ? isActive : true,
  });

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

  const accessory = await Accessory.findById(req.params.id);

  if (!accessory) {
    return res.status(404).json({
      success: false,
      message: 'Accessory not found',
    });
  }

  if (name && name.trim()) {
    const trimmedName = name.trim();

    if (trimmedName.toLowerCase() !== accessory.name.toLowerCase()) {
      const existing = await Accessory.findOne({
        name: { $regex: `^${trimmedName}$`, $options: 'i' },
        _id: { $ne: accessory._id },
      });

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

  await accessory.save();

  res.status(200).json({
    success: true,
    message: 'Accessory updated successfully',
    data: accessory,
  });
});

exports.deleteAccessory = asyncHandler(async (req, res) => {
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
