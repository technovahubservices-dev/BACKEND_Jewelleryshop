const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register User
const registerUser = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Email OR phone is required
    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({
        message:
          'Please provide name, password, and either email or phone number',
      });
    }

    const normalizedEmail = email ? email.toLowerCase().trim() : '';
    const normalizedPhone = phone ? phone.trim() : '';
    const trimmedPassword = password.trim();

    // Check existing email or phone
    const userExists = await User.findOne({
      $or: [
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
      ],
    });

    if (userExists) {
      return res.status(400).json({
        message: 'Email or phone number already exists',
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(trimmedPassword, salt);

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail || undefined,
      phone: normalizedPhone,
      password: hashedPassword,
    });

    if (user) {
      return res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email || '',
        phone: user.phone || '',
        isAdmin: user.isAdmin,
        token: generateToken(user._id),
      });
    }

    return res.status(400).json({
      message: 'Invalid user data',
    });
  } catch (error) {
    console.error('Register error:', error);

    return res.status(500).json({
      message: 'Server error during registration',
    });
  }
};

// Login User
const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    const normalizedIdentifier = identifier
      ? identifier.trim()
      : '';

    const normalizedEmail = normalizedIdentifier.toLowerCase();

    const trimmedPassword = password
      ? password.trim()
      : '';

    // Find user by email OR phone
    const user = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { phone: normalizedIdentifier },
      ],
    });

    if (
      user &&
      (await bcrypt.compare(trimmedPassword, user.password))
    ) {
      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email || '',
        phone: user.phone || '',
        isAdmin: user.isAdmin,
        token: generateToken(user._id),
      });
    }

    return res.status(400).json({
      message: 'Invalid credentials',
    });
  } catch (error) {
    console.error('Login error:', error);

    return res.status(500).json({
      message: 'Server error during login',
    });
  }
};

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET,
    {
      expiresIn: '30d',
    }
  );
};

module.exports = {
  registerUser,
  loginUser,
};