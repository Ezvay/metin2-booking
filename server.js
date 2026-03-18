const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

app.use('/api/discord/interactions', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'expowisko_v4_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use('/', require('./routes/api'));

// Public pages
const publicPages = { '/': 'index.html', '/slots': 'slots.html', '/status': 'status.html' };
Object.entries(publicPages).forEach(([p, f]) => app.get(p, (req, res) => res.sendFile(f, { root: './public' })));

// Admin pages
app.get('/admin', (req, res) => {
  if (!req.session.adminId) return res.redirect('/admin/login');
  res.sendFile('admin.html', { root: './public' });
});
app.get('/admin/login', (req, res) => res.sendFile('admin-login.html', { root: './public' }));

app.listen(PORT, () => console.log('Serwer dziala na porcie ' + PORT));
