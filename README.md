# Planner SC — Frontend + Backend com Monetização (Mercado Pago)

Este projeto foi preparado para rodar com:

- **Frontend** (arquivo `index.html`) hospedado no GitHub Pages.
- **Backend Node.js** em `backend/`, pronto para deploy no Railway.
- **Integração segura com Mercado Pago** (o access token fica apenas no backend).

## 1) Estrutura

- `index.html`: aplicação principal (frontend).
- `backend/src/server.js`: API para autenticação e pagamentos.
- `backend/data/db.json`: armazenamento simples de usuários/tokens/pagamentos.
- `backend/.env.example`: variáveis de ambiente.

## 2) Usuário admin padrão

O backend cria automaticamente o admin:

- **Email:** `lafaietep@gmail.com`
- **Senha:** `lilica10`

Você pode sobrescrever no Railway com `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

## 3) Rodando backend localmente

```bash
cd backend
npm install
cp .env.example .env
npm start
```

API padrão: `http://localhost:3000`

## 4) Deploy do backend no Railway

1. Suba este repositório no GitHub.
2. No Railway: **New Project → Deploy from GitHub repo**.
3. Defina as variáveis:
   - `PORT`
   - `FRONTEND_URL` (URL do seu GitHub Pages)
   - `MP_ACCESS_TOKEN`
   - `ADMIN_EMAIL` (opcional)
   - `ADMIN_PASSWORD` (opcional)
4. Deploy.
5. Copie a URL gerada (ex.: `https://planner-sc-api.up.railway.app`).

## 5) Frontend (GitHub Pages)

1. Publique o `index.html` no GitHub Pages.
2. Faça login como admin e abra o painel.
3. Em **Mercado Pago — Configuração**, informe a URL do backend Railway.
4. Salve e use **Testar conexão**.

## 6) Endpoints principais

- `GET /api/status`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/tokens/me` (Bearer token)
- `POST /api/mp/criar-preferencia` (Bearer token)
- `GET /api/mp/verificar/:ref` (Bearer token)
- `POST /api/mp/webhook`

## 7) Observações

- O frontend mantém fallback local (localStorage) caso backend não esteja configurado.
- Para produção, recomenda-se migrar `backend/data/db.json` para PostgreSQL.
