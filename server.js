const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

const PRESENCE_COLORS = [
  '#e63946', '#f4a261', '#2a9d8f', '#264653',
  '#e76f51', '#457b9d', '#8338ec', '#ff006e',
  '#3a86ff', '#06d6a0', '#ffbe0b', '#c9184a',
];
let nextColorIndex = 0;

// In-memory board state: object id -> object data, plus draw order for z-index.
const board = {
  objects: new Map(),
  order: [],
};

// Connected users: socket.id -> { id, name, color }
const users = new Map();

function assignColor() {
  const color = PRESENCE_COLORS[nextColorIndex % PRESENCE_COLORS.length];
  nextColorIndex += 1;
  return color;
}

function serializeObjects() {
  return board.order
    .filter((id) => board.objects.has(id))
    .map((id) => board.objects.get(id));
}

function serializeUsers() {
  return Array.from(users.values());
}

io.on('connection', (socket) => {
  socket.on('user:join', ({ name }) => {
    const safeName = (name || 'Guest').toString().slice(0, 40);
    const user = { id: socket.id, name: safeName, color: assignColor() };
    users.set(socket.id, user);

    socket.emit('board:init', {
      self: user,
      users: serializeUsers(),
      objects: serializeObjects(),
    });

    socket.broadcast.emit('user:joined', user);
  });

  socket.on('object:add', (obj) => {
    if (!obj || !obj.id) return;
    board.objects.set(obj.id, obj);
    board.order.push(obj.id);
    socket.broadcast.emit('object:add', obj);
  });

  socket.on('object:update', ({ id, props }) => {
    const existing = board.objects.get(id);
    if (!existing) return;
    Object.assign(existing, props);
    socket.broadcast.emit('object:update', { id, props });
  });

  socket.on('object:delete', ({ id }) => {
    if (!board.objects.has(id)) return;
    board.objects.delete(id);
    board.order = board.order.filter((existingId) => existingId !== id);
    socket.broadcast.emit('object:delete', { id });
  });

  socket.on('cursor:move', ({ x, y }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.broadcast.emit('cursor:move', { id: socket.id, x, y });
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    socket.broadcast.emit('user:left', { id: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Whiteboard server running at http://localhost:${PORT}`);
});
