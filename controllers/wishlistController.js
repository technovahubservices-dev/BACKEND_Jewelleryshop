const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const WISHLIST_PRODUCT_FIELDS =
  'name price discountPrice primaryImage images stock status category';

exports.getWishlist = asyncHandler(async (req, res) => {
  let wishlist = await Wishlist.findOne({ user: req.user._id }).populate(
    'products.product',
    WISHLIST_PRODUCT_FIELDS
  );

  if (!wishlist) {
    wishlist = await Wishlist.create({ user: req.user._id, products: [] });
  }

  const validItems = wishlist.products.filter(
    (item) => item.product !== null && item.product !== undefined
  );

  const normalizedItems = validItems.map((item) => ({
    _id: item._id,
    product: typeof item.product?.toObject === 'function'
      ? item.product.toObject()
      : item.product,
    addedAt: item.addedAt,
  }));

  res.status(200).json({
    success: true,
    count: normalizedItems.length,
    data: normalizedItems,
  });
});

exports.addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Valid product ID is required',
    });
  }

  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
    });
  }

  if (product.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Product is not available',
    });
  }

  let wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) {
    wishlist = new Wishlist({ user: req.user._id, products: [] });
  }

  const existingIndex = wishlist.products.findIndex(
    (item) => item.product.toString() === productId
  );

  if (existingIndex > -1) {
    return res.status(200).json({
      success: true,
      message: 'Product is already in wishlist',
      data: wishlist.products,
    });
  }

  wishlist.products.push({ product: product._id });
  await wishlist.save();

  await wishlist.populate('products.product', WISHLIST_PRODUCT_FIELDS);

  res.status(201).json({
    success: true,
    message: 'Product added to wishlist',
    data: wishlist.products,
  });
});

exports.removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Valid product ID is required',
    });
  }

  const wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist || wishlist.products.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist is empty',
    });
  }

  const itemIndex = wishlist.products.findIndex(
    (item) => item.product.toString() === productId
  );

  if (itemIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Product not found in wishlist',
    });
  }

  wishlist.products.splice(itemIndex, 1);
  await wishlist.save();

  await wishlist.populate('products.product', WISHLIST_PRODUCT_FIELDS);

  res.status(200).json({
    success: true,
    message: 'Product removed from wishlist',
    data: wishlist.products,
  });
});

exports.checkWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Valid product ID is required',
    });
  }

  const wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist || wishlist.products.length === 0) {
    return res.status(200).json({
      success: true,
      inWishlist: false,
    });
  }

  const isInWishlist = wishlist.products.some(
    (item) => item.product.toString() === productId
  );

  res.status(200).json({
    success: true,
    inWishlist: isInWishlist,
  });
});

exports.clearWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist || wishlist.products.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'Wishlist is already empty',
      data: [],
    });
  }

  wishlist.products = [];
  await wishlist.save();

  res.status(200).json({
    success: true,
    message: 'Wishlist cleared',
    data: [],
  });
});
