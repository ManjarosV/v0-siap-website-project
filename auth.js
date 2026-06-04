const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, generateAccessToken } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'siap-automator-secret-key-2024';
const JWT_EXPIRY = '7d';

async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

async function registerUser(email, password, name) {
  const db = await getDb();
  
  return new Promise(async (resolve, reject) => {
    try {
      const hashedPassword = await hashPassword(password);
      
      db.run(
        'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)',
        [email, hashedPassword, name, 'user'],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              reject(new Error('Email já registrado'));
            } else {
              reject(err);
            }
          } else {
            resolve({ id: this.lastID, email, name, role: 'user' });
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

async function loginUser(email, password) {
  const db = await getDb();
  
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        reject(err);
      } else if (!user) {
        reject(new Error('Usuário não encontrado'));
      } else {
        const isValid = await comparePassword(password, user.password);
        if (isValid) {
          resolve(user);
        } else {
          reject(new Error('Senha incorreta'));
        }
      }
    });
  });
}

async function getUserById(id) {
  const db = await getDb();
  
  return new Promise((resolve, reject) => {
    db.get('SELECT id, email, name, role, createdAt FROM users WHERE id = ?', [id], (err, user) => {
      if (err) {
        reject(err);
      } else {
        resolve(user || null);
      }
    });
  });
}

function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
  
  req.user = decoded;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  next();
}

async function tokenAuthMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }
  
  const db = await getDb();
  db.get(
    'SELECT t.*, u.id as userId FROM tokens t JOIN users u ON t.userId = u.id WHERE t.token = ? AND t.isActive = 1',
    [token],
    (err, row) => {
      if (err || !row) {
        return res.status(401).json({ erro: 'Token inválido ou revogado' });
      }
      req.tokenUser = row;
      next();
    }
  );
}

async function getUserTokens(userId) {
  const db = await getDb();
  
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT id, name, isActive, lastUsed, createdAt FROM tokens WHERE userId = ? ORDER BY createdAt DESC',
      [userId],
      (err, tokens) => {
        if (err) {
          reject(err);
        } else {
          resolve(tokens || []);
        }
      }
    );
  });
}

async function getAllTokens() {
  const db = await getDb();
  
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT t.id, t.userId, t.token, t.name, t.isActive, t.lastUsed, t.createdAt, u.email, u.name as userName FROM tokens t JOIN users u ON t.userId = u.id ORDER BY t.createdAt DESC',
      (err, tokens) => {
        if (err) {
          reject(err);
        } else {
          resolve(tokens || []);
        }
      }
    );
  });
}

async function revokeToken(tokenId, userId) {
  const db = await getDb();
  
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE tokens SET isActive = 0 WHERE id = ? AND userId = ?',
      [tokenId, userId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      }
    );
  });
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  registerUser,
  loginUser,
  getUserById,
  authMiddleware,
  adminMiddleware,
  tokenAuthMiddleware,
  getUserTokens,
  getAllTokens,
  revokeToken,
  JWT_SECRET
};
