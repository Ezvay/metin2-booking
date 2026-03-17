const express = require('express');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendBookingNotification, handleInteraction } = require('../discord');
const crypto = require('crypto');

module.exports = function(app) {
  const router = express.Router();

  // ── SESSION ──────────────────────────────────────────────────
  router.get('/api/session', (req, res) => {
    if (req.session.userId) {
      res.json({ loggedIn: true, username: req.session.username, role: req.session.role, userId: req.session.userId });
    } else {
      res.json({ loggedIn: false });
    }
  });

  // ── SERVICES ─────────────────────────────────────────────────
  router.get('/api/services', async (req, res) => {
    const services = await db.all2('SELECT * FROM services WHERE available=1');
    res.json(services);
  });

  // ── CALENDAR ─────────────────────────────────────────────────
  router.get('/api/calendar', async (req, res) => {
    const bookings = await db.all2(`
      SELECT b.id, b.booked_date, b.booked_time, b.status, b.note,
             s.name as service_name, s.party_size, s.price_sm, s.id as service_id
      FROM bookings b JOIN services s ON b.service_id = s.id
      WHERE b.status != 'rejected' AND b.status != 'deleted'
      ORDER BY b.booked_date ASC, b.booked_time ASC
    `);
    for (const b of bookings) {
      b.members = await db.all2(`
        SELECT pm.id, pm.char_name, pm.char_class, pm.char_level, pm.target_level, pm.contact_discord, u.username
        FROM party_members pm JOIN users u ON pm.user_id = u.id WHERE pm.booking_id = ?
      `, [b.id]);
      b.spots_taken = b.members.length;
      b.spots_left = b.party_size - b.spots_taken;
    }
    res.json(bookings);
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

  // ── CREATE BOOKING ───────────────────────────────────────────
  router.post('/api/bookings', requireAuth, async (req, res) => {
    const { service_id, char_name, char_class, char_level, target_level, contact_discord, note, booked_date, booked_time, coupon_code } = req.body;
    if (!service_id || !char_name || !char_class || !char_level || !target_level || !booked_date || !booked_time) {
      return res.json({ success: false, error: 'Wypelnij wszystkie wymagane pola.' });
    }
    const service = await db.get2('SELECT * FROM services WHERE id=? AND available=1', [service_id]);
    if (!service) return res.json({ success: false, error: 'Usluga niedostepna.' });

    const conflict = await db.get2(`
      SELECT pm.id FROM party_members pm JOIN bookings b ON pm.booking_id = b.id
      WHERE pm.user_id=? AND b.booked_date=? AND b.booked_time=? AND b.status NOT IN ('rejected','deleted')
    `, [req.session.userId, booked_date, booked_time]);
    if (conflict) return res.json({ success: false, error: 'Masz juz rezerwacje w tym terminie.' });

    // Handle coupon
    let discount = 0;
    if (coupon_code) {
      const coupon = await db.get2('SELECT * FROM coupons WHERE code=?', [coupon_code.toUpperCase()]);
      if (coupon && coupon.uses < coupon.max_uses) {
        discount = coupon.discount_percent;
        await db.run2('UPDATE coupons SET uses=uses+1 WHERE id=?', [coupon.id]);
      }
    }

    const token = crypto.randomBytes(12).toString('hex');
    const result = await db.run2(
      `INSERT INTO bookings (service_id, booked_date, booked_time, note, status_token) VALUES (?,?,?,?,?)`,
      [service_id, booked_date, booked_time, note || '', token]
    );
    await db.run2(
      `INSERT INTO party_members (booking_id, user_id, char_name, char_class, char_level, target_level, contact_discord) VALUES (?,?,?,?,?,?,?)`,
      [result.lastID, req.session.userId, char_name, char_class, char_level, target_level, contact_discord || '']
    );

    sendBookingNotification({
      type: 'new_booking', bookingId: result.lastID,
      serviceName: service.name, partySize: service.party_size,
      date: booked_date, time: booked_time,
      charName: char_name, charClass: char_class,
      charLevel: char_level, targetLevel: target_level,
      username: req.session.username, discord: contact_discord || '', note: note || ''
    }).catch(console.error);

    res.json({ success: true, statusToken: token, discount });
  });

  // ── JOIN PARTY ───────────────────────────────────────────────
  router.post('/api/bookings/:id/join', requireAuth, async (req, res) => {
    const { char_name, char_class, char_level, target_level, contact_discord } = req.body;
    if (!char_name || !char_class || !char_level || !target_level) {
      return res.json({ success: false, error: 'Wypelnij wszystkie wymagane pola.' });
    }
    const booking = await db.get2(`
      SELECT b.*, s.party_size, s.name as service_name FROM bookings b
      JOIN services s ON b.service_id = s.id
      WHERE b.id=? AND b.status NOT IN ('rejected','deleted')
    `, [req.params.id]);
    if (!booking) return res.json({ success: false, error: 'Rezerwacja nie istnieje.' });

    const members = await db.all2('SELECT * FROM party_members WHERE booking_id=?', [req.params.id]);
    if (members.length >= booking.party_size) return res.json({ success: false, error: 'Party jest juz pelne.' });
    if (members.find(m => m.user_id === req.session.userId)) return res.json({ success: false, error: 'Jestes juz zapisany.' });

    const conflict = await db.get2(`
      SELECT pm.id FROM party_members pm JOIN bookings b ON pm.booking_id = b.id
      WHERE pm.user_id=? AND b.booked_date=? AND b.booked_time=? AND b.status NOT IN ('rejected','deleted')
    `, [req.session.userId, booking.booked_date, booking.booked_time]);
    if (conflict) return res.json({ success: false, error: 'Masz juz rezerwacje w tym terminie.' });

    await db.run2(
      `INSERT INTO party_members (booking_id, user_id, char_name, char_class, char_level, target_level, contact_discord) VALUES (?,?,?,?,?,?,?)`,
      [req.params.id, req.session.userId, char_name, char_class, char_level, target_level, contact_discord || '']
    );

    sendBookingNotification({
      type: 'joined_party', bookingId: booking.id,
      serviceName: booking.service_name, partySize: booking.party_size,
      date: booking.booked_date, time: booking.booked_time,
      charName: char_name, charClass: char_class,
      charLevel: char_level, targetLevel: target_level,
      username: req.session.username, discord: contact_discord || ''
    }).catch(console.error);

    res.json({ success: true });
  });

  // ── CANCEL BOOKING (by user) ─────────────────────────────────
  router.post('/api/bookings/:id/cancel', requireAuth, async (req, res) => {
    const member = await db.get2(
      'SELECT * FROM party_members WHERE booking_id=? AND user_id=?',
      [req.params.id, req.session.userId]
    );
    if (!member) return res.json({ success: false, error: 'Nie jestes czlonkiem tego party.' });

    const allMembers = await db.all2('SELECT * FROM party_members WHERE booking_id=?', [req.params.id]);

    if (allMembers.length === 1) {
      // Last member — cancel whole booking
      await db.run2('UPDATE bookings SET status=? WHERE id=?', ['rejected', req.params.id]);
    } else {
      // Remove just this member
      await db.run2('DELETE FROM party_members WHERE id=?', [member.id]);
    }

    sendBookingNotification({
      type: 'cancelled', bookingId: req.params.id,
      serviceName: '', partySize: 1,
      date: '', time: '',
      charName: member.char_name, charClass: member.char_class,
      charLevel: member.char_level, targetLevel: member.target_level,
      username: req.session.username, discord: ''
    }).catch(console.error);

    res.json({ success: true });
  });

  // ── MY BOOKINGS ──────────────────────────────────────────────
  router.get('/api/my-bookings', requireAuth, async (req, res) => {
    const members = await db.all2(`
      SELECT pm.*, b.booked_date, b.booked_time, b.status, b.id as booking_id, b.note, b.status_token,
             s.name as service_name, s.price_sm, s.party_size
      FROM party_members pm
      JOIN bookings b ON pm.booking_id = b.id
      JOIN services s ON b.service_id = s.id
      WHERE pm.user_id=? AND b.status != 'deleted'
      ORDER BY b.booked_date DESC, b.booked_time DESC
    `, [req.session.userId]);
    for (const m of members) {
      m.party_members = await db.all2(`
        SELECT pm2.char_name, pm2.char_class, u.username
        FROM party_members pm2 JOIN users u ON pm2.user_id = u.id WHERE pm2.booking_id=?
      `, [m.booking_id]);
      const review = await db.get2('SELECT * FROM reviews WHERE booking_id=? AND user_id=?', [m.booking_id, req.session.userId]);
      m.reviewed = !!review;
    }
    res.json(members);
  });

  // ── STATUS PAGE (no login) ───────────────────────────────────
  router.get('/api/status/:token', async (req, res) => {
    const booking = await db.get2(`
      SELECT b.*, s.name as service_name, s.party_size, s.price_sm
      FROM bookings b JOIN services s ON b.service_id = s.id
      WHERE b.status_token=?
    `, [req.params.token]);
    if (!booking) return res.status(404).json({ error: 'Nie znaleziono rezerwacji.' });
    booking.members = await db.all2(`
      SELECT pm.char_name, pm.char_class, pm.char_level, pm.target_level, u.username
      FROM party_members pm JOIN users u ON pm.user_id = u.id WHERE pm.booking_id=?
    `, [booking.id]);
    res.json(booking);
  });

  // ── REVIEWS ──────────────────────────────────────────────────
  router.post('/api/reviews', requireAuth, async (req, res) => {
    const { booking_id, rating, comment } = req.body;
    if (!booking_id || !rating || rating < 1 || rating > 5) {
      return res.json({ success: false, error: 'Nieprawidlowe dane.' });
    }
    const booking = await db.get2(`
      SELECT b.* FROM bookings b
      JOIN party_members pm ON pm.booking_id = b.id
      WHERE b.id=? AND pm.user_id=? AND b.status='done'
    `, [booking_id, req.session.userId]);
    if (!booking) return res.json({ success: false, error: 'Nie mozesz ocenic tej rezerwacji.' });

    const existing = await db.get2('SELECT id FROM reviews WHERE booking_id=? AND user_id=?', [booking_id, req.session.userId]);
    if (existing) return res.json({ success: false, error: 'Juz oceniles te rezerwacje.' });

    await db.run2('INSERT INTO reviews (booking_id, user_id, rating, comment) VALUES (?,?,?,?)',
      [booking_id, req.session.userId, rating, comment || '']);
    res.json({ success: true });
  });

  router.get('/api/reviews', async (req, res) => {
    const reviews = await db.all2(`
      SELECT r.*, u.username, s.name as service_name
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      JOIN bookings b ON r.booking_id = b.id
      JOIN services s ON b.service_id = s.id
      ORDER BY r.created_at DESC
      LIMIT 20
    `);
    res.json(reviews);
  });

  // ── CHAT ─────────────────────────────────────────────────────
  router.get('/api/chat/:bookingId', requireAuth, async (req, res) => {
    const bookingId = req.params.bookingId;
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin) {
      const member = await db.get2(
        'SELECT id FROM party_members WHERE booking_id=? AND user_id=?',
        [bookingId, req.session.userId]
      );
      if (!member) return res.status(403).json({ error: 'Brak dostepu.' });
    }
    const messages = await db.all2(`
      SELECT cm.*, u.username FROM chat_messages cm
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.booking_id=? ORDER BY cm.created_at ASC
    `, [bookingId]);
    res.json(messages);
  });

  router.post('/api/chat/:bookingId', requireAuth, async (req, res) => {
    const bookingId = req.params.bookingId;
    const { message } = req.body;
    if (!message || !message.trim()) return res.json({ success: false });
    const isAdmin = req.session.role === 'admin';

    if (!isAdmin) {
      const member = await db.get2(
        'SELECT id FROM party_members WHERE booking_id=? AND user_id=?',
        [bookingId, req.session.userId]
      );
      if (!member) return res.status(403).json({ error: 'Brak dostepu.' });
    }

    const result = await db.run2(
      'INSERT INTO chat_messages (booking_id, user_id, is_admin, message) VALUES (?,?,?,?)',
      [bookingId, req.session.userId, isAdmin ? 1 : 0, message.trim()]
    );

    const msg = {
      id: result.lastID,
      booking_id: bookingId,
      user_id: req.session.userId,
      username: req.session.username,
      is_admin: isAdmin ? 1 : 0,
      message: message.trim(),
      created_at: new Date().toISOString()
    };

    app.broadcastChat(bookingId, { type: 'message', data: msg });
    res.json({ success: true, message: msg });
  });

  // ── ADMIN: ALL BOOKINGS ──────────────────────────────────────
  router.get('/api/admin/bookings', requireAdmin, async (req, res) => {
    const bookings = await db.all2(`
      SELECT b.*, s.name as service_name, s.party_size, s.price_sm
      FROM bookings b JOIN services s ON b.service_id = s.id
      WHERE b.status != 'deleted'
      ORDER BY b.booked_date DESC, b.booked_time DESC
    `);
    for (const b of bookings) {
      b.members = await db.all2(`
        SELECT pm.*, u.username FROM party_members pm
        JOIN users u ON pm.user_id = u.id WHERE pm.booking_id=?
      `, [b.id]);
    }
    res.json(bookings);
  });

  router.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
    await db.run2('UPDATE bookings SET status=? WHERE id=?', [req.body.status, req.params.id]);
    res.json({ success: true });
  });

  router.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
    await db.run2('UPDATE bookings SET status=? WHERE id=?', ['deleted', req.params.id]);
    res.json({ success: true });
  });

  // ── ADMIN: STATS ─────────────────────────────────────────────
  router.get('/api/admin/stats', requireAdmin, async (req, res) => {
    const totalBookings = await db.get2("SELECT COUNT(*) as c FROM bookings WHERE status != 'deleted'");
    const doneBookings = await db.get2("SELECT COUNT(*) as c FROM bookings WHERE status='done'");
    const pendingBookings = await db.get2("SELECT COUNT(*) as c FROM bookings WHERE status='pending'");
    const totalUsers = await db.get2("SELECT COUNT(*) as c FROM users WHERE role='user'");
    const avgRating = await db.get2("SELECT AVG(rating) as avg FROM reviews");
    const totalReviews = await db.get2("SELECT COUNT(*) as c FROM reviews");

    const byService = await db.all2(`
      SELECT s.name, s.price_sm, s.party_size, COUNT(b.id) as count
      FROM bookings b JOIN services s ON b.service_id = s.id
      WHERE b.status = 'done'
      GROUP BY s.id
    `);

    const byMonth = await db.all2(`
      SELECT strftime('%Y-%m', booked_date) as month, COUNT(*) as count
      FROM bookings WHERE status != 'deleted'
      GROUP BY month ORDER BY month DESC LIMIT 6
    `);

    res.json({
      totalBookings: totalBookings.c,
      doneBookings: doneBookings.c,
      pendingBookings: pendingBookings.c,
      totalUsers: totalUsers.c,
      avgRating: avgRating.avg ? Math.round(avgRating.avg * 10) / 10 : 0,
      totalReviews: totalReviews.c,
      byService,
      byMonth: byMonth.reverse()
    });
  });

  // ── ADMIN: COUPONS ───────────────────────────────────────────
  router.get('/api/admin/coupons', requireAdmin, async (req, res) => {
    const coupons = await db.all2('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json(coupons);
  });

  router.post('/api/admin/coupons', requireAdmin, async (req, res) => {
    const { code, discount_percent, max_uses, expires_at } = req.body;
    if (!code || !discount_percent) return res.json({ success: false, error: 'Podaj kod i rabat.' });
    const existing = await db.get2('SELECT id FROM coupons WHERE code=?', [code.toUpperCase()]);
    if (existing) return res.json({ success: false, error: 'Taki kod juz istnieje.' });
    await db.run2(
      'INSERT INTO coupons (code, discount_percent, max_uses, expires_at) VALUES (?,?,?,?)',
      [code.toUpperCase(), discount_percent, max_uses || 1, expires_at || null]
    );
    res.json({ success: true });
  });

  router.delete('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    await db.run2('DELETE FROM coupons WHERE id=?', [req.params.id]);
    res.json({ success: true });
  });

  // ── DISCORD INTERACTIONS ─────────────────────────────────────
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
