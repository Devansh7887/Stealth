const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with CORS configuration (allowing your React app to connect)
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"], // Default Vite ports
    methods: ["GET", "POST"]
  }
});

// Listen for incoming connections
io.on('connection', (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // Listen for 'send_message' events from a client
  socket.on('send_message', (data) => {
    console.log('Message received:', data);
    
    // Broadcast the message to EVERYONE else connected
    // For a 1-on-1 private chat, you would use socket.to(room).emit() instead
    socket.broadcast.emit('receive_message', data);
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    console.log(`User Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`[STEALTH BACKEND] Server running on port ${PORT}`);
});