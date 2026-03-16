const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/api/services', (req, res) => {
  const services = db.prepare('SELECT * FROM services WHERE available=1').all();
  res.json(services);
});

router.get('/api/session', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, username: req.session.username, role: req.session.role });
  } else {
    res.json({ loggedIn: false });
  }
});

router.post('/api/bookings', requireAuth, (req, res) => {
  const { service_id, char_name, char_class, char_level, target_level, contact_discord, note, booked_date, booked_time } = req.body;
  if (!service_id || !char_name || !char_class || !char_level || !target_level || !booked_date || !booked_time) {
    return res.json({ success: false, error: 'Wypełnij wszystkie wymagane pola.' });
  }
  const service = db.prepare('SELECT * FROM services WHERE id=? AND available=1').get(service_id);
  if (!service) return res.json({ success: false, error: 'Usługa niedostępna.' });
  db.prepare(`
    INSERT INTO bookings (user_id, service_id, char_name, char_class, char_level, target_level, contact_discord, note, booked_date, booked_time)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(req.session.userId, service_id, char_name, char_class, char_level, target_level, contact_discord || '', note || '', booked_date, booked_time);
  res.json({ success: true });
});

router.get('/api/my-bookings', requireAuth, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, s.name as service_name, s.price_gold, s.duration_hours
    FROM bookings b
    JOIN services s ON b.service_id = s.id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
  `).all(req.session.userId);
  res.json(bookings);
});

router.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, s.name as service_name, u.username
    FROM bookings b
    JOIN services s ON b.service_id = s.id
    JOIN users u ON b.user_id = u.id
    ORDER BY b.created_at DESC
  `).all();
  res.json(bookings);
});

router.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

module.exports = router;
