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

io.on('connection', (socket) => {
  console.log(`[Socket] New connection attempt: ${socket.id} from ${socket.handshake.address}`);

  socket.on('find_match', () => {
    console.log(`[Match] User ${socket.id} looking for peer...`);

    // Clean up old matches
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

      // pair logic: initiator vs receiver
      io.to(socket.id).emit('match_found', { peerId, initiator: true });
      io.to(peerId).emit('match_found', { peerId: socket.id, initiator: false });

      console.log(`[Match] Paired ${socket.id} with ${peerId}`);
    } else {
      waitingUsers.push(socket.id);
      console.log(`[Queue] User ${socket.id} added to queue. Size: ${waitingUsers.length}`);
    }
  });

  socket.on('signal', ({ peerId, signal }) => {
    // Forward WebRTC handshakes (offer, answer, candidates)
    socket.to(peerId).emit('signal', { signal, peerId: socket.id });
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
    console.log('User disconnected:', socket.id);
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
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
