const asyncHandler = require('express-async-handler');
const StoreSetting = require('../models/StoreSetting');

const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'CAD', 'AUD', 'SGD'];

const ALLOWED_STORE_FIELDS = ['storeName', 'email', 'phone', 'currency', 'policies'];

const POLICY_TYPES = [
  'authenticity', 'purity', 'returns', 'exchange',
  'warranty', 'shipping', 'care', 'customisation',
];

const sanitizeSettings = (doc) => {
  const plain = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  const policies = Array.isArray(plain.policies)
    ? plain.policies
        .filter((p) => p && p.isActive !== false)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((p) => ({
          type: p.type,
          title: p.title,
          description: p.description,
          icon: p.icon || '',
          sortOrder: p.sortOrder || 0,
          isActive: p.isActive !== undefined ? p.isActive : true,
        }))
    : [];

  return {
    _id: plain._id,
    storeName: plain.storeName,
    email: plain.email,
    phone: plain.phone,
    currency: plain.currency,
    policies,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

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

  if (updateData.policies !== undefined) {
    if (!Array.isArray(updateData.policies)) {
      return res.status(400).json({
        success: false,
        message: 'Policies must be an array',
      });
    }
    try {
      updateData.policies = updateData.policies.map((p, index) => {
        if (!p || typeof p !== 'object') {
          throw new Error(`Policy at index ${index} must be an object`);
        }
        if (!p.type || !POLICY_TYPES.includes(p.type)) {
          throw new Error(`Invalid policy type at index ${index}. Valid types: ${POLICY_TYPES.join(', ')}`);
        }
        if (!p.title || !String(p.title).trim()) {
          throw new Error(`Policy title is required at index ${index}`);
        }
        if (!p.description || !String(p.description).trim()) {
          throw new Error(`Policy description is required at index ${index}`);
        }
        return {
          type: p.type,
          title: String(p.title).trim(),
          description: String(p.description).trim(),
          icon: p.icon ? String(p.icon).trim() : '',
          sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : index + 1,
          isActive: p.isActive !== undefined ? p.isActive : true,
        };
      });
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message,
      });
    }
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
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
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
