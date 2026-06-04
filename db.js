const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');


const DB_PATH = path.join(__dirname, 'siap.db');

let db = null;

function getDb() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
    } else {
      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    }
  });
}

async function initDb() {
  const database = await getDb();
  
  return new Promise((resolve, reject) => {
    database.serialize(() => {
      // Tabela de usuários
      database.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Tabela de subscriptions
      database.run(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER NOT NULL,
          planType TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          startDate DATETIME DEFAULT CURRENT_TIMESTAMP,
          expiryDate DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Tabela de licenses
      database.run(`
        CREATE TABLE IF NOT EXISTS licenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER NOT NULL,
          subscriptionId INTEGER NOT NULL,
          licenseKey TEXT UNIQUE NOT NULL,
          isActive INTEGER DEFAULT 1,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (subscriptionId) REFERENCES subscriptions(id) ON DELETE CASCADE
        )
      `);

      // Tabela de payments
      database.run(`
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER,
          email TEXT NOT NULL,
          amount TEXT NOT NULL,
          planType TEXT NOT NULL,
          mercadoPagoId TEXT,
          status TEXT DEFAULT 'pending',
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Tabela de tokens
      database.run(`
        CREATE TABLE IF NOT EXISTS tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER NOT NULL,
          token TEXT UNIQUE NOT NULL,
          name TEXT,
          isActive INTEGER DEFAULT 1,
          lastUsed DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function generateLicenseKey() {
  // Gera chave no formato SIAP-XXXX-XXXX-XXXX
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `SIAP-${part()}-${part()}-${part()}`;
}

function generateAccessToken() {
  return `siap_${crypto.randomBytes(32).toString('hex')}`;
}

module.exports = {
  getDb,
  initDb,
  generateLicenseKey,
  generateAccessToken,
  DB_PATH
};
