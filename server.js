const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const wss = new WebSocket.Server({ server });
const chatClients = new Map();

wss.on('connection', (ws) => {
  ws.bookingId = null;
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'join') {
        ws.bookingId = String(data.bookingId);
        ws.username = data.username || 'Gracz';
        if (!chatClients.has(ws.bookingId)) chatClients.set(ws.bookingId, new Set());
        chatClients.get(ws.bookingId).add(ws);
      }
    } catch(e) {}
  });
  ws.on('close', () => {
    if (ws.bookingId && chatClients.has(ws.bookingId)) {
      chatClients.get(ws.bookingId).delete(ws);
    }
  });
});

app.broadcastChat = (bookingId, message) => {
  const room = chatClients.get(String(bookingId));
  if (!room) return;
  const payload = JSON.stringify(message);
  room.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(payload); });
};

app.use('/api/discord/interactions', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'expowisko_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/api')(app));

const pages = { '/': 'index.html', '/dashboard': 'dashboard.html', '/admin': 'admin.html', '/slots': 'slots.html', '/status': 'status.html' };
Object.entries(pages).forEach(([p, file]) => app.get(p, (req, res) => res.sendFile(file, { root: './public' })));

server.listen(PORT, () => console.log('Serwer dziala na porcie ' + PORT));
