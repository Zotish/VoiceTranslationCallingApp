const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  language: { type: String, default: 'en' },
  linkedTelegram: { type: String, default: null },
  linkedWhatsapp: { type: String, default: null },
  // Voice cloning fields
  voiceId: { type: String, default: null },         // ElevenLabs voice ID
  voiceCloned: { type: Boolean, default: false },    // Whether voice is cloned
  voiceSampleUrl: { type: String, default: null }    // Path to stored voice sample
}, { timestamps: true });

let User;
try {
  User = mongoose.model('User');
} catch {
  User = mongoose.model('User', userSchema);
}

module.exports = User;
