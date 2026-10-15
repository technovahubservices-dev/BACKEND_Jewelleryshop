const User = require('../models/User');
const asyncHandler = require('express-async-handler');

const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  res.status(200).json({ success: true, data: user });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const { name, email, phone } = req.body;

  if (name !== undefined) user.name = name.trim();
  if (email !== undefined) user.email = email.trim();
  if (phone !== undefined) user.phone = phone.trim();

  const updatedUser = await user.save();

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: {
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      isAdmin: updatedUser.isAdmin,
    },
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Please provide current and new password' });
  }

  const bcrypt = require('bcryptjs');
  const passwordMatch = await bcrypt.compare(currentPassword, user.password);
  if (!passwordMatch) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  res.status(200).json({ success: true, message: 'Password changed successfully' });
});

const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('addresses');
  res.status(200).json({ success: true, data: user.addresses || [] });
});

const addAddress = asyncHandler(async (req, res) => {
  const { fullName, phone, address, landmark, city, state, pincode, isDefault } = req.body;

  if (!fullName || !address || !city || !state || !pincode) {
    return res.status(400).json({ success: false, message: 'Please fill all required address fields' });
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (isDefault) {
    user.addresses.forEach((addr) => {
      addr.isDefault = false;
    });
  }

  user.addresses.push({
    fullName: fullName.trim(),
    phone: phone || '',
    address: address.trim(),
    landmark: landmark || '',
    city: city.trim(),
    state: state.trim(),
    pincode: pincode.trim(),
    isDefault: isDefault || false,
  });

  await user.save();

  res.status(201).json({
    success: true,
    message: 'Address added successfully',
    data: user.addresses,
  });
});

const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const addressIndex = user.addresses.findIndex(
    (addr) => addr._id.toString() === req.params.id
  );

  if (addressIndex === -1) {
    return res.status(404).json({ success: false, message: 'Address not found' });
  }

  const { fullName, phone, address, landmark, city, state, pincode, isDefault } = req.body;

  const savedAddress = user.addresses[addressIndex];
  const previousDefaultId = savedAddress._id.toString();

  if (isDefault) {
    user.addresses.forEach((addr) => {
      addr.isDefault = false;
    });
  }

  if (fullName !== undefined) savedAddress.fullName = fullName.trim();
  if (phone !== undefined) savedAddress.phone = phone.trim();
  if (address !== undefined) savedAddress.address = address.trim();
  if (landmark !== undefined) savedAddress.landmark = landmark.trim();
  if (city !== undefined) savedAddress.city = city.trim();
  if (state !== undefined) savedAddress.state = state.trim();
  if (pincode !== undefined) savedAddress.pincode = pincode.trim();
  if (isDefault !== undefined) savedAddress.isDefault = isDefault;

  const hasDefault = user.addresses.some((addr) => addr.isDefault);
  if (!hasDefault && user.addresses.length > 0) {
    const fallbackIndex = user.addresses.findIndex(
      (addr) => addr._id.toString() !== previousDefaultId
    );
    user.addresses[fallbackIndex >= 0 ? fallbackIndex : 0].isDefault = true;
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Address updated successfully',
    data: user.addresses,
  });
});

const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const addressIndex = user.addresses.findIndex(
    (addr) => addr._id.toString() === req.params.id
  );

  if (addressIndex === -1) {
    return res.status(404).json({ success: false, message: 'Address not found' });
  }

  const deletedWasDefault = user.addresses[addressIndex].isDefault;
  user.addresses.splice(addressIndex, 1);

  if (deletedWasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Address deleted successfully',
    data: user.addresses,
  });
});

const setDefaultAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const addressId = req.params.id;
  const addressIndex = user.addresses.findIndex(
    (addr) => addr._id.toString() === addressId
  );

  if (addressIndex === -1) {
    return res.status(404).json({ success: false, message: 'Address not found' });
  }

  user.addresses.forEach((addr) => {
    addr.isDefault = addr._id.toString() === addressId;
  });

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Default address updated',
    data: user.addresses,
  });
});

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};
