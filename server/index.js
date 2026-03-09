const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let waitingUsers = [];
const activePairs = new Map(); // socket.id -> peerSocket.id

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('find_match', () => {
    // Remove if already in waiting list
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    
    // Disconnect from current pair if any
    if (activePairs.has(socket.id)) {
      const peerId = activePairs.get(socket.id);
      socket.to(peerId).emit('peer_disconnected');
      activePairs.delete(socket.id);
      activePairs.delete(peerId);
    }

    if (waitingUsers.length > 0) {
      const peerId = waitingUsers.shift();
      activePairs.set(socket.id, peerId);
      activePairs.set(peerId, socket.id);

      // Notify both users to start WebRTC
      // One will be initiator, the other will not
      io.to(socket.id).emit('match_found', { peerId, initiator: true });
      io.to(peerId).emit('match_found', { peerId: socket.id, initiator: false });
      
      console.log(`Matched ${socket.id} with ${peerId}`);
    } else {
      waitingUsers.push(socket.id);
      console.log(`User ${socket.id} is waiting for a match`);
    }
  });

  socket.on('signal', ({ peerId, signal }) => {
    socket.to(peerId).emit('signal', { signal, peerId: socket.id });
  });

  socket.on('send_message', (message) => {
    const peerId = activePairs.get(socket.id);
    if (peerId) {
      socket.to(peerId).emit('receive_message', { message, senderId: socket.id });
    }
  });

  socket.on('game_action', (data) => {
    const peerId = activePairs.get(socket.id);
    if (peerId) {
      socket.to(peerId).emit('game_action', data);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    const peerId = activePairs.get(socket.id);
    if (peerId) {
      socket.to(peerId).emit('peer_disconnected');
      activePairs.delete(socket.id);
      activePairs.delete(peerId);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
