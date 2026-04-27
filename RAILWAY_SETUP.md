# Railway Setup Guide - FixMate Payment Backend

This guide matches the backend in this repository.

## 0) Rotate Exposed Keys

Because Stripe keys were shared in chat, rotate/revoke them now.

1. Stripe Dashboard -> Developers -> API keys.
2. Revoke exposed test keys.
3. Create fresh keys:
    - `sk_test_...` for backend
    - `pk_test_...` for mobile/web client

## 1) Connect This Repo To Railway

1. Push repository to GitHub.
2. In Railway, click New Project -> Deploy from GitHub repo.
3. Select this repository.
4. Railway builds Node app automatically from `package.json`.

## 2) Configure Railway Variables

Add these variables in Railway -> Service -> Variables:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # optional, needed only if webhooks are used
NODE_ENV=production
ALLOWED_ORIGINS=https://your-android-webview-origin.com,https://your-frontend-domain.com
```

Notes:

- During testing only, `ALLOWED_ORIGINS=*` is acceptable.
- Do not quote values unless value itself includes quotes.

## 3) Deploy

1. Railway auto-deploys after pushing code or changing variables.
2. Open Deployments tab and ensure latest deployment is successful.
3. In Logs, confirm startup line:

```text
FixMate payment backend running on port <port>
```

## 4) Verify Endpoints

Base URL example:

```text
https://<your-service>.up.railway.app
```

Health check:

```http
GET /health
```

Create payment intent:

```http
POST /api/payments/create-intent
Content-Type: application/json

{
   "amount": 1500,
   "currency": "usd",
   "metadata": {
      "jobId": "JOB_1001",
      "customerId": "CUS_42"
   }
}
```

Expected response includes:

```json
{
   "paymentIntentId": "pi_...",
   "clientSecret": "pi_..._secret_...",
   "status": "requires_payment_method"
}
```

Confirm payment:

```http
POST /api/payments/confirm
Content-Type: application/json

{
   "paymentIntentId": "pi_...",
   "paymentMethodId": "pm_..."
}
```

Cash fallback:

```http
POST /api/payments/cash
Content-Type: application/json

{
   "amount": 1500,
   "currency": "usd",
   "jobId": "JOB_1001"
}
```

## 5) Optional: Stripe Webhook

If you process async events:

1. In Stripe Dashboard, create webhook endpoint:
    - `https://<your-service>.up.railway.app/api/payments/webhook`
2. Copy webhook signing secret (`whsec_...`).
3. Set `STRIPE_WEBHOOK_SECRET` in Railway variables.

## 6) Local Test Before Railway (Recommended)

```bash
npm install
cp .env.example .env
# set STRIPE_SECRET_KEY in .env
npm start
```

Then test `http://localhost:8080/health`.

## 7) Troubleshooting

`Invalid API Key provided`

- `STRIPE_SECRET_KEY` is wrong or revoked.
- Use only `sk_test_...` for test mode.

`CORS blocked`

- Add your app origin to `ALLOWED_ORIGINS`.
- For debugging, temporarily set `ALLOWED_ORIGINS=*`.

`500 Failed to create payment intent`

- Ensure `amount` is an integer in minor units (for USD, cents).
- Check Railway logs for Stripe error details.

`Webhook signature verification failed`

- `STRIPE_WEBHOOK_SECRET` is missing or incorrect.
- Ensure raw body is sent (already handled in backend route).

## 8) Production Checklist

1. Switch to `sk_live_...` and `pk_live_...` only when ready.
2. Restrict `ALLOWED_ORIGINS` to exact domains.
3. Never store secret keys in app source or mobile app.
4. Keep `.env` local only; use Railway Variables in deployment.
