const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (!mongoose.Types.ObjectId.isValid(decoded.id)) {
        const error = new Error('Not authorized, invalid user ID');
        error.statusCode = 401;
        throw error;
      }

      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        const error = new Error('Not authorized, user not found');
        error.statusCode = 401;
        throw error;
      }

      req.user = user;

      next();
    } catch (error) {
      const authError = new Error('Not authorized, token failed');
      authError.statusCode = 401;
      throw authError;
    }
  }

  if (!token) {
    const error = new Error('Not authorized, no token');
    error.statusCode = 401;
    throw error;
  }
});

const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    const error = new Error('Not authorized as an admin');
    error.statusCode = 403;
    throw error;
  }
};

module.exports = { protect, admin };
