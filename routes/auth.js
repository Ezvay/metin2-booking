const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile('register.html', { root: './public' });
});

router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 20 }).withMessage('Nazwa musi mieć 3–20 znaków.'),
  body('email').isEmail().withMessage('Podaj prawidłowy email.'),
  body('password').isLength({ min: 6 }).withMessage('Hasło musi mieć min. 6 znaków.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.json({ success: false, errors: errors.array().map(e => e.msg) });
  }
  const { username, email, password } = req.body;
  const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email);
  if (existing) {
    return res.json({ success: false, errors: ['Nazwa użytkownika lub email już istnieje.'] });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?,?,?)').run(username, email, hash);
  req.session.userId = result.lastInsertRowid;
  req.session.username = username;
  req.session.role = 'user';
  res.json({ success: true, redirect: '/' });
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile('login.html', { root: './public' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.json({ success: false, errors: ['Nieprawidłowa nazwa lub hasło.'] });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, errors: ['Nieprawidłowa nazwa lub hasło.'] });
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ success: true, redirect: req.body.redirect || '/' });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
