const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Health check route for Railway/Monitoring
app.get('/', (req, res) => {
  res.send("Socket.IO signaling server is running!");
});

// Endpoint to fetch dynamic TURN credentials securely
app.get('/api/get-turn-credentials', async (req, res) => {
  try {
    const fetch = require('node-fetch');
    const response = await fetch(`https://theqnew.metered.live/api/v1/turn/credentials?apiKey=d185a98a85a4ff5d1b26b57bd6389e12574d`);
    const iceServers = await response.json();
    res.json(iceServers);
  } catch (err) {
    console.error('Failed to fetch TURN credentials:', err);
    res.json([ // Fallback on failure
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]);
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let waitingUsers = [];
const activePairs = new Map(); // socket.id -> { peerId, room }
const userNames = new Map(); // socket.id -> name
const userCountries = new Map(); // socket.id -> {name, code}

io.on('connection', (socket) => {
  console.log(`[Socket] New connection attempt: ${socket.id}`);

  socket.on('set_identity', ({ name, country }) => {
    userNames.set(socket.id, name);
    userCountries.set(socket.id, country);
    const info = activePairs.get(socket.id);
    if (info) {
      socket.to(info.peerId).emit('update_remote_identity', { name, country });
    }
  });

  socket.on('find_match', () => {
    console.log(`[Match] User ${socket.id} looking for peer...`);

    if (activePairs.has(socket.id)) {
      const info = activePairs.get(socket.id);
      socket.to(info.peerId).emit('peer_disconnected');
      socket.leave(info.room);
      activePairs.delete(socket.id);
      activePairs.delete(info.peerId);
    }

    waitingUsers = waitingUsers.filter(id => id !== socket.id);

    if (waitingUsers.length > 0) {
      const peerId = waitingUsers.shift();
      const room = `room-${socket.id}-${peerId}`;

      activePairs.set(socket.id, { peerId, room });
      activePairs.set(peerId, { peerId: socket.id, room });

      socket.join(room);
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket) peerSocket.join(room);

      const myName = userNames.get(socket.id) || 'Qof';
      const peerName = userNames.get(peerId) || 'Qof';
      const myCountry = userCountries.get(socket.id) || { name: '', code: '' };
      const peerCountry = userCountries.get(peerId) || { name: '', code: '' };

      io.to(socket.id).emit('match_found', { peerId, initiator: true, peerName, peerCountry });
      io.to(peerId).emit('match_found', { peerId: socket.id, initiator: false, peerName: myName, peerCountry: myCountry });

      console.log(`[Match] Paired ${socket.id} with ${peerId}`);
    } else {
      waitingUsers.push(socket.id);
    }
  });

  socket.on('signal', ({ peerId, signal }) => {
    socket.to(peerId).emit('signal', { signal, peerId: socket.id });
  });

  socket.on('media_state', ({ audio, video }) => {
    const info = activePairs.get(socket.id);
    if (info) {
      socket.to(info.peerId).emit('peer_media_state', { audio, video });
    }
  });

  socket.on('friend_request', () => {
    const info = activePairs.get(socket.id);
    if (info) {
      socket.to(info.peerId).emit('receive_friend_request', { fromName: userNames.get(socket.id) });
    }
  });

  socket.on('send_message', (message) => {
    const info = activePairs.get(socket.id);
    if (info) {
      socket.to(info.peerId).emit('receive_message', { message, senderId: socket.id });
    }
  });

  socket.on('game_action', (data) => {
    const info = activePairs.get(socket.id);
    if (info) {
      socket.to(info.peerId).emit('game_action', data);
    }
  });

  socket.on('disconnect', () => {
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    userNames.delete(socket.id);
    const info = activePairs.get(socket.id);
    if (info) {
      socket.to(info.peerId).emit('peer_disconnected');
      activePairs.delete(socket.id);
      activePairs.delete(info.peerId);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT}`);
});
