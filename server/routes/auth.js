const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

function generateToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function safeUser(user) {
  const obj = user.toObject();
  delete obj.password;
  delete obj.__v;
  obj.id = obj._id;
  return obj;
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, language } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      language: language || 'en'
    });

    const token = generateToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(safeUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, language } = req.body;
    const update = {};
    if (name) update.name = name;
    if (language) update.language = language;

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(safeUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Link Telegram
router.post('/link-telegram', authMiddleware, async (req, res) => {
  try {
    const { telegramUsername } = req.body;
    if (!telegramUsername) return res.status(400).json({ error: 'Telegram username required' });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { linkedTelegram: telegramUsername },
      { new: true }
    );
    res.json(safeUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Link WhatsApp
router.post('/link-whatsapp', authMiddleware, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { linkedWhatsapp: phoneNumber },
      { new: true }
    );
    res.json(safeUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Search user by email
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: req.user.id }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(safeUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
