const express = require('express');
const Contact = require('../models/Contact');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get all contacts
router.get('/', authMiddleware, async (req, res) => {
  try {
    const contacts = await Contact.find({ userId: req.user.id })
      .populate('contactUserId', 'name email language linkedTelegram linkedWhatsapp')
      .sort({ createdAt: -1 });

    const contactList = contacts.map(c => ({
      id: c._id,
      userId: c.contactUserId._id,
      name: c.contactUserId.name,
      email: c.contactUserId.email,
      language: c.contactUserId.language,
      linkedTelegram: c.contactUserId.linkedTelegram,
      linkedWhatsapp: c.contactUserId.linkedWhatsapp,
      addedAt: c.createdAt
    }));

    res.json(contactList);
  } catch (err) {
    console.error('Get contacts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add contact by email
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const contactUser = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: req.user.id }
    });

    if (!contactUser) {
      return res.status(404).json({ error: 'User not found with that email' });
    }

    const existing = await Contact.findOne({
      userId: req.user.id,
      contactUserId: contactUser._id
    });

    if (existing) {
      return res.status(400).json({ error: 'Already in contacts' });
    }

    const contact = await Contact.create({
      userId: req.user.id,
      contactUserId: contactUser._id
    });

    res.status(201).json({
      id: contact._id,
      userId: contactUser._id,
      name: contactUser.name,
      email: contactUser.email,
      language: contactUser.language,
      addedAt: contact.createdAt
    });
  } catch (err) {
    console.error('Add contact error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete contact
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await Contact.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!result) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ message: 'Contact removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
