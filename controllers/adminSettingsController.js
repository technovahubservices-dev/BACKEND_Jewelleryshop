const asyncHandler = require('express-async-handler');
const StoreSetting = require('../models/StoreSetting');

const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'CAD', 'AUD', 'SGD'];

const ALLOWED_STORE_FIELDS = ['storeName', 'email', 'phone', 'currency'];

const sanitizeSettings = (doc) => ({
  _id: doc._id,
  storeName: doc.storeName,
  email: doc.email,
  phone: doc.phone,
  currency: doc.currency,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const getAdminSettings = asyncHandler(async (req, res) => {
  const settings = await StoreSetting.getSettings();
  res.status(200).json({ success: true, data: sanitizeSettings(settings) });
});

const updateAdminSettings = asyncHandler(async (req, res) => {
  const updateData = {};

  for (const field of ALLOWED_STORE_FIELDS) {
    if (req.body[field] !== undefined && req.body[field] !== null) {
      updateData[field] = req.body[field];
    }
  }

  if (updateData.storeName !== undefined) {
    const trimmed = String(updateData.storeName).trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Store name cannot be empty' });
    }
    if (trimmed.length > 120) {
      return res.status(400).json({ success: false, message: 'Store name cannot exceed 120 characters' });
    }
    updateData.storeName = trimmed;
  }

  if (updateData.email !== undefined) {
    const trimmed = String(updateData.email).trim().toLowerCase();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Email cannot be empty' });
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email' });
    }
    updateData.email = trimmed;
  }

  if (updateData.phone !== undefined) {
    const trimmed = String(updateData.phone).trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Phone cannot be empty' });
    }
    if (trimmed.length > 30) {
      return res.status(400).json({ success: false, message: 'Phone cannot exceed 30 characters' });
    }
    updateData.phone = trimmed;
  }

  if (updateData.currency !== undefined) {
    const trimmed = String(updateData.currency).trim().toUpperCase();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Currency cannot be empty' });
    }
    if (!SUPPORTED_CURRENCIES.includes(trimmed)) {
      return res.status(400).json({
        success: false,
        message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
      });
    }
    updateData.currency = trimmed;
  }

  if (Object.keys(updateData).length === 0) {
    const existing = await StoreSetting.getSettings();
    return res.status(200).json({
      success: true,
      message: 'No store information to update',
      data: sanitizeSettings(existing),
    });
  }

  const updated = await StoreSetting.findOneAndUpdate(
    {},
    { $set: updateData },
    { new: true, runValidators: true }
  ).exec();

  if (!updated) {
    return res.status(404).json({
      success: false,
      message: 'Store settings not found',
    });
  }

  res.status(200).json({
    success: true,
    message: 'Settings updated successfully',
    data: sanitizeSettings(updated),
  });
});

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  SUPPORTED_CURRENCIES,
  ALLOWED_STORE_FIELDS,
};
