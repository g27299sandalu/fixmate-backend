require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Stripe = require("stripe");

const app = express();

const PORT = Number(process.env.PORT) || 8080;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const RATE_LIMIT_WINDOW_MINUTES = Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 15;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf"
]);

function getCurrencyMinorUnit(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

function normalizeAmount(rawAmount, currency) {
  const minorUnit = getCurrencyMinorUnit(currency);
  const multiplier = 10 ** minorUnit;

  if (typeof rawAmount === "number") {
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return null;
    }
    if (Number.isInteger(rawAmount)) {
      return rawAmount;
    }
    return Math.round(rawAmount * multiplier);
  }

  if (typeof rawAmount === "string") {
    const amountText = rawAmount.trim();
    if (!amountText) {
      return null;
    }

    const parsed = Number(amountText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    if (/^\d+$/.test(amountText)) {
      return parsed;
    }

    return Math.round(parsed * multiplier);
  }

  return null;
}

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY environment variable.");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20"
});

const allowedOriginsRaw = process.env.ALLOWED_ORIGINS || "*";
const allowedOrigins = allowedOriginsRaw
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS blocked for this origin"));
    }
  })
);

app.use(
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    max: RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many requests. Please try again later."
    }
  })
);

function handleStripeWebhook(req, res) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return res.status(400).json({
      error: "Webhook secret is not configured"
    });
  }

  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).json({
      error: "Missing stripe-signature header"
    });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    return res.status(200).json({
      received: true,
      type: event.type
    });
  } catch (error) {
    return res.status(400).json({
      error: "Invalid webhook signature",
      message: error.message
    });
  }
}

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "FixMate Payment Backend is running",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development"
  });
});

app.get("/api/payments/config", (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({
      error: "STRIPE_PUBLISHABLE_KEY is not configured"
    });
  }

  return res.status(200).json({
    publishableKey: STRIPE_PUBLISHABLE_KEY
  });
});

app.post("/api/payments/create-intent", async (req, res) => {
  try {
    const { amount, currency = "usd", metadata = {}, customerId } = req.body || {};
    const normalizedCurrency = String(currency).toLowerCase();
    const normalizedAmount = normalizeAmount(amount, normalizedCurrency);

    if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({
        error: "Invalid amount. Send positive number (minor units or decimal major units)."
      });
    }

    const params = {
      amount: normalizedAmount,
      currency: normalizedCurrency,
      automatic_payment_methods: { enabled: true },
      metadata
    };

    if (customerId) {
      params.customer = String(customerId);
    }

    const intent = await stripe.paymentIntents.create(params);

    return res.status(201).json({
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status
    });
  } catch (error) {
    console.error("Failed to create payment intent", {
      type: error.type,
      code: error.code,
      message: error.message,
      requestId: error.requestId
    });

    const statusCode =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      error: "Failed to create payment intent",
      message: error.message,
      code: error.code || null,
      type: error.type || null
    });
  }
});

app.post("/api/payments/confirm", async (req, res) => {
  try {
    const { paymentIntentId, paymentMethodId } = req.body || {};

    if (!paymentIntentId) {
      return res.status(400).json({
        error: "paymentIntentId is required"
      });
    }

    const params = {};
    if (paymentMethodId) {
      params.payment_method = String(paymentMethodId);
    }

    const intent = await stripe.paymentIntents.confirm(String(paymentIntentId), params);

    return res.status(200).json({
      paymentIntentId: intent.id,
      status: intent.status
    });
  } catch (error) {
    const statusCode =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      error: "Failed to confirm payment",
      message: error.message,
      code: error.code || null,
      type: error.type || null
    });
  }
});

app.post("/api/payments/cash", (req, res) => {
  const { amount, currency = "usd", jobId, customerId, note = "" } = req.body || {};
  const normalizedCurrency = String(currency).toLowerCase();
  const normalizedAmount = normalizeAmount(amount, normalizedCurrency);

  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    return res.status(400).json({
      error: "Invalid amount. Send positive number (minor units or decimal major units)."
    });
  }

  return res.status(201).json({
    method: "cash",
    status: "pending_collection",
    amount: normalizedAmount,
    currency: normalizedCurrency,
    jobId: jobId || null,
    customerId: customerId || null,
    note: String(note)
  });
});

app.use((error, req, res, next) => {
  if (error && error.message && error.message.includes("CORS")) {
    return res.status(403).json({
      error: "CORS blocked"
    });
  }

  return res.status(500).json({
    error: "Internal server error"
  });
});

app.listen(PORT, () => {
  console.log(`FixMate payment backend running on port ${PORT}`);
});
