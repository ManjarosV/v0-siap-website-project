const express = require('express');
const { getDb } = require('./db');

const router = express.Router();

// POST /api/tokens/store - Armazenar token gerado pelo n8n
router.post('/store', async (req, res) => {
  try {
    const { userId, email, token, name } = req.body;

    if (!userId || !token) {
      return res.status(400).json({ 
        success: false, 
        error: 'userId e token são obrigatórios' 
      });
    }

    const db = await getDb();

    // Armazenar token no banco de dados
    db.run(
      'INSERT INTO tokens (userId, token, name, isActive) VALUES (?, ?, ?, ?)',
      [userId, token, name || 'Auto-generated Token', 1],
      function(err) {
        if (err) {
          console.error('Erro ao armazenar token:', err);
          return res.status(500).json({ 
            success: false, 
            error: 'Erro ao armazenar token' 
          });
        }

        res.json({ 
          success: true, 
          message: 'Token armazenado com sucesso',
          tokenId: this.lastID,
          userId: userId,
          email: email
        });
      }
    );
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

module.exports = router;
