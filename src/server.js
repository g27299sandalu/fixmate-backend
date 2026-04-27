require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();

const PORT = Number(process.env.PORT) || 8080;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

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

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
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

app.post("/api/payments/create-intent", async (req, res) => {
  try {
    const { amount, currency = "usd", metadata = {}, customerId } = req.body || {};

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({
        error: "Invalid amount. Use integer minor units (for USD: cents)."
      });
    }

    const params = {
      amount,
      currency: String(currency).toLowerCase(),
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
    return res.status(500).json({
      error: "Failed to create payment intent",
      message: error.message
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
    return res.status(500).json({
      error: "Failed to confirm payment",
      message: error.message
    });
  }
});

app.post("/api/payments/cash", (req, res) => {
  const { amount, currency = "usd", jobId, customerId, note = "" } = req.body || {};

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      error: "Invalid amount. Use integer minor units (for USD: cents)."
    });
  }

  return res.status(201).json({
    method: "cash",
    status: "pending_collection",
    amount,
    currency: String(currency).toLowerCase(),
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
