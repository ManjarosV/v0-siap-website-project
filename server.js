const express = require('express');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const cookieParser = require('cookie-parser');
const { initDb, getDb, generateLicenseKey } = require('./db');
const authRoutes = require('./routes-auth');
const tokenRoutes = require('./routes-tokens');
const tokenStoreRoutes = require('./routes-token-store');
const tokenWebhookRoutes = require('./routes-token-webhook');

const app = express();
const PORT = process.env.PORT || 4000;

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

// Planos com validade em dias
const PLANOS = {
  'mensal':     { preco: 29.90, titulo: 'SIAP Automator — Mensal', dias: 30 },
  'trimestral': { preco: 69.90, titulo: 'SIAP Automator — Trimestral', dias: 90 }
};

// Raw body para validação de assinatura do webhook
app.use((req, res, next) => {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    try { req.body = JSON.parse(data); } catch (_) { req.body = {}; }
    next();
  });
});

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar banco de dados
initDb().catch(err => console.error('Erro ao inicializar DB:', err));

// Rotas de autenticação
app.use('/api/auth', authRoutes);

// Rotas de tokens
app.use('/api/tokens', tokenRoutes);

// Rotas de armazenamento de tokens (n8n)
app.use('/api/tokens', tokenStoreRoutes);

// Rotas de webhook para n8n
app.use('/webhook', tokenWebhookRoutes);

// ══════════════════════════════════════════════════════════════════════════════
// CRIAR PAGAMENTO PIX (Mercado Pago)
// ══════════════════════════════════════════════════════════════════════════════
app.post('/criar-pagamento-pix', async (req, res) => {
  const { plano, userId, email, nome } = req.body;

  // Verificar se o token do Mercado Pago está configurado
  if (!MP_ACCESS_TOKEN) {
    console.error('[PIX] ERRO: MP_ACCESS_TOKEN nao configurado no .env');
    return res.status(500).json({ 
      erro: 'Mercado Pago nao configurado. Adicione MP_ACCESS_TOKEN no arquivo .env' 
    });
  }

  const planoKey = plano?.toLowerCase();
  if (!PLANOS[planoKey]) {
    return res.status(400).json({ erro: 'Plano invalido' });
  }
  if (!userId || !email) {
    return res.status(400).json({ erro: 'userId e email sao obrigatorios' });
  }

  const info = PLANOS[planoKey];
  
  console.log(`[PIX] Criando pagamento: plano=${planoKey}, userId=${userId}, email=${email}`);
  
  // Criar pagamento PIX via API do Mercado Pago
  const payload = JSON.stringify({
    transaction_amount: info.preco,
    description: info.titulo,
    payment_method_id: 'pix',
    payer: {
      email: email,
      first_name: nome || 'Cliente'
    },
    // Referência externa para identificar o pagamento no webhook
    external_reference: JSON.stringify({
      userId: userId,
      email: email,
      plano: planoKey,
      dias: info.dias,
      timestamp: Date.now()
    }),
    notification_url: `${BASE_URL}/webhook/mp`
  });

  const options = {
    hostname: 'api.mercadopago.com',
    path: '/v1/payments',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
      'X-Idempotency-Key': `${userId}-${Date.now()}`,
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const mpReq = https.request(options, mpRes => {
    let body = '';
    mpRes.on('data', chunk => { body += chunk; });
    mpRes.on('end', async () => {
      try {
        const data = JSON.parse(body);
        
        if (data.id && data.point_of_interaction?.transaction_data) {
          const pixData = data.point_of_interaction.transaction_data;
          
          // Salvar pagamento pendente no banco
          const db = await getDb();
          db.run(
            `INSERT INTO payments (userId, email, amount, planType, mercadoPagoId, status) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, email, info.preco.toString(), planoKey, data.id.toString(), 'pending']
          );

          console.log(`[PIX] Pagamento criado: ${data.id} — ${email} — ${planoKey}`);
          
          res.json({
            success: true,
            paymentId: data.id,
            qrCode: pixData.qr_code,           // Código copia e cola
            qrCodeBase64: pixData.qr_code_base64, // QR Code em base64
            ticketUrl: pixData.ticket_url,     // URL para visualização
            expiresAt: data.date_of_expiration
          });
        } else {
          console.error('[PIX] Erro na resposta do Mercado Pago:');
          console.error('[PIX] Status HTTP:', mpRes.statusCode);
          console.error('[PIX] Body:', body);
          
          // Erros comuns do Mercado Pago
          let mensagemErro = 'Erro ao criar pagamento PIX';
          if (data.message) {
            mensagemErro = data.message;
          }
          if (data.cause && data.cause.length > 0) {
            mensagemErro = data.cause.map(c => c.description || c.code).join(', ');
          }
          if (mpRes.statusCode === 401) {
            mensagemErro = 'Token do Mercado Pago invalido. Verifique MP_ACCESS_TOKEN no .env';
          }
          
          res.status(500).json({ erro: mensagemErro, detalhes: data });
        }
      } catch (e) {
        console.error('[PIX] Erro ao processar resposta:', e.message);
        res.status(500).json({ erro: 'Erro interno' });
      }
    });
  });

  mpReq.on('error', err => {
    console.error('[PIX] Erro de conexão:', err.message);
    res.status(500).json({ erro: 'Erro de conexão com Mercado Pago' });
  });

  mpReq.write(payload);
  mpReq.end();
});

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICAR STATUS DO PAGAMENTO
// ══════════════════════════════════════════════════════════════════════════════
app.get('/verificar-pagamento/:paymentId', async (req, res) => {
  const { paymentId } = req.params;

  const options = {
    hostname: 'api.mercadopago.com',
    path: `/v1/payments/${paymentId}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
    }
  };

  https.get(options, mpRes => {
    let body = '';
    mpRes.on('data', chunk => { body += chunk; });
    mpRes.on('end', () => {
      try {
        const data = JSON.parse(body);
        res.json({
          status: data.status,
          statusDetail: data.status_detail
        });
      } catch (e) {
        res.status(500).json({ erro: 'Erro ao verificar pagamento' });
      }
    });
  }).on('error', err => {
    res.status(500).json({ erro: 'Erro de conexão' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK DO MERCADO PAGO — GERA CHAVE APÓS PAGAMENTO APROVADO
// ══════════════════════════════════════════════════════════════════════════════
async function handleWebhook(req, res) {
  try {
    // Valida assinatura se vier no header (produção)
    const sig   = req.headers['x-signature'];
    const reqId = req.headers['x-request-id'] || '';
    if (sig && WEBHOOK_SECRET) {
      const parts = {};
      sig.split(',').forEach(p => {
        const [k, v] = p.split('=');
        if (k && v) parts[k.trim()] = v.trim();
      });
      const ts     = parts['ts'] || '';
      const v1     = parts['v1'] || '';
      const dataId = req.query['data.id'] || req.body?.data?.id || '';
      const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');
      if (hmac !== v1) {
        console.log('[WEBHOOK] Assinatura inválida');
        return res.sendStatus(200);
      }
    }

    const { type, data, action } = req.body || {};
    console.log(`[WEBHOOK] Recebido: type=${type} action=${action} id=${data?.id}`);

    if (type === 'payment' && data?.id) {
      // Busca detalhes do pagamento na API do MP
      const options = {
        hostname: 'api.mercadopago.com',
        path: `/v1/payments/${data.id}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      };

      https.get(options, mpRes => {
        let body = '';
        mpRes.on('data', chunk => { body += chunk; });
        mpRes.on('end', async () => {
          try {
            const pagamento = JSON.parse(body);
            const status = pagamento.status;

            console.log(`[WEBHOOK] Pagamento ${data.id} — status=${status}`);

            if (status === 'approved') {
              // Extrair dados da referência externa
              let refData = {};
              try {
                refData = JSON.parse(pagamento.external_reference || '{}');
              } catch (e) {
                console.error('[WEBHOOK] Erro ao parsear external_reference');
              }

              const { userId, email, plano, dias } = refData;

              if (!userId) {
                console.error('[WEBHOOK] userId não encontrado na referência');
                return;
              }

              const db = await getDb();

              // Verificar se já existe subscription ativa para este pagamento
              const existingPayment = await new Promise((resolve, reject) => {
                db.get(
                  'SELECT * FROM payments WHERE mercadoPagoId = ? AND status = ?',
                  [data.id.toString(), 'approved'],
                  (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                  }
                );
              });

              if (existingPayment) {
                console.log(`[WEBHOOK] Pagamento ${data.id} já foi processado`);
                return;
              }

              // Atualizar status do pagamento
              db.run(
                'UPDATE payments SET status = ? WHERE mercadoPagoId = ?',
                ['approved', data.id.toString()]
              );

              // Calcular data de expiração
              const startDate = new Date();
              const expiryDate = new Date();
              expiryDate.setDate(expiryDate.getDate() + (dias || 30));

              // Criar subscription
              const subscriptionId = await new Promise((resolve, reject) => {
                db.run(
                  `INSERT INTO subscriptions (userId, planType, status, startDate, expiryDate) 
                   VALUES (?, ?, 'active', ?, ?)`,
                  [userId, plano, startDate.toISOString(), expiryDate.toISOString()],
                  function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                  }
                );
              });

              // Gerar chave de licença no formato SIAP-XXXX-XXXX-XXXX
              const licenseKey = generateLicenseKey();

              // Criar license
              db.run(
                `INSERT INTO licenses (userId, subscriptionId, licenseKey, isActive) 
                 VALUES (?, ?, ?, 1)`,
                [userId, subscriptionId, licenseKey]
              );

              console.log(`[WEBHOOK] ✅ PAGAMENTO APROVADO!`);
              console.log(`[WEBHOOK] 👤 Usuário: ${userId} (${email})`);
              console.log(`[WEBHOOK] 📋 Plano: ${plano} (${dias} dias)`);
              console.log(`[WEBHOOK] 🔑 Chave: ${licenseKey}`);
              console.log(`[WEBHOOK] 📅 Expira em: ${expiryDate.toLocaleDateString('pt-BR')}`);
            }
          } catch (e) {
            console.error('[WEBHOOK] Erro ao processar pagamento:', e.message);
          }
        });
      }).on('error', err => console.error('[WEBHOOK] Erro ao buscar pagamento:', err.message));
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message);
    res.sendStatus(200);
  }
}

// Rotas do webhook (múltiplas para compatibilidade)
app.post('/webhook/mp',       handleWebhook);
app.post('/site/webhook/mp',  handleWebhook);
app.post('/mp',               handleWebhook);
app.get('/webhook/mp',        (req, res) => res.sendStatus(200));
app.get('/site/webhook/mp',   (req, res) => res.sendStatus(200));
app.get('/mp',                (req, res) => res.sendStatus(200));

// ══════════════════════════════════════════════════════════════════════════════
// VALIDAR CHAVE DE LICENÇA (para uso no script Tampermonkey)
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/validar-licenca', async (req, res) => {
  const { licenseKey } = req.body;

  if (!licenseKey) {
    return res.status(400).json({ valida: false, erro: 'Chave não fornecida' });
  }

  const db = await getDb();
  
  db.get(
    `SELECT l.*, s.expiryDate, s.status as subStatus, u.email, u.name 
     FROM licenses l
     JOIN subscriptions s ON l.subscriptionId = s.id
     JOIN users u ON l.userId = u.id
     WHERE l.licenseKey = ?`,
    [licenseKey],
    (err, row) => {
      if (err) {
        return res.status(500).json({ valida: false, erro: 'Erro interno' });
      }

      if (!row) {
        return res.json({ valida: false, erro: 'Chave não encontrada' });
      }

      // Verificar se está ativa
      if (!row.isActive) {
        return res.json({ valida: false, erro: 'Chave desativada' });
      }

      // Verificar se a subscription está ativa
      if (row.subStatus !== 'active') {
        return res.json({ valida: false, erro: 'Assinatura inativa' });
      }

      // Verificar validade
      const agora = new Date();
      const expira = new Date(row.expiryDate);
      
      if (agora > expira) {
        // Atualizar status da subscription para expirada
        db.run('UPDATE subscriptions SET status = ? WHERE id = ?', ['expired', row.subscriptionId]);
        return res.json({ 
          valida: false, 
          erro: 'Chave expirada',
          expirouEm: expira.toLocaleDateString('pt-BR')
        });
      }

      // Chave válida!
      res.json({
        valida: true,
        usuario: row.name,
        email: row.email,
        expiraEm: expira.toLocaleDateString('pt-BR'),
        diasRestantes: Math.ceil((expira - agora) / (1000 * 60 * 60 * 24))
      });
    }
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// PÁGINAS ESTÁTICAS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/obrigado', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'obrigado.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/registro', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

app.get('/pagamento', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pagamento.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════════════════════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ══════════════════════════════════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log('═'.repeat(60));
  console.log('  SIAP Automator - Servidor Iniciado');
  console.log('═'.repeat(60));
  console.log(`  🌐 URL Local:    http://localhost:${PORT}`);
  console.log(`  📁 Banco:        ${require('./db').DB_PATH}`);
  console.log('');
  console.log('  📋 Endpoints disponíveis:');
  console.log('     POST /criar-pagamento-pix  - Criar pagamento PIX');
  console.log('     GET  /verificar-pagamento  - Verificar status');
  console.log('     POST /api/validar-licenca  - Validar chave');
  console.log('     POST /webhook/mp           - Webhook do MP');
  console.log('═'.repeat(60));
});
