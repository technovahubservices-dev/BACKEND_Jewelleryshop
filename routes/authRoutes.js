const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { registerUser, loginUser } = require('../controllers/authController');

router.post('/register', registerUser);
router.post('/login', loginUser);

if (process.env.NODE_ENV !== 'production') {
  router.post('/seed', async (req, res) => {
    try {
      const { name, email, password, isAdmin } = req.body;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const user = await User.create({
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        isAdmin: isAdmin || false,
      });
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        message: 'Seed user created',
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });
}

module.exports = router;
