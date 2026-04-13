const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

const defaultAllowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const envOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (health checks, CLI tools, server-to-server calls).
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS blocked for this origin"));
  },
  methods: ["GET", "POST"],
};

app.use(cors(corsOptions));

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with CORS configuration (allowing your React app to connect)
const io = new Server(server, {
  cors: corsOptions,
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