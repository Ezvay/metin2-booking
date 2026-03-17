const https = require('https');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'discord.com',
      path: `/api/v10${path}`,
      method,
      headers: {
        'Authorization': `Bot ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function sendBookingNotification({ type, bookingId, serviceName, partySize, date, time, charName, charClass, charLevel, targetLevel, username, discord, note }) {
  if (!TOKEN || !CHANNEL_ID) return;

  const partyIcons = { 1: '🗡️', 2: '⚔️', 3: '🔱' };
  const partyNames = { 1: 'Solo', 2: 'Duo', 3: 'Trio' };
  const typeLabels = {
    new_booking: '🆕 Nowa rezerwacja!',
    joined_party: '➕ Ktoś dołączył do party!',
    cancelled: '❌ Rezerwacja odrzucona'
  };

  const colors = {
    new_booking: 0xf5c800,
    joined_party: 0x40d090,
    cancelled: 0xff4444
  };

  const embed = {
    title: typeLabels[type] || '📋 Powiadomienie',
    color: colors[type] || 0xf5c800,
    fields: [
      { name: '📦 Pakiet', value: `${partyIcons[partySize] || '⚔️'} ${serviceName} (${partyNames[partySize] || ''})`, inline: true },
      { name: '📅 Termin', value: `${date} o ${time}`, inline: true },
      { name: '👤 Gracz', value: username, inline: true },
      { name: '⚔️ Postać', value: `${charName} (${charClass})`, inline: true },
      { name: '📈 Poziomy', value: `${charLevel} → ${targetLevel}`, inline: true },
      ...(discord ? [{ name: '💬 Discord', value: discord, inline: true }] : []),
      ...(note ? [{ name: '📝 Uwagi', value: note }] : []),
    ],
    footer: { text: `ID rezerwacji: #${bookingId}` },
    timestamp: new Date().toISOString()
  };

  // Buttons: Przyjmij / Odrzuć (only for new bookings and joins)
  const components = (type === 'new_booking' || type === 'joined_party') ? [{
    type: 1,
    components: [
      {
        type: 2,
        style: 3, // green
        label: '✅ Przyjmij',
        custom_id: `accept_${bookingId}`
      },
      {
        type: 2,
        style: 4, // red
        label: '❌ Odrzuć',
        custom_id: `reject_${bookingId}`
      }
    ]
  }] : [];

  await apiRequest('POST', `/channels/${CHANNEL_ID}/messages`, {
    embeds: [embed],
    components
  });
}

async function handleInteraction(interaction, db) {
  const { custom_id, member } = interaction;
  const clicker = member?.user?.username || member?.nick || 'Nieznany';

  if (custom_id?.startsWith('accept_') || custom_id?.startsWith('reject_')) {
    const bookingId = custom_id.split('_')[1];
    const newStatus = custom_id.startsWith('accept_') ? 'active' : 'rejected';
    const label = newStatus === 'active' ? '✅ Przyjęto' : '❌ Odrzucono';
    const color = newStatus === 'active' ? 0x40d090 : 0xff4444;

    await db.run2('UPDATE bookings SET status=? WHERE id=?', [newStatus, bookingId]);

    // Update the Discord message — disable buttons, show who clicked
    return {
      type: 7, // update message
      data: {
        embeds: [{
          ...interaction.message.embeds[0],
          color,
          fields: [
            ...(interaction.message.embeds[0].fields || []),
            { name: `${label} przez`, value: `**${clicker}**`, inline: true }
          ]
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: '✅ Przyjmij', custom_id: `accept_${bookingId}`, disabled: true },
            { type: 2, style: 4, label: '❌ Odrzuć', custom_id: `reject_${bookingId}`, disabled: true }
          ]
        }]
      }
    };
  }

  return { type: 1 }; // pong
}

module.exports = { sendBookingNotification, handleInteraction };
