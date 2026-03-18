const https = require('https');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'discord.com',
      path: '/api/v10' + path,
      method,
      headers: Object.assign(
        { 'Authorization': 'Bot ' + TOKEN, 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}
      )
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const PKG_NAMES = { solo: 'Solo', duo: 'Duo', trio: 'Trio' };
const PKG_ICONS = { solo: '🗡️', duo: '⚔️', trio: '🔱' };
const PRICES = { solo: 5000, duo: 2000, trio: 1500 };
const EQ_NAMES = { none: 'Brak', full: 'Pełny set (+60% szansy DOŚ)', partial: 'Naszyjnik + buty (+40% szansy DOŚ)' };
const EQ_PRICES = { none: 0, full: 500, partial: 300 };
const EQ_DEPOSIT = { none: 0, full: 30000, partial: 10000 };

async function sendBookingNotification(opts) {
  if (!TOKEN || !CHANNEL_ID) return;

  const pkg = opts.packageType;
  const eq = opts.equipmentRental;
  const eqInfo = eq !== 'none' ? `${EQ_NAMES[eq]} (+${EQ_PRICES[eq]} SM/h, zastaw ${EQ_DEPOSIT[eq].toLocaleString()} SM)` : 'Brak';

  const fields = [
    { name: 'Slot', value: `📅 ${opts.date} o ${opts.time} (±15 min)`, inline: true },
    { name: 'Pakiet', value: `${PKG_ICONS[pkg]||'⚔️'} ${PKG_NAMES[pkg]||pkg} · ${PRICES[pkg]||0} SM/h`, inline: true },
    { name: 'Gracz', value: opts.charName + ' (' + opts.charClass + ' poz.' + opts.charLevel + ')', inline: true },
    { name: 'Discord gracza', value: '`' + opts.contactDiscord + '`', inline: true },
    { name: 'Wynajem eqp', value: eqInfo, inline: true },
    { name: 'Szuka party', value: opts.lookingForParty ? '✅ Tak' : '❌ Nie', inline: true }
  ];

  const confirmText = `Napisz do gracza:\n> Hej **${opts.charName}**! Twoja rezerwacja expienia ${PKG_NAMES[pkg]||pkg} na **${opts.date} o ${opts.time}** (±15 min) została potwierdzona! ${eq !== 'none' ? 'Pamiętaj o zastawie **' + EQ_DEPOSIT[eq].toLocaleString() + ' SM** za wypożyczenie eqp. ' : ''}Do zobaczenia w grze ⚔️`;

  await apiRequest('POST', '/channels/' + CHANNEL_ID + '/messages', {
    embeds: [{
      title: '🆕 NOWA REZERWACJA',
      color: 0xf5c800,
      fields,
      footer: { text: 'Rezerwacja #' + opts.bookingId + ' | Slot #' + opts.slotId },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: '✅ Przyjmij', custom_id: 'accept_' + opts.bookingId },
        { type: 2, style: 4, label: '❌ Odrzuć', custom_id: 'reject_' + opts.bookingId }
      ]
    }]
  });
}

async function handleInteraction(interaction, db) {
  const custom_id = interaction.data && interaction.data.custom_id;
  if (!custom_id) return { type: 1 };

  const isAccept = custom_id.startsWith('accept_');
  const isReject = custom_id.startsWith('reject_');
  if (!isAccept && !isReject) return { type: 1 };

  const bookingId = custom_id.replace('accept_', '').replace('reject_', '');
  const newStatus = isAccept ? 'active' : 'rejected';
  const color = isAccept ? 0x40d090 : 0xff4444;
  const label = isAccept ? '✅ Przyjęto przez' : '❌ Odrzucono przez';

  const clicker = (interaction.member && interaction.member.nick) ||
                  (interaction.member && interaction.member.user && interaction.member.user.username) ||
                  (interaction.user && interaction.user.username) || 'Nieznany';

  await db.run2('UPDATE bookings SET status=? WHERE id=?', [newStatus, bookingId]);

  const booking = await db.get2(`
    SELECT b.*, s.date, s.time FROM bookings b
    JOIN slots s ON b.slot_id = s.id WHERE b.id=?
  `, [bookingId]);

  const eq = booking ? booking.equipment_rental : 'none';
  const pkg = booking ? booking.package_type : 'solo';

  const confirmMsg = isAccept && booking
    ? `\n\n📋 **Skopiuj i wyślij do gracza \`${booking.contact_discord}\`:**\n> Hej ${booking.char_name}! Twoja rezerwacja expienia ${PKG_NAMES[pkg]} na **${booking.date} o ${booking.time}** (±15 min) została potwierdzona! ${eq !== 'none' ? 'Pamiętaj o zastawie **' + EQ_DEPOSIT[eq].toLocaleString() + ' SM** za wypożyczenie eqp. ' : ''}Do zobaczenia w grze ⚔️`
    : '';

  const originalEmbed = interaction.message && interaction.message.embeds && interaction.message.embeds[0];
  const originalFields = (originalEmbed && originalEmbed.fields) || [];

  return {
    type: 7,
    data: {
      embeds: [{
        title: originalEmbed && originalEmbed.title,
        color,
        fields: originalFields.concat([{ name: label, value: clicker, inline: true }]),
        description: confirmMsg,
        footer: originalEmbed && originalEmbed.footer,
        timestamp: originalEmbed && originalEmbed.timestamp
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 3, label: '✅ Przyjmij', custom_id: 'accept_' + bookingId, disabled: true },
          { type: 2, style: 4, label: '❌ Odrzuć', custom_id: 'reject_' + bookingId, disabled: true }
        ]
      }]
    }
  };
}

module.exports = { sendBookingNotification, handleInteraction, PKG_NAMES, PKG_ICONS, PRICES, EQ_NAMES, EQ_PRICES, EQ_DEPOSIT };
