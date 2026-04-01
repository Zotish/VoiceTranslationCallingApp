const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  language: { type: String, default: 'en' },
  linkedTelegram: { type: String, default: null },
  linkedWhatsapp: { type: String, default: null }
}, { timestamps: true });

let User;
try {
  User = mongoose.model('User');
} catch {
  User = mongoose.model('User', userSchema);
}

module.exports = User;
