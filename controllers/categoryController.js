const Category = require('../models/Category');
const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');

const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim('-');
};

const createCategory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Category name is required',
    });
  }

  const trimmedName = name.trim();

  const existingCategory = await Category.findOne({
    name: { $regex: `^${trimmedName}$`, $options: 'i' },
  });

  if (existingCategory) {
    return res.status(400).json({
      success: false,
      message: 'Category with this name already exists',
    });
  }

  const slug = generateSlug(trimmedName);

  const category = await Category.create({
    name: trimmedName,
    slug,
    description: description || '',
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({
    success: true,
    message: 'Category created successfully',
    data: category,
  });
});

const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({}).sort('-createdAt');

  res.status(200).json({
    success: true,
    count: categories.length,
    data: categories,
  });
});

const getCategory = asyncHandler(async (req, res) => {
  let category;
  try {
    category = await Category.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid category ID',
    });
  }

  if (!category) {
    return res.status(404).json({
      success: false,
      message: 'Category not found',
    });
  }

  res.status(200).json({
    success: true,
    data: category,
  });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;

  let category;
  try {
    category = await Category.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid category ID',
    });
  }

  if (!category) {
    return res.status(404).json({
      success: false,
      message: 'Category not found',
    });
  }

  if (name && name.trim() && name.trim().toLowerCase() !== category.name.toLowerCase()) {
    const existingCategory = await Category.findOne({
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
      _id: { $ne: req.params.id },
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists',
      });
    }

    category.name = name.trim();
    category.slug = generateSlug(name.trim());
  }

  if (description !== undefined) {
    category.description = description;
  }

  if (isActive !== undefined) {
    category.isActive = isActive;
  }

  await category.save();

  res.status(200).json({
    success: true,
    message: 'Category updated successfully',
    data: category,
  });
});

const deleteCategory = asyncHandler(async (req, res) => {
  let category;
  try {
    category = await Category.findById(req.params.id);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid category ID',
    });
  }

  if (!category) {
    return res.status(404).json({
      success: false,
      message: 'Category not found',
    });
  }

  const productsUsingCategory = await Product.countDocuments({ category: category.name });

  if (productsUsingCategory > 0) {
    return res.status(400).json({
      success: false,
      message: `This category is currently used by ${productsUsingCategory} product(s) and cannot be deleted.`,
    });
  }

  await category.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Category deleted successfully',
  });
});

module.exports = {
  createCategory,
  getCategories,
  getCategory,
  updateCategory,
  deleteCategory,
};
