// server.js
require('dotenv').config();
const User       = require('./models/user');
const express    = require('express');
const path       = require('path');
const http       = require('http');
const mongoose   = require('mongoose');
const dotenv     = require('dotenv');
const socketio   = require('socket.io');
const session    = require('express-session');
const passport   = require('passport');
const MongoStore = require('connect-mongo');

require('./auth/passport');

const Chat       = require('./models/chat');
const Message    = require('./models/Message');

dotenv.config();

const app    = express();
const server = http.createServer(app);
const io     = socketio(server);

// MongoDB
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error(err));

// Middleware
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,            // typically better for login sessions
  store: MongoStore.create({           // <-- here’s the switch
  mongoUrl: process.env.MONGO_URI,   // e.g. mongodb://localhost:27017/your-db
  collectionName: 'sessions',        // optional—defaults to 'sessions'
  ttl: 14 * 24 * 60 * 60,            // how long until sessions expire (in seconds)
  autoRemove: 'native'               // let MongoDB take care of removing expired sessions
  }),
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000,  // match ttl in milliseconds
    secure: process.env.NODE_ENV === 'production', 
    httpOnly: true
}}));
app.use(passport.initialize());
app.use(passport.session());

// Auth guard
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Protected chat UI
app.get('/chat', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Google OAuth
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile','email'] })
);
app.get('/auth/google/callback',
  passport.authenticate('google',{ failureRedirect:'/' }),
  (req,res) => res.redirect('/chat')
);

// Logout
app.get('/logout', (req, res, next) => {
  req.logout(err => err ? next(err) : res.redirect('/'));
});

// REST: list chats
app.get('/api/chats', ensureAuth, async (req, res) => {
  const chats = await Chat.find({ participants: req.user.id });
  res.json(chats);
});

// REST: chat history
app.get('/api/chats/:chatId/messages', ensureAuth, async (req, res) => {
  const msgs = await Message.find({ chat: req.params.chatId })
                            .sort({ timestamp: 1 });
  res.json(msgs);
});

// REST: global chat history
app.get('/api/messages', ensureAuth, async (req, res) => {
  const msgs = await Message.find({ chat: { $exists: false } })
                            .sort({ timestamp: 1 })
                            .limit(50);
  res.json(msgs);
});

// REST: post global message
app.post('/api/messages', ensureAuth, async (req, res) => {
  const { username, message } = req.body;
  const msg = await Message.create({ username, message });
  io.emit('newMessage', msg);
  res.status(201).json(msg);
});
// GET /api/users → return everyone except yourself
app.get('/api/users', ensureAuth, async (req, res) => {
  const users = await User
    .find({ _id: { $ne: req.user.id } })
    .select('_id displayName email');
  res.json(users);
});

// POST /api/chats → { participantId } in body
app.post('/api/chats', ensureAuth, async (req, res) => {
  const otherId = req.body.participantId;
  // look for an existing 2-person chat
  let chat = await Chat.findOne({
    participants: { $all: [req.user.id, otherId] },
    'participants.2': { $exists: false }      // exactly size 2
  });
  if (!chat) {
    chat = await Chat.create({
      name:    'Direct Chat',
      participants: [req.user.id, otherId]
    });
  }
  res.json(chat);
});

// Socket.io
io.on('connection', socket => {
  // send global history
  Message.find({ chat: { $exists: false } })
         .sort({ timestamp: 1 })
         .limit(50)
         .then(ms => socket.emit('previousMessages', ms));

  // join room
  socket.on('joinChat', chatId => socket.join(chatId));

  // handle sends
  socket.on('sendMessage', async data => {
    if (data.chatId) {
      // room message
      const m = await Message.create({
        chat:     data.chatId,
        username: data.username,
        message:  data.text
      });
      io.to(data.chatId).emit('message', m);
    } else {
      // global message
      const m = await Message.create({
        username: data.username,
        message:  data.message
      });
      io.emit('newMessage', m);
    }
  });
});

// Start
const PORT = process.env.PORT||3000;
server.listen(PORT, ()=>console.log(`Server on ${PORT}`));
