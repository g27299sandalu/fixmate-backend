# Quick Fix Checklist - Stripe + Railway

## 1) Security First (Do This Now)

Your Stripe keys were shared in chat. Treat them as exposed.

1. Open Stripe Dashboard -> Developers -> API keys.
2. Rotate/revoke exposed test keys.
3. Generate new keys for testing:
   - `sk_test_...` (backend only)
   - `pk_test_...` (frontend/mobile)
4. Do not paste secret keys into source files.

## 2) Backend Is Ready In This Repo

This repository now includes a working Node backend:

- `src/server.js`
- `package.json`
- `.env.example`
- `.gitignore`

Implemented endpoints:

- `GET /health`
- `POST /api/payments/create-intent`
- `POST /api/payments/confirm`
- `POST /api/payments/cash`
- `POST /api/payments/webhook`

## 3) Railway Variables You Must Set

In Railway -> Service -> Variables, add:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # optional unless using webhooks
NODE_ENV=production
ALLOWED_ORIGINS=https://your-app-domain.com
```

Use `*` for `ALLOWED_ORIGINS` only during testing.

## 4) Deploy

1. Push this repo to GitHub.
2. In Railway, create a project from this repo.
3. Railway auto-detects Node and runs `npm start`.
4. Wait for successful deployment.

## 5) Health Check

Open:

```text
https://<your-railway-domain>/health
```

Expected response includes:

```json
{
  "status": "OK"
}
```

## 6) Test Payment Intent

Request:

```http
POST /api/payments/create-intent
Content-Type: application/json

{
  "amount": 1000,
  "currency": "usd",
  "metadata": {
    "orderId": "ORDER_123"
  }
}
```

Response returns `clientSecret` for your app payment flow.

## Important Notes

- Backend should use only `sk_test_...` / `sk_live_...`.
- Frontend/mobile should use only `pk_test_...` / `pk_live_...`.
- Do not use restricted keys (`rk_...`) unless you explicitly configured scopes for a special purpose.
- Keep `.env` out of git (already ignored).

For complete deployment steps, see `RAILWAY_SETUP.md`.
