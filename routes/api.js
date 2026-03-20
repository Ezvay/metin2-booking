const express = require('express');
const router = express.Router();
const db = require('../db/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const https = require('https');
const { requireAdmin } = require('../middleware/auth');
const { sendBookingNotification, handleInteraction } = require('../discord');

const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET;

// Auto-cancel expired bookings
async function cancelExpiredBookings() {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentTime = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

    // Get all past slots
    const expiredSlots = await db.all2(`
      SELECT id FROM slots
      WHERE status = 'open' AND (
        date < ? OR (date = ? AND time <= ?)
      )
    `, [today, today, currentTime]);

    for (const slot of expiredSlots) {
      await db.run2("UPDATE slots SET status='closed' WHERE id=?", [slot.id]);
      await db.run2(
        "UPDATE bookings SET status='cancelled' WHERE slot_id=? AND status='pending'",
        [slot.id]
      );
    }
  } catch(e) {
    console.error('cancelExpiredBookings error:', e);
  }
}

// Run on startup and every hour
cancelExpiredBookings();
setInterval(cancelExpiredBookings, 60 * 60 * 1000);

async function verifyHcaptcha(token) {
  if (!HCAPTCHA_SECRET) return true;
  return new Promise((resolve) => {
    const body = `secret=${HCAPTCHA_SECRET}&response=${token}`;
    const req = https.request({
      hostname: 'hcaptcha.com',
      path: '/siteverify',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw).success === true); } catch(e) { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

function discordRequest(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'discord.com',
      path: '/api/v10' + path,
      method: 'GET',
      headers: { 'Authorization': `Bot ${process.env.DISCORD_TOKEN}` }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve(null); } });
    });
    req.on('error', reject);
    req.end();
  });
}

const TEAM_MEMBERS = [
  { id: '269140484721475606', nick: 'ezvay',           display: 'Ezvay' },
  { id: '743808864981352559', nick: 'prezesjaroslaw_',  display: 'Judaszek' },
  { id: '513676603696611330', nick: 'jarekkaczka',      display: 'Yodasz' },
  { id: '449211767890116629', nick: 'bielluch',         display: 'Bieluch' },
  { id: '238942736043081729', nick: 'xmarco0',          display: 'Marco' },
];

const GUILD_ID = '1336843340662050857';

// ── ADMIN AUTH ────────────────────────────────────────────────
router.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = await db.get2('SELECT * FROM admins WHERE username=?', [username]);
  if (!admin) return res.json({ success: false, error: 'Nieprawidlowa nazwa lub haslo.' });
  const match = await bcrypt.compare(password, admin.password);
  if (!match) return res.json({ success: false, error: 'Nieprawidlowa nazwa lub haslo.' });
  req.session.adminId = admin.id;
  req.session.adminName = admin.display_name;
  res.json({ success: true });
});

router.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/api/admin/session', (req, res) => {
  if (req.session.adminId) {
    res.json({ loggedIn: true, name: req.session.adminName });
  } else {
    res.json({ loggedIn: false });
  }
});

// ── PUBLIC: SLOTS ─────────────────────────────────────────────
router.get('/api/slots', async (req, res) => {
  const slots = await db.all2(`
    SELECT s.*, a.display_name as admin_name, COUNT(b.id) as booked_count
    FROM slots s
    JOIN admins a ON s.admin_id = a.id
    LEFT JOIN bookings b ON b.slot_id = s.id AND b.status NOT IN ('rejected','cancelled')
    WHERE s.status = 'open' AND s.date >= date('now')
    GROUP BY s.id
    ORDER BY s.date ASC, s.time ASC
  `);
  for (const slot of slots) {
    slot.bookings = await db.all2(`
      SELECT char_name, char_class, char_level, package_type, looking_for_party, status
      FROM bookings WHERE slot_id=? AND status NOT IN ('rejected','cancelled')
    `, [slot.id]);
    slot.spots_left = slot.max_players ? slot.max_players - slot.booked_count : null;
    slot.is_open_party = slot.package_type && slot.spots_left > 0 && slot.bookings.some(b => b.looking_for_party);
  }
  res.json(slots);
});

// ── PUBLIC: BOOK A SLOT ───────────────────────────────────────
router.post('/api/slots/:id/book', async (req, res) => {
  const { char_name, char_class, char_level, contact_discord, package_type, equipment_rental, looking_for_party, hcaptcha_token } = req.body;
  if (!char_name || !char_class || !char_level || !contact_discord || !package_type) {
    return res.json({ success: false, error: 'Wypelnij wszystkie wymagane pola.' });
  }
  const captchaOk = await verifyHcaptcha(hcaptcha_token);
  if (!captchaOk) return res.json({ success: false, error: 'Weryfikacja captcha nie powiodla sie. Sprobuj ponownie.' });

  const slot = await db.get2(`
    SELECT s.*, COUNT(b.id) as booked_count
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id AND b.status NOT IN ('rejected','cancelled')
    WHERE s.id=? AND s.status='open' GROUP BY s.id
  `, [req.params.id]);

  if (!slot) return res.json({ success: false, error: 'Slot niedostepny.' });
  if (slot.package_type && slot.package_type !== package_type) {
    return res.json({ success: false, error: `Ten slot jest juz jako ${slot.package_type}. Wybierz ten sam typ.` });
  }
  if (slot.max_players && slot.booked_count >= slot.max_players) {
    return res.json({ success: false, error: 'Slot jest juz pelny.' });
  }

  const maxPlayers = { solo: 1, duo: 2, trio: 3 }[package_type] || 1;
  const isFirst = !slot.package_type;
  if (isFirst) {
    await db.run2('UPDATE slots SET package_type=?, max_players=? WHERE id=?', [package_type, maxPlayers, slot.id]);
  }
  if (package_type === 'solo' && slot.booked_count > 0) {
    return res.json({ success: false, error: 'Ten slot jest juz zajety (Solo).' });
  }

  const token = crypto.randomBytes(14).toString('hex');
  const result = await db.run2(`
    INSERT INTO bookings (slot_id, char_name, char_class, char_level, contact_discord, package_type, equipment_rental, looking_for_party, status_token)
    VALUES (?,?,?,?,?,?,?,?,?)
  `, [req.params.id, char_name, char_class, char_level, contact_discord, package_type, equipment_rental || 'none', looking_for_party ? 1 : 0, token]);

  sendBookingNotification({
    bookingId: result.lastID, slotId: slot.id,
    date: slot.date, time: slot.time,
    charName: char_name, charClass: char_class, charLevel: char_level,
    contactDiscord: contact_discord, packageType: package_type,
    equipmentRental: equipment_rental || 'none', lookingForParty: looking_for_party
  }).catch(console.error);

  res.json({ success: true, statusToken: token });
});

// ── PUBLIC: STATUS ────────────────────────────────────────────
router.get('/api/status/:token', async (req, res) => {
  const booking = await db.get2(`
    SELECT b.*, s.date, s.time FROM bookings b
    JOIN slots s ON b.slot_id = s.id WHERE b.status_token=?
  `, [req.params.token]);
  if (!booking) return res.status(404).json({ error: 'Nie znaleziono rezerwacji.' });
  booking.party = await db.all2(`
    SELECT char_name, char_class, char_level, package_type FROM bookings
    WHERE slot_id=? AND status NOT IN ('rejected','cancelled')
  `, [booking.slot_id]);
  res.json(booking);
});

// ── PUBLIC: REVIEWS ───────────────────────────────────────────
router.get('/api/reviews', async (req, res) => {
  const reviews = await db.all2(`
    SELECT r.*, b.package_type FROM reviews r
    JOIN bookings b ON r.booking_id = b.id
    ORDER BY r.created_at DESC LIMIT 12
  `);
  res.json(reviews);
});

router.post('/api/reviews', async (req, res) => {
  const { token, rating, comment, reviewer_name } = req.body;
  if (!token || !rating) return res.json({ success: false, error: 'Brak danych.' });
  const booking = await db.get2("SELECT * FROM bookings WHERE status_token=? AND status='done'", [token]);
  if (!booking) return res.json({ success: false, error: 'Nie mozna ocenic tej rezerwacji.' });
  const existing = await db.get2('SELECT id FROM reviews WHERE booking_id=?', [booking.id]);
  if (existing) return res.json({ success: false, error: 'Juz oceniono.' });
  await db.run2('INSERT INTO reviews (booking_id, rating, comment, reviewer_name) VALUES (?,?,?,?)',
    [booking.id, rating, comment || '', reviewer_name || booking.char_name]);
  res.json({ success: true });
});

// ── PUBLIC: TEAM STATUS ───────────────────────────────────────
router.get('/api/team/status', async (req, res) => {
  try {
    const TOKEN = process.env.DISCORD_TOKEN;
    if (!TOKEN) {
      return res.json(TEAM_MEMBERS.map(m => ({
        ...m, status: 'offline',
        avatar: `https://cdn.discordapp.com/embed/avatars/0.png`
      })));
    }

    // Fetch all members
    const members = await discordRequest(`/guilds/${GUILD_ID}/members?limit=100`);
    const memberMap = {};
    if (Array.isArray(members)) {
      members.forEach(m => { if (m.user) memberMap[m.user.id] = m; });
    }

    // Fetch presences via guild endpoint
    const presenceData = await discordRequest(`/guilds/${GUILD_ID}/presences`);
    const presenceMap = {};
    if (Array.isArray(presenceData)) {
      presenceData.forEach(p => { if (p.user) presenceMap[p.user.id] = p.status || 'offline'; });
    }

    const result = TEAM_MEMBERS.map(member => {
      const m = memberMap[member.id];
      const avatar = m?.user?.avatar
        ? `https://cdn.discordapp.com/avatars/${member.id}/${m.user.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(member.id) % 5}.png`;
      const status = presenceMap[member.id] || 'offline';
      return { ...member, avatar, status };
    });

    res.json(result);
  } catch(e) {
    console.error('Team status error:', e);
    res.json(TEAM_MEMBERS.map(m => ({
      ...m, status: 'offline',
      avatar: `https://cdn.discordapp.com/embed/avatars/0.png`
    })));
  }
});

// ── COUPON CHECK ──────────────────────────────────────────────
router.post('/api/coupons/check', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false });
  const coupon = await db.get2('SELECT * FROM coupons WHERE code=?', [code.toUpperCase()]);
  if (!coupon) return res.json({ valid: false, error: 'Nieprawidlowy kupon.' });
  if (coupon.uses >= coupon.max_uses) return res.json({ valid: false, error: 'Kupon wykorzystany.' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.json({ valid: false, error: 'Kupon wygasl.' });
  res.json({ valid: true, discount: coupon.discount_percent, code: coupon.code });
});

// ── ADMIN: SLOTS ──────────────────────────────────────────────
router.post('/api/admin/slots/generate', requireAdmin, async (req, res) => {
  const { date, time_from, time_to, note } = req.body;
  if (!date || !time_from || !time_to) return res.json({ success: false, error: 'Podaj date i godziny.' });
  const [fh, fm] = time_from.split(':').map(Number);
  const [th, tm] = time_to.split(':').map(Number);
  const fromTotal = fh * 60 + fm;
  const toTotal = th * 60 + tm;
  if (fromTotal >= toTotal) return res.json({ success: false, error: 'Godzina konca musi byc pozniejsza.' });
  const slots = [];
  for (let t = fromTotal; t < toTotal; t += 60) {
    slots.push(String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0'));
  }
  let created = 0;
  for (const time of slots) {
    const existing = await db.get2('SELECT id FROM slots WHERE date=? AND time=? AND admin_id=? AND status != ?', [date, time, req.session.adminId, 'deleted']);
    if (!existing) {
      await db.run2('INSERT INTO slots (admin_id, date, time, note) VALUES (?,?,?,?)', [req.session.adminId, date, time, note || '']);
      created++;
    }
  }
  res.json({ success: true, created, total: slots.length });
});

router.get('/api/admin/slots', requireAdmin, async (req, res) => {
  const slots = await db.all2(`
    SELECT s.*, a.display_name as admin_name, COUNT(b.id) as booked_count
    FROM slots s JOIN admins a ON s.admin_id = a.id
    LEFT JOIN bookings b ON b.slot_id = s.id AND b.status NOT IN ('rejected','cancelled')
    WHERE s.status != 'deleted'
    GROUP BY s.id ORDER BY s.date ASC, s.time ASC
  `);
  for (const slot of slots) {
    slot.bookings = await db.all2(`
      SELECT * FROM bookings WHERE slot_id=? AND status NOT IN ('rejected','cancelled')
    `, [slot.id]);
    slot.spots_left = slot.max_players ? slot.max_players - slot.booked_count : null;
  }
  res.json(slots);
});

router.delete('/api/admin/slots/:id', requireAdmin, async (req, res) => {
  await db.run2("UPDATE slots SET status='deleted' WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

// ── ADMIN: BOOKINGS ───────────────────────────────────────────
router.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const bookings = await db.all2(`
    SELECT b.*, s.date, s.time FROM bookings b
    JOIN slots s ON b.slot_id = s.id
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
  await db.run2("UPDATE bookings SET status='cancelled' WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

// ── ADMIN: STATS ──────────────────────────────────────────────
router.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const totalSlots = await db.get2("SELECT COUNT(*) as c FROM slots WHERE status != 'deleted'");
  const totalBookings = await db.get2("SELECT COUNT(*) as c FROM bookings WHERE status != 'cancelled'");
  const doneBookings = await db.get2("SELECT COUNT(*) as c FROM bookings WHERE status='done'");
  const avgRating = await db.get2("SELECT AVG(rating) as avg, COUNT(*) as c FROM reviews");
  const byPackage = await db.all2(`SELECT package_type, COUNT(*) as count FROM bookings WHERE status='done' GROUP BY package_type`);
  const byMonth = await db.all2(`
    SELECT strftime('%Y-%m', s.date) as month, COUNT(b.id) as count
    FROM bookings b JOIN slots s ON b.slot_id = s.id
    WHERE b.status != 'cancelled' GROUP BY month ORDER BY month DESC LIMIT 6
  `);
  const eqStats = await db.all2(`
    SELECT equipment_rental, COUNT(*) as count FROM bookings
    WHERE status != 'cancelled' AND equipment_rental != 'none' GROUP BY equipment_rental
  `);
  res.json({
    totalSlots: totalSlots.c, totalBookings: totalBookings.c, doneBookings: doneBookings.c,
    avgRating: avgRating.avg ? Math.round(avgRating.avg * 10) / 10 : 0,
    totalReviews: avgRating.c, byPackage, byMonth: byMonth.reverse(), eqStats
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
  } catch(err) {
    console.error('Interaction error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
