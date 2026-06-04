# SIAP Automator - Sistema de Assinaturas

Sistema completo de venda de assinaturas com pagamento PIX via Mercado Pago.

## Fluxo do Sistema

1. Usuario se registra (sem chave)
2. Usuario vai para `/pagamento` e escolhe um plano
3. Sistema gera QR Code PIX
4. Usuario paga
5. Webhook do Mercado Pago confirma o pagamento
6. Sistema gera automaticamente:
   - Subscription com data de expiracao
   - Chave de licenca no formato `SIAP-XXXX-XXXX-XXXX`
7. Usuario acessa o Dashboard e ve sua chave

---

## Como Hospedar no seu PC

### 1. Requisitos

- **Node.js 16+**: [Download](https://nodejs.org/)
- **Conta no Mercado Pago**: [Criar conta](https://www.mercadopago.com.br/)

### 2. Configurar Mercado Pago

1. Acesse [Mercado Pago Developers](https://www.mercadopago.com.br/developers)
2. Crie uma aplicacao
3. Copie o **Access Token** (de producao ou teste)
4. Configure o webhook para: `http://seu-ip:4000/webhook/mp`

### 3. Instalacao

```bash
# Clone ou baixe o projeto
git clone https://github.com/ManjarosV/Siap-Website.git
cd Siap-Website

# Instale as dependencias
npm install

# Copie o arquivo de configuracao
cp .env.example .env

# Edite o arquivo .env com seus dados
nano .env
```

### 4. Configurar Variaveis de Ambiente

Edite o arquivo `.env`:

```env
# Token do Mercado Pago (obrigatorio)
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxx

# Segredo para webhooks (opcional, mas recomendado)
WEBHOOK_SECRET=sua-chave-secreta

# Segredo para JWT
JWT_SECRET=uma-chave-bem-longa-e-segura-123

# URL base (importante para webhooks)
BASE_URL=http://localhost:4000

# Porta
PORT=4000
```

### 5. Iniciar o Servidor

```bash
npm start
```

Voce vera:

```
════════════════════════════════════════════════════════════
  SIAP Automator - Servidor Iniciado
════════════════════════════════════════════════════════════
  URL Local:    http://localhost:4000
  Banco:        /caminho/siap.db

  Endpoints disponiveis:
     POST /criar-pagamento-pix  - Criar pagamento PIX
     GET  /verificar-pagamento  - Verificar status
     POST /api/validar-licenca  - Validar chave
     POST /webhook/mp           - Webhook do MP
════════════════════════════════════════════════════════════
```

---

## Paginas Disponiveis

| URL | Descricao |
|-----|-----------|
| `/` | Landing page |
| `/registro` | Criar conta |
| `/login` | Fazer login |
| `/dashboard` | Painel do usuario |
| `/pagamento` | Pagamento PIX |
| `/admin.html` | Painel admin |

---

## API Endpoints

### Autenticacao

```
POST /api/auth/register    - Registrar usuario
POST /api/auth/login       - Fazer login
POST /api/auth/logout      - Fazer logout
GET  /api/auth/me          - Dados do usuario logado
GET  /api/auth/subscription - Subscription do usuario
GET  /api/auth/license     - Chave de licenca do usuario
```

### Pagamento

```
POST /criar-pagamento-pix  - Criar pagamento PIX
GET  /verificar-pagamento/:id - Verificar status do pagamento
```

### Validacao de Licenca (para o script Tampermonkey)

```
POST /api/validar-licenca
Body: { "licenseKey": "SIAP-XXXX-XXXX-XXXX" }

Resposta (valida):
{
  "valida": true,
  "usuario": "Nome",
  "email": "email@exemplo.com",
  "expiraEm": "01/02/2025",
  "diasRestantes": 30
}

Resposta (invalida):
{
  "valida": false,
  "erro": "Chave expirada"
}
```

---

## Expor para Internet (Webhooks)

Para receber webhooks do Mercado Pago, seu servidor precisa estar acessivel pela internet.

### Opcao 1: ngrok (mais facil)

```bash
# Instalar ngrok
npm install -g ngrok

# Expor porta 4000
ngrok http 4000
```

Copie a URL (ex: `https://abc123.ngrok.io`) e configure no Mercado Pago.

### Opcao 2: Cloudflare Tunnel (gratis e permanente)

```bash
# Instalar cloudflared
# Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Criar tunnel
cloudflared tunnel --url http://localhost:4000
```

### Opcao 3: Tailscale Funnel

Se voce usa Tailscale:

```bash
tailscale funnel 4000
```

---

## Testar Pagamento (Sandbox)

1. Use o **Access Token de TESTE** do Mercado Pago
2. Use cartoes de teste: [Documentacao](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-test/test-cards)
3. Para PIX em sandbox, o pagamento e aprovado automaticamente

---

## Criar Usuario Admin

```bash
# Acesse o banco SQLite
sqlite3 siap.db

# Atualize o usuario para admin
UPDATE users SET role = 'admin' WHERE email = 'seu-email@exemplo.com';
```

---

## Estrutura do Banco de Dados

```sql
-- Usuarios
users (id, email, password, name, role, createdAt)

-- Assinaturas
subscriptions (id, userId, planType, status, startDate, expiryDate, createdAt)

-- Licencas
licenses (id, userId, subscriptionId, licenseKey, isActive, createdAt)

-- Pagamentos
payments (id, userId, email, amount, planType, mercadoPagoId, status, createdAt)
```

---

## Planos Disponiveis

| Plano | Preco | Duracao |
|-------|-------|---------|
| Mensal | R$ 29,90 | 30 dias |
| Trimestral | R$ 69,90 | 90 dias |

Para alterar os planos, edite a constante `PLANOS` no arquivo `server.js`.

---

## Suporte

- Documentacao Mercado Pago: https://www.mercadopago.com.br/developers
- Problemas com PIX: Verifique se o token esta correto e se a conta esta verificada
