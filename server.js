const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

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
app.use('/', require('./routes/api'));

const pages = ['/', '/dashboard', '/admin', '/book', '/calendar'];
pages.forEach(p => {
  app.get(p, (req, res) => {
    const map = { '/': 'index.html', '/dashboard': 'dashboard.html', '/admin': 'admin.html', '/book': 'book.html', '/calendar': 'calendar.html' };
    res.sendFile(map[p], { root: './public' });
  });
});

app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
