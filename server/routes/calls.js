const express = require('express');
const CallLog = require('../models/CallLog');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get call history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const history = await CallLog.find({
      $or: [
        { callerId: req.user.id },
        { calleeId: req.user.id }
      ]
    }).sort({ createdAt: -1 }).limit(50);

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Log a call
router.post('/log', authMiddleware, async (req, res) => {
  try {
    const {
      callerId,
      callerName,
      calleeId,
      calleeName,
      duration,
      fromLang,
      toLang,
      type
    } = req.body;

    const callRecord = await CallLog.create({
      callerId: callerId || req.user.id,
      callerName: callerName || req.user.name,
      calleeId,
      calleeName,
      duration: duration || 0,
      fromLang,
      toLang,
      type: type || 'outgoing'
    });

    res.status(201).json(callRecord);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
