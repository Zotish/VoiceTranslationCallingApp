require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const callRoutes = require('./routes/calls');
const voiceRoutes = require('./routes/voice');
const { translateText } = require('./services/translation');
const { generateTTS } = require('./services/tts');
const { generateSpeech } = require('./services/voiceClone');
const User = require('./models/User');

function getAllowedOrigins() {
  const configured = (process.env.FRONTEND_URL || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return [
    ...configured,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001'
  ];
}

const allowedOrigins = [...new Set(getAllowedOrigins())];

function isOriginAllowed(origin) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

// MongoDB connection
async function connectDB() {
  const externalURI = process.env.MONGODB_URI;

  if (externalURI) {
    console.log('Connecting to external MongoDB...');
    await mongoose.connect(externalURI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('MongoDB connected (external)');
  } else {
    // Local development only - mongodb-memory-server is devDependency
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
      console.log('MongoDB connected (in-memory for development)');
    } catch (err) {
      console.error('No MONGODB_URI set and mongodb-memory-server not available.');
      console.error('Set MONGODB_URI environment variable for production.');
      process.exit(1);
    }
  }
}

connectDB().catch(err => {
  console.error('MongoDB connection error:', err.message);
  process.exit(1);
});

const app = express();
const server = http.createServer(app);

// CORS
app.use(cors({
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
  maxHttpBufferSize: 5e6 // 5MB for audio data
});

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/voice', voiceRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Voice Translation Server Running' });
});

// Track online users: userId -> socketId
const onlineUsers = new Map();
// Track user voice IDs for quick lookup: userId -> voiceId
const userVoiceCache = new Map();

// Expose voice cache globally so routes can update it
app.set('userVoiceCache', userVoiceCache);

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', async (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.join(userId);
    io.emit('online-users', Array.from(onlineUsers.keys()));

    // Cache voice ID for this user
    try {
      const user = await User.findById(userId);
      if (user && user.voiceId) {
        userVoiceCache.set(userId, user.voiceId);
      }
    } catch (err) {
      console.error('Error caching voice:', err.message);
    }
  });

  socket.on('call-user', ({ to, from, callerName, offer, callerLang }) => {
    const receiverSocket = onlineUsers.get(to);
    if (receiverSocket) {
      io.to(to).emit('incoming-call', { from, callerName, offer, callerLang });
    } else {
      socket.emit('call-failed', { message: 'User is offline' });
    }
  });

  socket.on('call-accepted', ({ to, answer, accepterLang, accepterName }) => {
    io.to(to).emit('call-accepted', { answer, accepterLang, accepterName });
    console.log(`📞 Call accepted: ${socket.userId} → ${to} | accepterLang: ${accepterLang}`);
  });

  socket.on('call-rejected', ({ to }) => {
    io.to(to).emit('call-rejected');
  });

  socket.on('call-ended', ({ to }) => {
    io.to(to).emit('call-ended');
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { offer, from: socket.userId });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { answer, from: socket.userId });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { candidate, from: socket.userId });
  });

  // Translation + TTS (Cloned Voice > Google TTS fallback)
  socket.on('translate-text', async ({ text, fromLang, toLang, to }) => {
    try {
      if (!text || text.trim().length < 2) return;
      if (!to) {
        console.warn(`⚠️ [${new Date().toISOString()}] translate-text received without target 'to' user ID`);
        return;
      }

      console.log(`🔄 [${new Date().toISOString()}] Translate from ${socket.userId} to ${to}: "${text.substring(0, 30)}..."`);

      const translated = await translateText(text, fromLang, toLang);

      let audioBase64 = null;
      let voiceCloned = false;
      let voiceSource = 'none';

      // 1. Try ElevenLabs cloned voice first (speaker's voice!)
      let speakerVoiceId = userVoiceCache.get(socket.userId);
      if (!speakerVoiceId && socket.userId) {
        try {
          const speaker = await User.findById(socket.userId).select('voiceId');
          if (speaker?.voiceId) {
            speakerVoiceId = speaker.voiceId;
            userVoiceCache.set(socket.userId, speaker.voiceId);
          }
        } catch (err) {
          console.error(`❌ Voice DB lookup failed for ${socket.userId}:`, err.message);
        }
      }

      if (speakerVoiceId && process.env.ELEVENLABS_API_KEY) {
        try {
          const audioBuffer = await generateSpeech(translated, speakerVoiceId);
          if (audioBuffer) {
            audioBase64 = audioBuffer.toString('base64');
            voiceCloned = true;
            voiceSource = 'clone';
          }
        } catch (err) {
          console.error(`⚠️ Cloned voice failed for ${speakerVoiceId}:`, err.message);
        }
      }

      // 2. Fallback to Google TTS if no cloned voice or it failed
      if (!audioBase64) {
        try {
          audioBase64 = await generateTTS(translated, toLang);
          if (audioBase64) {
            voiceSource = 'tts';
          }
        } catch (err) {
          console.error(`❌ Google TTS failed for ${toLang}:`, err.message);
        }
      }

      // Send to receiver WITH audio
      if (to) {
        io.to(to).emit('text-translated', {
          original: text,
          translated,
          fromLang,
          toLang,
          audio: audioBase64,
          voiceCloned,
          voiceSource
        });
      }

      // Confirmation to sender
      socket.emit('translation-sent', { original: text, translated, fromLang, toLang, voiceSource });
      console.log(`✅ [${new Date().toISOString()}] Sent translation via ${voiceSource}`);
    } catch (err) {
      console.error('❌ Global Translation Error:', err);
      socket.emit('translation-error', { message: 'Translation failed. Please check your internet or try again.' });
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      userVoiceCache.delete(socket.userId);
      io.emit('online-users', Array.from(onlineUsers.keys()));
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
