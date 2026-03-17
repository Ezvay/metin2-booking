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
  const partyNames = { 1: 'Solo', 2: 'Duo', 3: 'Trio' };
  const typeLabels = {
    new_booking: 'NOWA REZERWACJA',
    joined_party: 'DOLACZYL DO PARTY',
    cancelled: 'ANULOWANO REZERWACJE',
    status_change: 'ZMIANA STATUSU'
  };
  const colors = { new_booking: 0xf5c800, joined_party: 0x40d090, cancelled: 0xff4444, status_change: 0x4080ff };

  const fields = [
    { name: 'Pakiet', value: opts.serviceName + ' (' + (partyNames[opts.partySize] || '') + ')', inline: true },
    { name: 'Termin', value: opts.date + ' o ' + opts.time, inline: true },
    { name: 'Gracz', value: opts.username, inline: true },
    { name: 'Postac', value: opts.charName + ' (' + opts.charClass + ')', inline: true },
    { name: 'Poziomy', value: opts.charLevel + ' -> ' + opts.targetLevel, inline: true }
  ];
  if (opts.discord) fields.push({ name: 'Discord', value: opts.discord, inline: true });
  if (opts.note) fields.push({ name: 'Uwagi', value: opts.note });
  if (opts.statusLabel) fields.push({ name: 'Nowy status', value: opts.statusLabel, inline: true });

  const showButtons = opts.type === 'new_booking' || opts.type === 'joined_party';
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
      footer: { text: 'ID rezerwacji: #' + opts.bookingId },
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
  const label = isAccept ? 'Przyjeto przez' : 'Odrzucono przez';
  const color = isAccept ? 0x40d090 : 0xff4444;

  const clicker = (interaction.member && interaction.member.nick) ||
                  (interaction.member && interaction.member.user && interaction.member.user.username) ||
                  (interaction.user && interaction.user.username) ||
                  'Nieznany';

  await db.run2('UPDATE bookings SET status=? WHERE id=?', [newStatus, bookingId]);

  const originalEmbed = interaction.message && interaction.message.embeds && interaction.message.embeds[0];
  const originalFields = (originalEmbed && originalEmbed.fields) || [];

  return {
    type: 7,
    data: {
      embeds: [{
        title: (originalEmbed && originalEmbed.title) || 'Rezerwacja',
        color: color,
        fields: originalFields.concat([{ name: label, value: clicker, inline: true }]),
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

module.exports = { sendBookingNotification: sendBookingNotification, handleInteraction: handleInteraction };
