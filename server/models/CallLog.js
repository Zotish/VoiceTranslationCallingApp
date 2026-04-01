const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema({
  callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  callerName: { type: String },
  calleeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  calleeName: { type: String },
  duration: { type: Number, default: 0 },
  fromLang: { type: String },
  toLang: { type: String },
  type: { type: String, enum: ['incoming', 'outgoing'], default: 'outgoing' }
}, { timestamps: true });

module.exports = mongoose.model('CallLog', callLogSchema);
