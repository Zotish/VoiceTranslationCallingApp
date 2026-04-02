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
const User = require('./models/User');

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
app.use(cors());

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
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

  // Translation + Server-side TTS
  socket.on('translate-text', async ({ text, fromLang, toLang, to }) => {
    try {
      console.log(`🔄 Translate: "${text}" | ${fromLang}→${toLang} | to: ${to}`);

      const translated = await translateText(text, fromLang, toLang);
      console.log(`✅ Translated: "${translated}"`);

      // Generate TTS audio on server (works for ALL languages!)
      let audioBase64 = null;
      try {
        audioBase64 = await generateTTS(translated, toLang);
        if (audioBase64) {
          console.log(`🔊 TTS audio: ${audioBase64.length} chars`);
        }
      } catch (err) {
        console.error('TTS generation failed:', err.message);
      }

      // Send to receiver WITH audio
      if (to) {
        io.to(to).emit('text-translated', {
          original: text,
          translated,
          fromLang,
          toLang,
          audio: audioBase64
        });
      }

      // Confirmation to sender
      socket.emit('translation-sent', { original: text, translated, fromLang, toLang });
    } catch (err) {
      console.error('Translation error:', err);
      socket.emit('translation-error', { message: 'Translation failed' });
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
