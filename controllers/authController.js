const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please enter all fields' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const trimmedPassword = password.trim();

    const userExists = await User.findOne({ email: normalizedEmail });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(trimmedPassword, salt);

    const user = await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
    });

    if (user) {
      // Safety fallback string if JWT secret config missing
      const token = generateToken(user._id);

      return res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        token: token,
      });
    } else {
      return res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Server error during registration' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Safety structural validation check
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const trimmedPassword = password.trim();

    // Debug tracking logs to ensure incoming strings reach Render intact
    console.log(`[AUTH] Attempting login verification for: ${normalizedEmail}`);

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      console.log(`[AUTH FAILED] No user found with email: ${normalizedEmail}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(trimmedPassword, user.password);
    if (!isMatch) {
      console.log(`[AUTH FAILED] Password mismatch for: ${normalizedEmail}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Token signing safety execution block
    const token = generateToken(user._id);
    if (!token) {
      return res.status(500).json({ message: 'JWT Secret configuration error on server' });
    }

    console.log(`[AUTH SUCCESS] User authorized: ${normalizedEmail}`);
    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      token: token,
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};

const generateToken = (id) => {
  // Gracefully handles missing JWT_SECRET strings in staging platforms
  const secret = process.env.JWT_SECRET || 'fallback_development_secret_key';
  
  if (secret === 'fallback_development_secret_key' && process.env.NODE_ENV === 'production') {
    console.warn("WARNING: Running production build with fallback JWT_SECRET key!");
  }

  return jwt.sign({ id }, secret, {
    expiresIn: '30d',
  });
};

module.exports = { registerUser, loginUser };
