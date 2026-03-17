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
  body('username').trim().isLength({ min: 3, max: 20 }).withMessage('Nazwa musi miec 3-20 znakow.'),
  body('email').isEmail().withMessage('Podaj prawidlowy email.'),
  body('password').isLength({ min: 6 }).withMessage('Haslo musi miec min. 6 znakow.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.json({ success: false, errors: errors.array().map(e => e.msg) });
  const { username, email, password } = req.body;
  const existing = await db.get2('SELECT id FROM users WHERE username=? OR email=?', [username, email]);
  if (existing) return res.json({ success: false, errors: ['Nazwa lub email juz istnieje.'] });
  const hash = await bcrypt.hash(password, 10);
  const result = await db.run2('INSERT INTO users (username, email, password) VALUES (?,?,?)', [username, email, hash]);
  req.session.userId = result.lastID;
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
  const user = await db.get2('SELECT * FROM users WHERE username=?', [username]);
  if (!user) return res.json({ success: false, errors: ['Nieprawidlowa nazwa lub haslo.'] });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, errors: ['Nieprawidlowa nazwa lub haslo.'] });
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
