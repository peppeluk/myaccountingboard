// ============================================================
// WEBSOCKET SERVER - MULTI-ROOM CON USER TRACKING
// ============================================================
// Salva come: apps/sync-server/server-multiroom.js

const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const PORT = 3001;
const app = express();

app.use(cors());
app.use(express.json());

const httpServer = app.listen(PORT, () => {
  console.log(`🚀 Sync Server (Multi-Room) running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP: http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server: httpServer });

// Strutture dati
let rooms = new Map(); // roomId -> Set of {ws, clientId, nickname, connectedAt}
let canvasStates = new Map(); // roomId -> latest canvas state
let stats = {
  totalConnections: 0,
  activeConnections: 0,
  messagesSent: 0,
  messagesReceived: 0
};

wss.on('connection', (ws, req) => {
  stats.totalConnections++;
  stats.activeConnections++;
  
  const clientIp = req.socket.remoteAddress;
  console.log(`✅ Client connected: ${clientIp} (Total: ${stats.activeConnections})`);

  let currentRoom = null;
  let clientId = null;
  let nickname = null;

  ws.on('message', (message) => {
    stats.messagesReceived++;
    
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          handleJoin(ws, data);
          break;
        
        case 'leave':
          handleLeave(ws, data);
          break;
        
        case 'canvas-update':
          handleCanvasUpdate(ws, data);
          break;
        
        case 'canvas-full':
          handleCanvasFullSync(ws, data);
          break;
        
        case 'request-state':
          handleRequestState(ws, data);
          break;
        
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
          break;
        
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    stats.activeConnections--;
    
    if (currentRoom && rooms.has(currentRoom)) {
      // Rimuovi client dalla room
      const roomClients = rooms.get(currentRoom);
      for (const client of roomClients) {
        if (client.ws === ws) {
          roomClients.delete(client);
          break;
        }
      }
      
      if (roomClients.size === 0) {
        rooms.delete(currentRoom);
        canvasStates.delete(currentRoom);
        console.log(`🗑️  Room ${currentRoom} deleted (empty)`);
      } else {
        // Notifica altri client
        broadcast(currentRoom, {
          type: 'client-disconnected',
          clientId,
          nickname
        }, ws);
        
        // Invia lista aggiornata
        broadcastUserList(currentRoom);
      }
    }
    
    console.log(`❌ Client disconnected: ${clientIp} (Remaining: ${stats.activeConnections})`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // ============================================================
  // HANDLER FUNCTIONS
  // ============================================================

  function handleJoin(ws, data) {
    const { roomId, clientId: id, nickname: nick } = data;
    
    // Se già in una room, esci prima
    if (currentRoom) {
      handleLeave(ws, { roomId: currentRoom });
    }
    
    currentRoom = roomId;
    clientId = id;
    nickname = nick;
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const clientData = {
      ws,
      clientId: id,
      nickname: nick,
      connectedAt: Date.now()
    };
    
    rooms.get(roomId).add(clientData);
    
    console.log(`🔗 Client ${nickname || clientId} joined room ${roomId} (${rooms.get(roomId).size} clients)`);
    
    // Invia stato corrente se esiste
    if (canvasStates.has(roomId)) {
      ws.send(JSON.stringify({
        type: 'initial-state',
        state: canvasStates.get(roomId)
      }));
    }
    
    // Notifica altri client
    broadcast(roomId, {
      type: 'client-joined',
      clientId: id,
      nickname: nick
    }, ws);
    
    // Invia lista utenti a tutti
    broadcastUserList(roomId);
  }

  function handleLeave(ws, data) {
    const { roomId } = data;
    
    if (!rooms.has(roomId)) return;
    
    const roomClients = rooms.get(roomId);
    
    // Trova e rimuovi client
    for (const client of roomClients) {
      if (client.ws === ws) {
        roomClients.delete(client);
        
        console.log(`🚪 Client ${client.nickname || client.clientId} left room ${roomId}`);
        
        // Notifica altri
        broadcast(roomId, {
          type: 'client-disconnected',
          clientId: client.clientId,
          nickname: client.nickname
        }, ws);
        
        break;
      }
    }
    
    // Cleanup room se vuota
    if (roomClients.size === 0) {
      rooms.delete(roomId);
      canvasStates.delete(roomId);
      console.log(`🗑️  Room ${roomId} deleted (empty)`);
    } else {
      broadcastUserList(roomId);
    }
    
    currentRoom = null;
  }

  function handleCanvasUpdate(ws, data) {
    if (!currentRoom) return;
    
    broadcast(currentRoom, {
      type: 'canvas-update',
      update: data.update,
      clientId: data.clientId
    }, ws);
  }

  function handleCanvasFullSync(ws, data) {
    if (!currentRoom) return;
    
    // Salva stato completo
    canvasStates.set(currentRoom, data.state);
    
    // Broadcast a tutti tranne mittente
    broadcast(currentRoom, {
      type: 'canvas-full',
      state: data.state,
      clientId: data.clientId
    }, ws);
  }

  function handleRequestState(ws, data) {
    if (!data.roomId) return;
    
    if (canvasStates.has(data.roomId)) {
      ws.send(JSON.stringify({
        type: 'initial-state',
        state: canvasStates.get(data.roomId)
      }));
    }
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function broadcast(roomId, message, exclude = null) {
  if (!rooms.has(roomId)) return;
  
  const messageStr = JSON.stringify(message);
  let sent = 0;
  
  rooms.get(roomId).forEach((client) => {
    if (client.ws !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
      sent++;
      stats.messagesSent++;
    }
  });
  
  return sent;
}

function broadcastUserList(roomId) {
  if (!rooms.has(roomId)) return;
  
  const users = Array.from(rooms.get(roomId)).map(client => ({
    clientId: client.clientId,
    nickname: client.nickname,
    connectedAt: client.connectedAt
  }));
  
  broadcast(roomId, {
    type: 'user-list',
    users
  });
}

// ============================================================
// HTTP ENDPOINTS
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    stats,
    rooms: Array.from(rooms.keys()).map(roomId => ({
      roomId,
      clients: Array.from(rooms.get(roomId)).map(c => ({
        clientId: c.clientId,
        nickname: c.nickname,
        connectedAt: c.connectedAt
      })),
      hasState: canvasStates.has(roomId)
    }))
  });
});

app.get('/stats', (req, res) => {
  res.json(stats);
});

app.get('/rooms', (req, res) => {
  res.json({
    rooms: Array.from(rooms.entries()).map(([roomId, clients]) => ({
      roomId,
      clientCount: clients.size,
      clients: Array.from(clients).map(c => ({
        nickname: c.nickname || c.clientId.slice(-8)
      }))
    }))
  });
});

// ============================================================
// CLEANUP & SHUTDOWN
// ============================================================

setInterval(() => {
  rooms.forEach((clients, roomId) => {
    clients.forEach((client) => {
      if (client.ws.readyState !== WebSocket.OPEN) {
        clients.delete(client);
      }
    });
    
    if (clients.size === 0) {
      rooms.delete(roomId);
      canvasStates.delete(roomId);
    }
  });
}, 30000);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  wss.close(() => {
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});

console.log('\n📋 Server Info:');
console.log('   - Mode: Multi-Room');
console.log('   - User Tracking: Enabled');
console.log('   - Health: http://localhost:3001/health');
console.log('   - Rooms: http://localhost:3001/rooms');
console.log('\n');
