const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'metin2.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.run2 = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
db.get2 = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
db.all2 = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));

async function init() {
  await db.run2(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    party_size INTEGER NOT NULL,
    level_from INTEGER NOT NULL,
    level_to INTEGER NOT NULL,
    price_sm INTEGER NOT NULL,
    available INTEGER DEFAULT 1
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL,
    booked_date TEXT NOT NULL,
    booked_time TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    note TEXT,
    status_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(service_id) REFERENCES services(id)
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS party_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    char_name TEXT NOT NULL,
    char_class TEXT NOT NULL,
    char_level INTEGER NOT NULL,
    target_level INTEGER NOT NULL,
    contact_discord TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(booking_id) REFERENCES bookings(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(booking_id) REFERENCES bookings(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    discount_percent INTEGER NOT NULL,
    max_uses INTEGER DEFAULT 1,
    uses INTEGER DEFAULT 0,
    expires_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    user_id INTEGER,
    is_admin INTEGER DEFAULT 0,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(booking_id) REFERENCES bookings(id)
  )`);

  const count = await db.get2('SELECT COUNT(*) as c FROM services');
  if (count.c === 0) {
    await db.run2(`INSERT INTO services (name, description, party_size, level_from, level_to, price_sm) VALUES (?,?,?,?,?,?)`,
      ['Expienie Solo', 'Expienie sam na sam. Maksymalnie 1 osoba. 5000 SM/h.', 1, 45, 75, 5000]);
    await db.run2(`INSERT INTO services (name, description, party_size, level_from, level_to, price_sm) VALUES (?,?,?,?,?,?)`,
      ['Expienie Duo', 'Expienie w parze. Maksymalnie 2 osoby. 2000 SM/h od osoby.', 2, 45, 75, 2000]);
    await db.run2(`INSERT INTO services (name, description, party_size, level_from, level_to, price_sm) VALUES (?,?,?,?,?,?)`,
      ['Expienie Trio', 'Expienie w trójce. Maksymalnie 3 osoby. 1500 SM/h od osoby.', 3, 45, 75, 1500]);
  }

  const adminCount = await db.get2("SELECT COUNT(*) as c FROM users WHERE role='admin'");
  if (adminCount.c === 0) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin1234', 10);
    await db.run2("INSERT INTO users (username, email, password, role) VALUES (?,?,?,?)",
      ['admin', 'admin@expowisko.pl', hash, 'admin']);
  }
}

init().catch(console.error);
module.exports = db;
