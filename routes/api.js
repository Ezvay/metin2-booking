const express = require('express');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendBookingNotification, handleInteraction } = require('../discord');
const crypto = require('crypto');

module.exports = function(app) {
  const router = express.Router();

  // SESSION
  router.get('/api/session', (req, res) => {
    if (req.session.userId) {
      res.json({ loggedIn: true, username: req.session.username, role: req.session.role, userId: req.session.userId });
    } else {
      res.json({ loggedIn: false });
    }
  });

  // ── PUBLIC SLOTS ─────────────────────────────────────────────
  router.get('/api/slots', async (req, res) => {
    const slots = await db.all2(`
      SELECT s.*, COUNT(b.id) as booked_count
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id AND b.status != 'rejected' AND b.status != 'cancelled'
      WHERE s.status = 'open' AND s.date >= date('now')
      GROUP BY s.id
      ORDER BY s.date ASC, s.time ASC
    `);
    for (const slot of slots) {
      slot.spots_left = slot.max_players - slot.booked_count;
      slot.bookings = await db.all2(`
        SELECT b.id, b.char_name, b.char_class, b.char_level, b.status, u.username
        FROM bookings b JOIN users u ON b.user_id = u.id
        WHERE b.slot_id = ? AND b.status != 'rejected' AND b.status != 'cancelled'
      `, [slot.id]);
    }
    res.json(slots);
  });

  // ── BOOK A SLOT ───────────────────────────────────────────────
  router.post('/api/slots/:id/book', requireAuth, async (req, res) => {
    const { char_name, char_class, char_level, contact_discord, coupon_code } = req.body;
    if (!char_name || !char_class || !char_level || !contact_discord) {
      return res.json({ success: false, error: 'Wypelnij wszystkie wymagane pola.' });
    }

    const slot = await db.get2(`
      SELECT s.*, COUNT(b.id) as booked_count
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id AND b.status != 'rejected' AND b.status != 'cancelled'
      WHERE s.id = ? AND s.status = 'open'
      GROUP BY s.id
    `, [req.params.id]);

    if (!slot) return res.json({ success: false, error: 'Slot niedostepny.' });
    if (slot.booked_count >= slot.max_players) return res.json({ success: false, error: 'Slot jest juz pelny.' });

    // Check if user already booked this slot
    const existing = await db.get2(
      'SELECT id FROM bookings WHERE slot_id=? AND user_id=? AND status NOT IN (\'rejected\',\'cancelled\')',
      [req.params.id, req.session.userId]
    );
    if (existing) return res.json({ success: false, error: 'Juz zabukowales ten slot.' });

    // Handle coupon
    let discount = 0;
    if (coupon_code) {
      const coupon = await db.get2('SELECT * FROM coupons WHERE code=?', [coupon_code.toUpperCase()]);
      if (coupon && coupon.uses < coupon.max_uses && (!coupon.expires_at || new Date(coupon.expires_at) > new Date())) {
        discount = coupon.discount_percent;
        await db.run2('UPDATE coupons SET uses=uses+1 WHERE id=?', [coupon.id]);
      }
    }

    const token = crypto.randomBytes(12).toString('hex');
    const result = await db.run2(
      `INSERT INTO bookings (slot_id, user_id, char_name, char_class, char_level, contact_discord, status_token) VALUES (?,?,?,?,?,?,?)`,
      [req.params.id, req.session.userId, char_name, char_class, char_level, contact_discord, token]
    );

    const spotsLeft = slot.max_players - slot.booked_count - 1;

    sendBookingNotification({
      type: 'new_booking',
      bookingId: result.lastID,
      slotId: slot.id,
      packageName: slot.package_name,
      date: slot.date,
      time: slot.time,
      maxPlayers: slot.max_players,
      spotsLeft: spotsLeft,
      charName: char_name,
      charClass: char_class,
      charLevel: char_level,
      username: req.session.username,
      discord: contact_discord,
      note: slot.note
    }).catch(console.error);

    res.json({ success: true, statusToken: token, discount });
  });

  // ── MY BOOKINGS ──────────────────────────────────────────────
  router.get('/api/my-bookings', requireAuth, async (req, res) => {
    const bookings = await db.all2(`
      SELECT b.*, s.date, s.time, s.package_name, s.package_type, s.price_sm, s.max_players, s.note as slot_note
      FROM bookings b JOIN slots s ON b.slot_id = s.id
      WHERE b.user_id = ? AND b.status != 'cancelled'
      ORDER BY s.date DESC, s.time DESC
    `, [req.session.userId]);

    for (const b of bookings) {
      b.slot_bookings = await db.all2(`
        SELECT b2.char_name, b2.char_class, b2.char_level, u.username
        FROM bookings b2 JOIN users u ON b2.user_id = u.id
        WHERE b2.slot_id = ? AND b2.status NOT IN ('rejected','cancelled')
      `, [b.slot_id]);
      const review = await db.get2('SELECT id FROM reviews WHERE booking_id=? AND user_id=?', [b.id, req.session.userId]);
      b.reviewed = !!review;
    }
    res.json(bookings);
  });

  // ── CANCEL BOOKING ───────────────────────────────────────────
  router.post('/api/bookings/:id/cancel', requireAuth, async (req, res) => {
    const booking = await db.get2(
      'SELECT * FROM bookings WHERE id=? AND user_id=?',
      [req.params.id, req.session.userId]
    );
    if (!booking) return res.json({ success: false, error: 'Nie znaleziono rezerwacji.' });
    if (booking.status === 'done') return res.json({ success: false, error: 'Nie mozna anulowac ukonczonej rezerwacji.' });
    await db.run2('UPDATE bookings SET status=? WHERE id=?', ['cancelled', req.params.id]);
    res.json({ success: true });
  });

  // ── STATUS PAGE ──────────────────────────────────────────────
  router.get('/api/status/:token', async (req, res) => {
    const booking = await db.get2(`
      SELECT b.*, s.date, s.time, s.package_name, s.package_type, s.price_sm, s.max_players
      FROM bookings b JOIN slots s ON b.slot_id = s.id
      WHERE b.status_token = ?
    `, [req.params.token]);
    if (!booking) return res.status(404).json({ error: 'Nie znaleziono rezerwacji.' });
    booking.slot_bookings = await db.all2(`
      SELECT b2.char_name, b2.char_class, b2.char_level, u.username
      FROM bookings b2 JOIN users u ON b2.user_id = u.id
      WHERE b2.slot_id = ? AND b2.status NOT IN ('rejected','cancelled')
    `, [booking.slot_id]);
    res.json(booking);
  });

  // ── REVIEWS ──────────────────────────────────────────────────
  router.post('/api/reviews', requireAuth, async (req, res) => {
    const { booking_id, rating, comment } = req.body;
    if (!booking_id || !rating || rating < 1 || rating > 5) return res.json({ success: false, error: 'Nieprawidlowe dane.' });
    const booking = await db.get2('SELECT * FROM bookings WHERE id=? AND user_id=? AND status=?', [booking_id, req.session.userId, 'done']);
    if (!booking) return res.json({ success: false, error: 'Nie mozesz ocenic tej rezerwacji.' });
    const existing = await db.get2('SELECT id FROM reviews WHERE booking_id=? AND user_id=?', [booking_id, req.session.userId]);
    if (existing) return res.json({ success: false, error: 'Juz oceniles.' });
    await db.run2('INSERT INTO reviews (booking_id, user_id, rating, comment) VALUES (?,?,?,?)', [booking_id, req.session.userId, rating, comment || '']);
    res.json({ success: true });
  });

  router.get('/api/reviews', async (req, res) => {
    const reviews = await db.all2(`
      SELECT r.*, u.username, s.package_name
      FROM reviews r JOIN users u ON r.user_id = u.id
      JOIN bookings b ON r.booking_id = b.id
      JOIN slots s ON b.slot_id = s.id
      ORDER BY r.created_at DESC LIMIT 20
    `);
    res.json(reviews);
  });

  // ── COUPON CHECK ─────────────────────────────────────────────
  router.post('/api/coupons/check', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.json({ valid: false });
    const coupon = await db.get2('SELECT * FROM coupons WHERE code=?', [code.toUpperCase()]);
    if (!coupon) return res.json({ valid: false, error: 'Nieprawidlowy kupon.' });
    if (coupon.uses >= coupon.max_uses) return res.json({ valid: false, error: 'Kupon wykorzystany.' });
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.json({ valid: false, error: 'Kupon wygasl.' });
    res.json({ valid: true, discount: coupon.discount_percent, code: coupon.code });
  });

  // ── CHAT ─────────────────────────────────────────────────────
  router.get('/api/chat/:bookingId', requireAuth, async (req, res) => {
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin) {
      const b = await db.get2('SELECT id FROM bookings WHERE id=? AND user_id=?', [req.params.bookingId, req.session.userId]);
      if (!b) return res.status(403).json({ error: 'Brak dostepu.' });
    }
    const msgs = await db.all2(`
      SELECT cm.*, u.username FROM chat_messages cm
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.booking_id=? ORDER BY cm.created_at ASC
    `, [req.params.bookingId]);
    res.json(msgs);
  });

  router.post('/api/chat/:bookingId', requireAuth, async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) return res.json({ success: false });
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin) {
      const b = await db.get2('SELECT id FROM bookings WHERE id=? AND user_id=?', [req.params.bookingId, req.session.userId]);
      if (!b) return res.status(403).json({ error: 'Brak dostepu.' });
    }
    const result = await db.run2(
      'INSERT INTO chat_messages (booking_id, user_id, is_admin, message) VALUES (?,?,?,?)',
      [req.params.bookingId, req.session.userId, isAdmin ? 1 : 0, message.trim()]
    );
    const msg = { id: result.lastID, booking_id: req.params.bookingId, user_id: req.session.userId, username: req.session.username, is_admin: isAdmin ? 1 : 0, message: message.trim(), created_at: new Date().toISOString() };
    app.broadcastChat(req.params.bookingId, { type: 'message', data: msg });
    res.json({ success: true, message: msg });
  });

  // ── ADMIN: SLOTS ──────────────────────────────────────────────
  router.get('/api/admin/slots', requireAdmin, async (req, res) => {
    const slots = await db.all2(`
      SELECT s.*, COUNT(b.id) as booked_count
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id AND b.status NOT IN ('rejected','cancelled')
      GROUP BY s.id
      ORDER BY s.date DESC, s.time DESC
    `);
    for (const slot of slots) {
      slot.spots_left = slot.max_players - slot.booked_count;
      slot.bookings = await db.all2(`
        SELECT b.id, b.char_name, b.char_class, b.char_level, b.status, b.contact_discord, u.username
        FROM bookings b JOIN users u ON b.user_id = u.id
        WHERE b.slot_id = ? AND b.status NOT IN ('rejected','cancelled')
      `, [slot.id]);
    }
    res.json(slots);
  });

  router.post('/api/admin/slots', requireAdmin, async (req, res) => {
    const { date, time, package_name, package_type, max_players, price_sm, note } = req.body;
    if (!date || !time || !package_name || !package_type || !max_players || !price_sm) {
      return res.json({ success: false, error: 'Wypelnij wszystkie pola.' });
    }
    const result = await db.run2(
      'INSERT INTO slots (date, time, package_name, package_type, max_players, price_sm, note) VALUES (?,?,?,?,?,?,?)',
      [date, time, package_name, package_type, max_players, price_sm, note || '']
    );
    res.json({ success: true, id: result.lastID });
  });

  router.patch('/api/admin/slots/:id', requireAdmin, async (req, res) => {
    const { status } = req.body;
    await db.run2('UPDATE slots SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ success: true });
  });

  router.delete('/api/admin/slots/:id', requireAdmin, async (req, res) => {
    await db.run2('UPDATE slots SET status=? WHERE id=?', ['deleted', req.params.id]);
    res.json({ success: true });
  });

  // ── ADMIN: BOOKINGS ───────────────────────────────────────────
  router.get('/api/admin/bookings', requireAdmin, async (req, res) => {
    const bookings = await db.all2(`
      SELECT b.*, s.date, s.time, s.package_name, s.price_sm, s.max_players, u.username
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN users u ON b.user_id = u.id
      WHERE b.status != 'cancelled'
      ORDER BY s.date DESC, s.time DESC
    `);
    res.json(bookings);
  });

  router.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
    await db.run2('UPDATE bookings SET status=? WHERE id=?', [req.body.status, req.params.id]);
    res.json({ success: true });
  });

  router.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
    await db.run2('UPDATE bookings SET status=? WHERE id=?', ['cancelled', req.params.id]);
    res.json({ success: true });
  });

  // ── ADMIN: STATS ──────────────────────────────────────────────
  router.get('/api/admin/stats', requireAdmin, async (req, res) => {
    const totalSlots = await db.get2("SELECT COUNT(*) as c FROM slots WHERE status != 'deleted'");
    const totalBookings = await db.get2("SELECT COUNT(*) as c FROM bookings WHERE status != 'cancelled'");
    const doneBookings = await db.get2("SELECT COUNT(*) as c FROM bookings WHERE status='done'");
    const totalUsers = await db.get2("SELECT COUNT(*) as c FROM users WHERE role='user'");
    const avgRating = await db.get2("SELECT AVG(rating) as avg FROM reviews");
    const totalReviews = await db.get2("SELECT COUNT(*) as c FROM reviews");
    const byPackage = await db.all2(`
      SELECT s.package_name, s.package_type, COUNT(b.id) as count
      FROM bookings b JOIN slots s ON b.slot_id = s.id
      WHERE b.status = 'done'
      GROUP BY s.package_type
    `);
    const byMonth = await db.all2(`
      SELECT strftime('%Y-%m', s.date) as month, COUNT(b.id) as count
      FROM bookings b JOIN slots s ON b.slot_id = s.id
      WHERE b.status != 'cancelled'
      GROUP BY month ORDER BY month DESC LIMIT 6
    `);
    res.json({
      totalSlots: totalSlots.c, totalBookings: totalBookings.c,
      doneBookings: doneBookings.c, totalUsers: totalUsers.c,
      avgRating: avgRating.avg ? Math.round(avgRating.avg * 10) / 10 : 0,
      totalReviews: totalReviews.c, byPackage, byMonth: byMonth.reverse()
    });
  });

  // ── ADMIN: COUPONS ────────────────────────────────────────────
  router.get('/api/admin/coupons', requireAdmin, async (req, res) => {
    res.json(await db.all2('SELECT * FROM coupons ORDER BY created_at DESC'));
  });

  router.post('/api/admin/coupons', requireAdmin, async (req, res) => {
    const { code, discount_percent, max_uses, expires_at } = req.body;
    if (!code || !discount_percent) return res.json({ success: false, error: 'Podaj kod i rabat.' });
    const existing = await db.get2('SELECT id FROM coupons WHERE code=?', [code.toUpperCase()]);
    if (existing) return res.json({ success: false, error: 'Taki kod juz istnieje.' });
    await db.run2('INSERT INTO coupons (code, discount_percent, max_uses, expires_at) VALUES (?,?,?,?)',
      [code.toUpperCase(), discount_percent, max_uses || 1, expires_at || null]);
    res.json({ success: true });
  });

  router.delete('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    await db.run2('DELETE FROM coupons WHERE id=?', [req.params.id]);
    res.json({ success: true });
  });

  // ── DISCORD INTERACTIONS ──────────────────────────────────────
  router.post('/api/discord/interactions', async (req, res) => {
    try {
      const signature = req.headers['x-signature-ed25519'];
      const timestamp = req.headers['x-signature-timestamp'];
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      const bodyStr = rawBody.toString('utf-8');
      if (publicKey && signature && timestamp) {
        const nacl = require('tweetnacl');
        const isValid = nacl.sign.detached.verify(
          Buffer.from(timestamp + bodyStr),
          Buffer.from(signature, 'hex'),
          Buffer.from(publicKey, 'hex')
        );
        if (!isValid) return res.status(401).json({ error: 'Invalid signature' });
      }
      const interaction = JSON.parse(bodyStr);
      if (interaction.type === 1) return res.json({ type: 1 });
      const response = await handleInteraction(interaction, db);
      res.json(response);
    } catch (err) {
      console.error('Interaction error:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
};
