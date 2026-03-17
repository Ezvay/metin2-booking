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
    cancelled: '❌ Rezerwacja anulowana'
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
      { name: '📅 Termin', value:
