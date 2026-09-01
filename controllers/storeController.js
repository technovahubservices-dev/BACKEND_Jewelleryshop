const asyncHandler = require('express-async-handler');
const StoreSetting = require('../models/StoreSetting');

const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'CAD', 'AUD', 'SGD'];

const getStoreSettings = asyncHandler(async (req, res) => {
  const settings = await StoreSetting.getSettings();
  res.status(200).json({ success: true, data: settings });
});

const updateStoreSettings = asyncHandler(async (req, res) => {
  const { storeName, email, phone, currency } = req.body;

  const settings = await StoreSetting.getSettings();

  if (storeName !== undefined) {
    const trimmed = String(storeName).trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Store name cannot be empty' });
    }
    settings.storeName = trimmed;
  }

  if (email !== undefined) {
    const trimmed = String(email).trim().toLowerCase();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Email cannot be empty' });
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email' });
    }
    settings.email = trimmed;
  }

  if (phone !== undefined) {
    const trimmed = String(phone).trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Phone cannot be empty' });
    }
    settings.phone = trimmed;
  }

  if (currency !== undefined) {
    const trimmed = String(currency).trim().toUpperCase();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Currency cannot be empty' });
    }
    if (!SUPPORTED_CURRENCIES.includes(trimmed)) {
      return res.status(400).json({
        success: false,
        message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
      });
    }
    settings.currency = trimmed;
  }

  const updated = await settings.save();

  res.status(200).json({
    success: true,
    message: 'Store settings updated successfully',
    data: updated,
  });
});

module.exports = { getStoreSettings, updateStoreSettings, SUPPORTED_CURRENCIES };
