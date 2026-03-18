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
  await db.run2(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    package_type TEXT DEFAULT NULL,
    max_players INTEGER DEFAULT NULL,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES admins(id)
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER NOT NULL,
    char_name TEXT NOT NULL,
    char_class TEXT NOT NULL,
    char_level INTEGER NOT NULL,
    contact_discord TEXT NOT NULL,
    package_type TEXT NOT NULL,
    equipment_rental TEXT DEFAULT 'none',
    looking_for_party INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    status_token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(slot_id) REFERENCES slots(id)
  )`);

  await db.run2(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    reviewer_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const adminCount = await db.get2("SELECT COUNT(*) as c FROM admins");
  if (adminCount.c === 0) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('platforma', 10);
    await db.run2("INSERT INTO admins (username, password, display_name) VALUES (?,?,?)",
      ['admin', hash, 'Admin']);
  }
}

init().catch(console.error);
module.exports = db;
