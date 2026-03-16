const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data dir
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'projekhard_secret_key_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Routes
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/api'));

// SPA fallback for HTML pages
const pages = ['/', '/dashboard', '/admin', '/book'];
pages.forEach(p => {
  app.get(p, (req, res) => {
    const file = p === '/' ? 'index.html' :
                 p === '/dashboard' ? 'dashboard.html' :
                 p === '/admin' ? 'admin.html' :
                 p === '/book' ? 'book.html' : 'index.html';
    res.sendFile(file, { root: './public' });
  });
});

app.listen(PORT, () => {
  console.log(`✅ Metin2 Booking działa na porcie ${PORT}`);
});
