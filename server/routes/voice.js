const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const { cloneVoice, deleteVoice, getUsageInfo } = require('../services/voiceClone');

const router = express.Router();

// Setup multer for voice file uploads
const uploadsDir = path.join(__dirname, '..', 'uploads', 'voices');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `voice_${req.user.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

// Upload voice sample and clone
router.post('/clone', authMiddleware, upload.single('voiceSample'), async (req, res) => {
  try {
    console.log('=== VOICE CLONE REQUEST ===');
    console.log('File:', req.file ? `${req.file.filename} (${req.file.size} bytes, ${req.file.mimetype})` : 'NONE');
    console.log('User ID:', req.user.id);
    console.log('API Key set:', !!process.env.ELEVENLABS_API_KEY);

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: 'ElevenLabs API key not configured on server. Add ELEVENLABS_API_KEY to Railway environment variables.'
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Delete old voice if exists
    if (user.voiceId) {
      console.log('Deleting old voice:', user.voiceId);
      await deleteVoice(user.voiceId);
    }

    // Clone with ElevenLabs
    console.log('Starting ElevenLabs clone...');
    const voiceId = await cloneVoice(user.name, req.file.path);
    console.log('Clone successful! Voice ID:', voiceId);

    // Update user
    user.voiceId = voiceId;
    user.voiceCloned = true;
    user.voiceSampleUrl = req.file.path;
    await user.save();

    // Update voice cache immediately
    const voiceCache = req.app.get('userVoiceCache');
    if (voiceCache) {
      voiceCache.set(req.user.id, voiceId);
      console.log(`Voice cache updated: ${req.user.id} → ${voiceId}`);
    }

    res.json({
      success: true,
      message: 'Voice cloned successfully!',
      voiceCloned: true,
      voiceId
    });
  } catch (err) {
    console.error('=== VOICE CLONE ERROR ===');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);

    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: err.message || 'Voice cloning failed',
      details: 'Check Railway logs for more details'
    });
  }
});

// Check voice clone status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const usage = await getUsageInfo();

    res.json({
      voiceCloned: user.voiceCloned || false,
      voiceId: user.voiceId || null,
      usage
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete cloned voice
router.delete('/clone', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.voiceId) {
      await deleteVoice(user.voiceId);
    }

    // Delete local file
    if (user.voiceSampleUrl && fs.existsSync(user.voiceSampleUrl)) {
      fs.unlinkSync(user.voiceSampleUrl);
    }

    user.voiceId = null;
    user.voiceCloned = false;
    user.voiceSampleUrl = null;
    await user.save();

    // Clear from voice cache
    const voiceCache = req.app.get('userVoiceCache');
    if (voiceCache) voiceCache.delete(req.user.id);

    res.json({ success: true, message: 'Voice clone deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
