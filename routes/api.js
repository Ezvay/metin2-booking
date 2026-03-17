const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendBookingNotification, handleInteraction } = require('../discord');

router.get('/api/session', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, username: req.session.username, role: req.session.role, userId: req.session.userId });
  } else {
    res.json({ loggedIn: false });
  }
});

router.get('/api/services', async (req, res) => {
  const services = await db.all2('SELECT * FROM services WHERE available=1');
  res.json(services);
});

router.get('/api/calendar', async (req, res) => {
  const bookings = await db.all2(`
    SELECT b.id, b.booked_date, b.booked_time, b.status, b.note,
           s.name as service_name, s.party_size, s.price_sm, s.id as service_id
    FROM bookings b
    JOIN services s ON b.service_id = s.id
    WHERE b.status != 'rejected'
    ORDER BY b.booked_date ASC, b.booked_time ASC
  `);
  for (const booking of bookings) {
    booking.members = await db.all2(`
      SELECT pm.id, pm.char_name, pm.char_class, pm.char_level, pm.target_level, pm.contact_discord, u.username
      FROM party_members pm JOIN users u ON pm.user_id = u.id
      WHERE pm.booking_id = ?
    `, [booking.id]);
    booking.spots_taken = booking.members.length;
    booking.spots_left = booking.party_size - booking.spots_taken;
  }
  res.json(bookings);
});

router.post('/api/bookings', requireAuth, async (req, res) => {
  const { service_id, char_name, char_class, char_level, target_level, contact_discord, note, booked_date, booked_time } = req.body;
  if (!service_id || !char_name || !char_class || !char_level || !target_level || !booked_date || !booked_time) {
    return res.json({ success: false, error: 'Wypełnij wszystkie wymagane pola.' });
  }
  const service = await db.get2('SELECT * FROM services WHERE id=? AND available=1', [service_id]);
  if (!service) return res.json({ success: false, error: 'Usługa niedostępna.' });

  const conflict = await db.get2(`
    SELECT pm.id FROM party_members pm
    JOIN bookings b ON pm.booking_id = b.id
    WHERE pm.user_id = ? AND b.booked_date = ? AND b.booked_time = ? AND b.status != 'rejected'
  `, [req.session.userId, booked_date, booked_time]);
  if (conflict) return res.json({ success: false, error: 'Masz już rezerwację w tym terminie.' });

  const result = await db.run2(
    `INSERT INTO bookings (service_id, booked_date, booked_time, note) VALUES (?,?,?,?)`,
    [service_id, booked_date, booked_time, note || '']
  );
  await db.run2(
    `INSERT INTO party_members (booking_id, user_id, char_name, char_class, char_level, target_level, contact_discord) VALUES (?,?,?,?,?,?,?)`,
    [result.lastID, req.session.userId, char_name, char_class, char_level, target_level, contact_discord || '']
  );

  sendBookingNotification({
    type: 'new_booking',
    bookingId: result.lastID,
    serviceName: service.name,
    partySize: service.party_size,
    date: booked_date,
    time: booked_time,
    charName: char_name,
    charClass: char_class,
    charLevel: char_level,
    targetLevel: target_level,
    username: req.session.username,
    discord: contact_discord || '',
    note: note || ''
  }).catch(console.error);

  res.json({ success: true });
});

router.post('/api/bookings/:id/join', requireAuth, async (req, res) => {
  const { char_name, char_class, char_level, target_level, contact_discord } = req.body;
  if (!char_name || !char_class || !char_level || !target_level) {
    return res.json({ success: false, error: 'Wypełnij wszystkie wymagane pola.' });
  }
  const booking = await db.get2(`
    SELECT b.*, s.party_size, s.name as service_name FROM bookings b
    JOIN services s ON b.service_id = s.id
    WHERE b.id = ? AND b.status != 'rejected'
  `, [req.params.id]);
  if (!booking) return res.json({ success: false, error: 'Rezerwacja nie istnieje.' });

  const members = await db.all2('SELECT * FROM party_members WHERE booking_id=?', [req.params.id]);
  if (members.length >= booking.party_size) return res.json({ success: false, error: 'Party jest już pełne.' });

  const alreadyIn = members.find(m => m.user_id === req.session.userId);
  if (alreadyIn) return res.json({ success: false, error: 'Jesteś już zapisany do tego party.' });

  const conflict = await db.get2(`
    SELECT pm.id FROM party_members pm
    JOIN bookings b ON pm.booking_id = b.id
    WHERE pm.user_id = ? AND b.booked_date = ? AND b.booked_time = ? AND b.status != 'rejected'
  `, [req.session.userId, booking.booked_date, booking.booked_time]);
  if (conflict) return res.json({ success: false, error: 'Masz już rezerwację w tym terminie.' });

  await db.run2(
    `INSERT INTO party_members (booking_id, user_id, char_name, char_class, char_level, target_level, contact_discord) VALUES (?,?,?,?,?,?,?)`,
    [req.params.id, req.session.userId, char_name, char_class, char_level, target_level, contact_discord || '']
  );

  sendBookingNotification({
    type: 'joined_party',
    bookingId: booking.id,
    serviceName: booking.service_name,
    partySize: booking.party_size,
    date: booking.booked_date,
    time: booking.booked_time,
    charName: char_name,
    charClass: char_class,
    charLevel: char_level,
    targetLevel: target_level,
    username: req.session.username,
    discord: contact_discord || ''
  }).catch(console.error);

  res.json({ success: true });
});

router.get('/api/my-bookings', requireAuth, async (req, res) => {
  const members = await db.all2(`
    SELECT pm.*, b.booked_date, b.booked_time, b.status, b.id as booking_id, b.note,
           s.name as service_name, s.price_sm, s.party_size
    FROM party_members pm
    JOIN bookings b ON pm.booking_id = b.id
    JOIN services s ON b.service_id = s.id
    WHERE pm.user_id = ?
    ORDER BY b.booked_date DESC, b.booked_time DESC
  `, [req.session.userId]);
  for (const m of members) {
    m.party_members = await db.all2(`
      SELECT pm2.char_name, pm2.char_class, u.username
      FROM party_members pm2 JOIN users u ON pm2.user_id = u.id
      WHERE pm2.booking_id = ?
    `, [m.booking_id]);
  }
  res.json(members);
});

router.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const bookings = await db.all2(`
    SELECT b.*, s.name as service_name, s.party_size, s.price_sm
    FROM bookings b JOIN services s ON b.service_id = s.id
    ORDER BY b.booked_date DESC, b.booked_time DESC
  `);
  for (const b of bookings) {
    b.members = await db.all2(`
      SELECT pm.*, u.username FROM party_members pm
      JOIN users u ON pm.user_id = u.id WHERE pm.booking_id = ?
    `, [b.id]);
  }
  res.json(bookings);
});

router.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  await db.run2('UPDATE bookings SET status=? WHERE id=?', [req.body.status, req.params.id]);
  res.json({ success: true });
});

router.post('/api/discord/interactions', async (req, res) => {
  try {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const publicKey = process.env.DISCORD_PUBLIC_KEY;

    if (publicKey && signature && timestamp) {
      const nacl = require('tweetnacl');
      const bodyStr = JSON.stringify(req.body);
      const isValid = nacl.sign.detached.verify(
        Buffer.from(timestamp + bodyStr),
        Buffer.from(signature, 'hex'),
        Buffer.from(publicKey, 'hex')
      );
      if (!isValid) return res.status(401).json({ error: 'Invalid signature' });
    }

    const interaction = req.body;
    if (interaction.type === 1) return res.json({ type: 1 });

    const response = await handleInteraction(interaction, db);
    res.json(response);
  } catch (err) {
    console.error('Interaction error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
