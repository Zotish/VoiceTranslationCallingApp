require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const callRoutes = require('./routes/calls');
const { translateText } = require('./services/translation');

// MongoDB connection
async function connectDB() {
  const externalURI = process.env.MONGODB_URI;

  if (externalURI) {
    // Production: use external MongoDB (Atlas)
    await mongoose.connect(externalURI);
    console.log('MongoDB connected (external)');
  } else {
    // Development: use in-memory MongoDB
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    console.log('MongoDB connected (in-memory for development)');
  }
}

connectDB().catch(err => {
  console.error('MongoDB connection error:', err.message);
  process.exit(1);
});

const app = express();
const server = http.createServer(app);

// CORS - allow all origins for development and production
app.use(cors());

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }
});

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/calls', callRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Voice Translation Server Running' });
});

// Track online users: userId -> socketId
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.join(userId);
    io.emit('online-users', Array.from(onlineUsers.keys()));
  });

  socket.on('call-user', ({ to, from, callerName, offer, callerLang }) => {
    const receiverSocket = onlineUsers.get(to);
    if (receiverSocket) {
      io.to(to).emit('incoming-call', { from, callerName, offer, callerLang });
    } else {
      socket.emit('call-failed', { message: 'User is offline' });
    }
  });

  socket.on('call-accepted', ({ to, answer, accepterLang }) => {
    io.to(to).emit('call-accepted', { answer, accepterLang });
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

  socket.on('translate-text', async ({ text, fromLang, toLang, to }) => {
    try {
      const translated = await translateText(text, fromLang, toLang);
      if (to) {
        io.to(to).emit('text-translated', { original: text, translated, fromLang, toLang });
      }
      socket.emit('translation-sent', { original: text, translated, fromLang, toLang });
    } catch (err) {
      console.error('Translation error:', err);
      socket.emit('translation-error', { message: 'Translation failed' });
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit('online-users', Array.from(onlineUsers.keys()));
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
