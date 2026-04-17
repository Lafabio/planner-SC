import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'lafaietep@gmail.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lilica10';
const DB_PATH = path.resolve(process.cwd(), 'data/db.json');

const sessions = new Map();

const mpClient = process.env.MP_ACCESS_TOKEN
  ? new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
  : null;

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || [],
      tokenBalances: parsed.tokenBalances || {},
      payments: parsed.payments || {}
    };
  } catch {
    return { users: [], tokenBalances: {}, payments: {} };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function seedAdmin() {
  const db = readDb();
  if (db.users.find((u) => u.email === ADMIN_EMAIL)) return;

  db.users.push({
    id: crypto.randomUUID(),
    name: 'Administrador',
    email: ADMIN_EMAIL,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    role: 'admin',
    createdAt: new Date().toISOString()
  });
  writeDb(db);
}

function sanitizeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  req.user = sessions.get(token);
  next();
}

app.use(express.json());
app.use(cors({ origin: FRONTEND_URL === '*' ? true : FRONTEND_URL }));

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    app: 'planner-sc-backend',
    mp_configured: Boolean(mpClient),
    now: new Date().toISOString()
  });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password são obrigatórios.' });

  const safeEmail = String(email).toLowerCase().trim();
  const db = readDb();
  if (db.users.find((u) => u.email === safeEmail)) {
    return res.status(409).json({ error: 'Email já cadastrado.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: safeEmail,
    passwordHash: hashPassword(String(password)),
    role: safeEmail === ADMIN_EMAIL ? 'admin' : 'teacher',
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  if (!db.tokenBalances[user.id]) {
    db.tokenBalances[user.id] = { freeLimit: 5, generated: 0, paidTokens: 0 };
  }
  writeDb(db);

  res.status(201).json({ user: sanitizeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const safeEmail = String(email || '').toLowerCase().trim();
  const db = readDb();
  const user = db.users.find((u) => u.email === safeEmail);

  if (!user || user.passwordHash !== hashPassword(String(password || ''))) {
    return res.status(401).json({ error: 'Email ou senha inválidos.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, sanitizeUser(user));

  if (!db.tokenBalances[user.id]) {
    db.tokenBalances[user.id] = { freeLimit: 5, generated: 0, paidTokens: 0 };
    writeDb(db);
  }

  return res.json({ token, user: sanitizeUser(user), tokenBalance: db.tokenBalances[user.id] });
});

app.get('/api/tokens/me', auth, (req, res) => {
  const db = readDb();
  const balance = db.tokenBalances[req.user.id] || { freeLimit: 5, generated: 0, paidTokens: 0 };
  const freeLeft = Math.max(0, balance.freeLimit - balance.generated);
  res.json({ ...balance, freeLeft, totalLeft: freeLeft + (balance.paidTokens || 0) });
});

app.post('/api/mp/criar-preferencia', auth, async (req, res) => {
  if (!mpClient) return res.status(500).json({ error: 'Mercado Pago não configurado no backend.' });

  const { titulo, valor_centavos, ref_externa, qtd_tokens } = req.body || {};
  if (!titulo || !valor_centavos || !ref_externa || !qtd_tokens) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  }

  try {
    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: [{
          title: String(titulo),
          quantity: 1,
          unit_price: Number(valor_centavos) / 100,
          currency_id: 'BRL'
        }],
        external_reference: String(ref_externa),
        notification_url: `${req.protocol}://${req.get('host')}/api/mp/webhook`,
        metadata: {
          userId: req.user.id,
          qtdTokens: Number(qtd_tokens)
        }
      }
    });

    const db = readDb();
    db.payments[ref_externa] = {
      status: 'pending',
      userId: req.user.id,
      qtdTokens: Number(qtd_tokens),
      createdAt: new Date().toISOString(),
      preferenceId: result.id
    };
    writeDb(db);

    res.json({ init_point: result.init_point, sandbox_init_point: result.sandbox_init_point, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erro ao criar pagamento.' });
  }
});

app.get('/api/mp/verificar/:ref', auth, async (req, res) => {
  const ref = req.params.ref;
  const db = readDb();
  const localPayment = db.payments[ref];

  if (localPayment?.status === 'approved') {
    return res.json({ aprovado: true, source: 'local' });
  }

  if (!mpClient) return res.json({ aprovado: false, status: localPayment?.status || 'pending' });

  try {
    const paymentApi = new Payment(mpClient);
    const search = await paymentApi.search({ options: { external_reference: ref, sort: 'date_created', criteria: 'desc' } });
    const result = search.results?.[0];

    if (result?.status === 'approved') {
      const qtd = Number(localPayment?.qtdTokens || result.metadata?.qtdTokens || 0);
      const uid = localPayment?.userId;
      if (uid) {
        const balance = db.tokenBalances[uid] || { freeLimit: 5, generated: 0, paidTokens: 0 };
        balance.paidTokens = Number(balance.paidTokens || 0) + qtd;
        db.tokenBalances[uid] = balance;
      }

      db.payments[ref] = {
        ...(localPayment || {}),
        status: 'approved',
        approvedAt: new Date().toISOString(),
        mpPaymentId: result.id
      };
      writeDb(db);

      return res.json({ aprovado: true, status: 'approved' });
    }

    return res.json({ aprovado: false, status: result?.status || 'pending' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Erro ao verificar pagamento.' });
  }
});

app.post('/api/mp/webhook', (req, res) => {
  // Webhook opcional para processamento assíncrono. Nesta versão,
  // a confirmação final acontece no endpoint /api/mp/verificar/:ref.
  res.status(200).json({ ok: true });
});

seedAdmin();
app.listen(PORT, () => {
  console.log(`planner-sc backend rodando em http://localhost:${PORT}`);
});
