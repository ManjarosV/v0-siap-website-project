const express = require('express');
const { getDb } = require('./db');

const router = express.Router();

// POST /webhook/token - Rota simples para n8n armazenar token
router.post('/token', async (req, res) => {
  try {
    console.log('[Webhook Token] Recebido:', JSON.stringify(req.body));
    
    const { userId, email, token, name } = req.body;

    if (!userId || !token) {
      console.log('[Webhook Token] Erro: userId ou token faltando');
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
          console.error('[Webhook Token] Erro ao armazenar:', err);
          return res.status(500).json({ 
            success: false, 
            error: 'Erro ao armazenar token' 
          });
        }

        console.log('[Webhook Token] ✅ Token armazenado com sucesso');
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
    console.error('[Webhook Token] Erro:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

module.exports = router;
