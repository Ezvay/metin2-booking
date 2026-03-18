const https = require('https');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'discord.com',
      path: '/api/v10' + path,
      method: method,
      headers: Object.assign(
        { 'Authorization': 'Bot ' + TOKEN, 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}
      )
    }, function(res) {
      let raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function sendBookingNotification(opts) {
  if (!TOKEN || !CHANNEL_ID) return;

  const typeLabels = {
    new_booking: 'NOWA REZERWACJA',
    cancelled: 'ANULOWANO REZERWACJE',
    joined: 'DOLACZYL DO SLOTU'
  };
  const colors = {
    new_booking: 0xf5c800,
    cancelled: 0xff4444,
    joined: 0x40d090
  };

  const fields = [
    { name: 'Pakiet', value: opts.packageName, inline: true },
    { name: 'Termin', value: opts.date + ' o ' + opts.time, inline: true },
    { name: 'Miejsc', value: opts.spotsLeft + '/' + opts.maxPlayers + ' wolnych', inline: true },
    { name: 'Gracz (konto)', value: opts.username, inline: true },
    { name: 'Postac', value: opts.charName + ' (' + opts.charClass + ' poz.' + opts.charLevel + ')', inline: true },
    { name: 'Discord gracza', value: opts.discord || 'brak', inline: true }
  ];
  if (opts.note) fields.push({ name: 'Uwagi slotu', value: opts.note });

  const showButtons = opts.type === 'new_booking' || opts.type === 'joined';
  const components = showButtons ? [{
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Przyjmij', custom_id: 'accept_' + opts.bookingId },
      { type: 2, style: 4, label: 'Odrzuc', custom_id: 'reject_' + opts.bookingId }
    ]
  }] : [];

  await apiRequest('POST', '/channels/' + CHANNEL_ID + '/messages', {
    embeds: [{
      title: typeLabels[opts.type] || 'POWIADOMIENIE',
      color: colors[opts.type] || 0xf5c800,
      fields: fields,
      footer: { text: 'Rezerwacja #' + opts.bookingId + ' | Slot #' + opts.slotId },
      timestamp: new Date().toISOString()
    }],
    components: components
  });
}

async function handleInteraction(interaction, db) {
  const custom_id = interaction.data && interaction.data.custom_id;
  if (!custom_id) return { type: 1 };

  const isAccept = custom_id.indexOf('accept_') === 0;
  const isReject = custom_id.indexOf('reject_') === 0;
  if (!isAccept && !isReject) return { type: 1 };

  const bookingId = custom_id.replace('accept_', '').replace('reject_', '');
  const newStatus = isAccept ? 'active' : 'rejected';
  const color = isAccept ? 0x40d090 : 0xff4444;
  const label = isAccept ? 'Przyjeto przez' : 'Odrzucono przez';

  const clicker = (interaction.member && interaction.member.nick) ||
                  (interaction.member && interaction.member.user && interaction.member.user.username) ||
                  (interaction.user && interaction.user.username) || 'Nieznany';

  await db.run2('UPDATE bookings SET status=? WHERE id=?', [newStatus, bookingId]);

  // Get booking info for the confirmation message
  const booking = await db.get2(`
    SELECT b.*, s.date, s.time, s.package_name FROM bookings b
    JOIN slots s ON b.slot_id = s.id WHERE b.id=?
  `, [bookingId]);

  const confirmMsg = isAccept && booking
    ? '\n\n**Napisz do gracza na Discordzie:**\n`' + (booking.contact_discord || 'brak nicka') + '`\n\n📋 Treść:\n> Hej! Twoja rezerwacja **' + booking.package_name + '** na **' + booking.date + ' o ' + booking.time + '** została potwierdzona! Do zobaczenia w grze ⚔️'
    : '';

  const originalEmbed = interaction.message && interaction.message.embeds && interaction.message.embeds[0];
  const originalFields = (originalEmbed && originalEmbed.fields) || [];

  return {
    type: 7,
    data: {
      embeds: [{
        title: (originalEmbed && originalEmbed.title) || 'Rezerwacja',
        color: color,
        fields: originalFields.concat([{ name: label, value: clicker, inline: true }]),
        description: confirmMsg,
        footer: originalEmbed && originalEmbed.footer,
        timestamp: originalEmbed && originalEmbed.timestamp
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Przyjmij', custom_id: 'accept_' + bookingId, disabled: true },
          { type: 2, style: 4, label: 'Odrzuc', custom_id: 'reject_' + bookingId, disabled: true }
        ]
      }]
    }
  };
}

module.exports = { sendBookingNotification, handleInteraction };
