const express = require('express');
const { authMiddleware, adminMiddleware, getUserTokens, getAllTokens, revokeToken } = require('./auth');

const router = express.Router();

// GET /api/tokens/list - Listar tokens do usuário
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const tokens = await getUserTokens(req.user.id);
    res.json(tokens);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/tokens/revoke/:id - Revogar token do usuário
router.post('/revoke/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const success = await revokeToken(id, req.user.id);
    
    if (success) {
      res.json({ success: true, message: 'Token revogado com sucesso' });
    } else {
      res.status(404).json({ erro: 'Token não encontrado' });
    }
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/tokens/admin/all - Listar todos os tokens (admin only)
router.get('/admin/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const tokens = await getAllTokens();
    res.json(tokens);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
