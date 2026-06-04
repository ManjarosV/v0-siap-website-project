const express = require('express');
const { registerUser, loginUser, generateToken, getUserById, authMiddleware, adminMiddleware } = require('./auth');
const { getDb } = require('./db');

const router = express.Router();

// POST /api/auth/register - Registrar novo usuário
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ erro: 'Email, senha e nome são obrigatórios' });
    }
    
    const user = await registerUser(email, password, name);
    const token = generateToken(user);
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
    });
    
    res.json({ 
      success: true, 
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// POST /api/auth/login - Fazer login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
    }
    
    const user = await loginUser(email, password);
    const token = generateToken(user);
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
    });
    
    res.json({ 
      success: true, 
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(401).json({ erro: err.message });
  }
});

// POST /api/auth/logout - Fazer logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// GET /api/auth/me - Obter dados do usuário autenticado
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/auth/subscription - Obter subscription do usuário
router.get('/subscription', authMiddleware, (req, res) => {
  const db = require('./db').getDb();
  
  db.then(database => {
    database.get(
      'SELECT * FROM subscriptions WHERE userId = ? ORDER BY createdAt DESC LIMIT 1',
      [req.user.id],
      (err, subscription) => {
        if (err) {
          res.status(500).json({ erro: err.message });
        } else {
          res.json(subscription || null);
        }
      }
    );
  });
});

// GET /api/auth/license - Obter license key do usuário
router.get('/license', authMiddleware, (req, res) => {
  const db = require('./db').getDb();
  
  db.then(database => {
    database.get(
      'SELECT * FROM licenses WHERE userId = ? ORDER BY createdAt DESC LIMIT 1',
      [req.user.id],
      (err, license) => {
        if (err) {
          res.status(500).json({ erro: err.message });
        } else {
          res.json(license || null);
        }
      }
    );
  });
});

// GET /api/admin/users - Listar todos os usuários (admin only)
router.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const db = require('./db').getDb();
  
  db.then(database => {
    database.all(
      'SELECT id, email, name, role, createdAt FROM users',
      (err, users) => {
        if (err) {
          res.status(500).json({ erro: err.message });
        } else {
          res.json(users || []);
        }
      }
    );
  });
});

// GET /api/admin/subscriptions - Listar todas as subscriptions (admin only)
router.get('/admin/subscriptions', authMiddleware, adminMiddleware, (req, res) => {
  const db = require('./db').getDb();
  
  db.then(database => {
    database.all(
      'SELECT * FROM subscriptions',
      (err, subscriptions) => {
        if (err) {
          res.status(500).json({ erro: err.message });
        } else {
          res.json(subscriptions || []);
        }
      }
    );
  });
});

// GET /api/admin/payments - Listar todos os pagamentos (admin only)
router.get('/admin/payments', authMiddleware, adminMiddleware, (req, res) => {
  const db = require('./db').getDb();
  
  db.then(database => {
    database.all(
      'SELECT * FROM payments',
      (err, payments) => {
        if (err) {
          res.status(500).json({ erro: err.message });
        } else {
          res.json(payments || []);
        }
      }
    );
  });
});

module.exports = router;
