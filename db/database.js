const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'metin2.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    level_from INTEGER NOT NULL,
    level_to INTEGER NOT NULL,
    price_gold INTEGER NOT NULL,
    duration_hours INTEGER NOT NULL,
    available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    char_name TEXT NOT NULL,
    char_class TEXT NOT NULL,
    char_level INTEGER NOT NULL,
    target_level INTEGER NOT NULL,
    contact_discord TEXT,
    status TEXT DEFAULT 'pending',
    note TEXT,
    booked_date TEXT NOT NULL,
    booked_time TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(service_id) REFERENCES services(id)
  );
`);

const count = db.prepare('SELECT COUNT(*) as c FROM services').get();
if (count.c === 0) {
  const insert = db.prepare(`
    INSERT INTO services (name, description, level_from, level_to, price_gold, duration_hours)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  [
    ['Expienie 1–60', 'Szybki leveling dla nowych graczy od poziomu 1 do 60.', 1, 60, 500, 3],
    ['Expienie 61–80', 'Leveling przez średnie mapy. Potrzebna ekwipunek +6.', 61, 80, 1200, 5],
    ['Expienie 81–99', 'Grind przez Górę Wiecznego Śniegu i okolice.', 81, 99, 2500, 8],
    ['Expienie 99–105', 'Endgame leveling, wymaga dobrego eqp.', 99, 105, 5000, 12],
  ].forEach(s => insert.run(...s));
}

const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get();
if (adminCount.c === 0) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin1234', 10);
  db.prepare("INSERT INTO users (username, email, password, role) VALUES (?,?,?,?)").run(
    'admin', 'admin@projekhard.pl', hash, 'admin'
  );
}

module.exports = db;
