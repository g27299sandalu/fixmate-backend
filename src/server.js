require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Stripe = require("stripe");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT) || 8080;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const RATE_LIMIT_WINDOW_MINUTES = Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 15;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;

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

    const sanitizedAmountText = amountText
      .replace(/,/g, "")
      .replace(/[^0-9.\-]/g, "");

    if (!sanitizedAmountText || sanitizedAmountText === "." || sanitizedAmountText === "-") {
      return null;
    }

    const parsed = Number(sanitizedAmountText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    if (/^\d+$/.test(sanitizedAmountText)) {
      return parsed;
    }

    return Math.round(parsed * multiplier);
  }

  return null;
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const entries = Object.entries(metadata).slice(0, 50);

  return entries.reduce((result, [key, value]) => {
    if (!key) {
      return result;
    }

    const normalizedKey = String(key).slice(0, 40);

    if (value === null || value === undefined) {
      return result;
    }

    if (typeof value === "object") {
      result[normalizedKey] = JSON.stringify(value).slice(0, 500);
      return result;
    }

    result[normalizedKey] = String(value).slice(0, 500);
    return result;
  }, {});
}

function normalizeStripeCustomerId(customerId) {
  if (!customerId) {
    return null;
  }

  const normalizedCustomerId = String(customerId).trim();
  if (!normalizedCustomerId.startsWith("cus_")) {
    return null;
  }

  return normalizedCustomerId;
}

function extractPaymentIntentId(value) {
  if (!value) {
    return "";
  }

  const rawValue = String(value).trim();
  if (!rawValue) {
    return "";
  }

  if (rawValue.startsWith("pi_") && rawValue.includes("_secret_")) {
    return rawValue.split("_secret_")[0];
  }

  if (rawValue.startsWith("pi_")) {
    return rawValue;
  }

  return "";
}

function toAppPaymentStatus(stripeStatus) {
  if (stripeStatus === "succeeded") {
    return "COMPLETED";
  }
  if (stripeStatus === "processing" || stripeStatus === "requires_capture") {
    return "PROCESSING";
  }
  if (stripeStatus === "canceled") {
    return "FAILED";
  }
  return "PENDING";
}

function isSuccessfulStripeStatus(stripeStatus) {
  return ["succeeded", "processing", "requires_capture"].includes(stripeStatus);
}

let firebaseAdmin = null;
let firestoreDb = undefined;

function resolveFirebaseServiceAccount() {
  if (FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (error) {
      console.error("FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON");
      return null;
    }
  }

  const candidatePaths = [
    GOOGLE_APPLICATION_CREDENTIALS,
    path.join(process.cwd(), "firebase-service-account.json")
  ].filter(Boolean);

  for (const candidatePath of candidatePaths) {
    try {
      if (fs.existsSync(candidatePath)) {
        const fileContent = fs.readFileSync(candidatePath, "utf8");
        return JSON.parse(fileContent);
      }
    } catch (error) {
      console.error(`Failed to read Firebase credentials from ${candidatePath}: ${error.message}`);
    }
  }

  return null;
}

function getFirestore() {
  if (firestoreDb !== undefined) {
    return firestoreDb;
  }

  try {
    firebaseAdmin = require("firebase-admin");
  } catch (error) {
    console.warn("firebase-admin dependency is not installed. Booking sync disabled.");
    firestoreDb = null;
    return firestoreDb;
  }

  try {
    if (!firebaseAdmin.apps.length) {
      const serviceAccount = resolveFirebaseServiceAccount();
      if (!serviceAccount) {
        console.warn("Firebase credentials are missing. Booking sync disabled.");
        firestoreDb = null;
        return firestoreDb;
      }

      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID || serviceAccount.project_id
      });
    }

    firestoreDb = firebaseAdmin.firestore();
    return firestoreDb;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin", error.message);
    firestoreDb = null;
    return firestoreDb;
  }
}

async function syncPaymentToFirestore({
  bookingId,
  paymentId,
  paymentIntentId,
  amount,
  currency,
  method,
  customerId,
  providerId,
  paymentStatus,
  bookingStatus
}) {
  if (!bookingId) {
    return {
      updated: false,
      reason: "Missing bookingId"
    };
  }

  const db = getFirestore();
  if (!db || !firebaseAdmin) {
    return {
      updated: false,
      reason: "Firestore is not configured"
    };
  }

  const timestamp = firebaseAdmin.firestore.FieldValue.serverTimestamp();
  const safePaymentId = paymentId || paymentIntentId || `pay_${Date.now()}`;

  const bookingUpdate = {
    status: bookingStatus,
    bookingStatus,
    paymentStatus,
    paymentMethod: method,
    paymentId: safePaymentId,
    paymentIntentId: paymentIntentId || "",
    updatedAt: timestamp,
    paidAt: timestamp
  };

  if (customerId) {
    bookingUpdate.customerId = customerId;
  }
  if (providerId) {
    bookingUpdate.providerId = providerId;
  }

  const paymentRecord = {
    id: safePaymentId,
    bookingId,
    customerId: customerId || "",
    providerId: providerId || "",
    amount: Number(amount) || 0,
    currency: String(currency || "lkr").toUpperCase(),
    paymentMethod: method,
    status: paymentStatus,
    transactionId: paymentIntentId || safePaymentId,
    processedAt: Date.now(),
    updatedAt: timestamp,
    createdAt: timestamp
  };

  await db.collection("bookings").doc(String(bookingId)).set(bookingUpdate, { merge: true });
  await db.collection("payments").doc(String(safePaymentId)).set(paymentRecord, { merge: true });

  return {
    updated: true,
    paymentId: safePaymentId
  };
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
  const firestoreReady = Boolean(getFirestore());

  res.status(200).json({
    status: "OK",
    message: "FixMate Payment Backend is running",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
    firestore: firestoreReady ? "connected" : "not-configured"
  });
});

app.get("/api/payments/config", (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({
      error: "STRIPE_PUBLISHABLE_KEY is not configured",
      publishableKey: "",
      publishable_key: ""
    });
  }

  return res.status(200).json({
    publishableKey: STRIPE_PUBLISHABLE_KEY,
    publishable_key: STRIPE_PUBLISHABLE_KEY
  });
});

app.post("/api/payments/create-intent", async (req, res) => {
  try {
    const {
      amount,
      currency = "lkr",
      metadata = {},
      customerId,
      providerId,
      bookingId
    } = req.body || {};
    
    // Validate that amount is provided
    if (amount === null || amount === undefined || amount === "") {
      return res.status(400).json({
        success: false,
        error: "Invalid payment request. Please check booking details and try again.",
        message: "Amount is required",
        paymentStatus: "FAILED",
        bookingStatus: "PAYMENT_PENDING"
      });
    }

    const normalizedCurrency = String(currency).toLowerCase();
    const normalizedAmount = normalizeAmount(amount, normalizedCurrency);
    const normalizedMetadata = normalizeMetadata(metadata);
    const normalizedCustomerId = normalizeStripeCustomerId(customerId);

    if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment request. Please check booking details and try again.",
        message: "Invalid amount. Send a positive amount like 1500, 15.00, or LKR 51,000.00.",
        paymentStatus: "FAILED",
        bookingStatus: "PAYMENT_PENDING"
      });
    }

    const metadataWithBooking = {
      ...normalizedMetadata,
      bookingId: bookingId || normalizedMetadata.bookingId || "",
      customerId: customerId || normalizedMetadata.customerId || "",
      providerId: providerId || normalizedMetadata.providerId || ""
    };

    const params = {
      amount: normalizedAmount,
      currency: normalizedCurrency,
      automatic_payment_methods: { enabled: true },
      metadata: normalizeMetadata(metadataWithBooking)
    };

    if (normalizedCustomerId) {
      params.customer = normalizedCustomerId;
    }

    const intent = await stripe.paymentIntents.create(params);
    const clientSecret = intent.client_secret || "";
    const paymentIntentId = intent.id || "";
    const publishableKey = STRIPE_PUBLISHABLE_KEY || "";

    return res.status(201).json({
      success: true,
      message: "Payment intent created successfully",
      paymentIntentId,
      payment_intent_id: paymentIntentId,
      clientSecret,
      client_secret: clientSecret,
      status: intent.status,
      paymentStatus: toAppPaymentStatus(intent.status),
      bookingStatus: "PAYMENT_PENDING",
      bookingId: bookingId || "",
      publishableKey,
      publishable_key: publishableKey
    });
  } catch (error) {
    console.error("Failed to create payment intent", {
      type: error.type,
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      amount: amount,
      currency: currency,
      bookingId: bookingId
    });

    const statusCode =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error: "Invalid payment request. Please check booking details and try again.",
      message: error.message || "Failed to create payment intent",
      code: error.code || null,
      type: error.type || null,
      paymentStatus: "FAILED",
      bookingStatus: "PAYMENT_PENDING",
      clientSecret: "",
      client_secret: "",
      publishableKey: STRIPE_PUBLISHABLE_KEY || "",
      publishable_key: STRIPE_PUBLISHABLE_KEY || ""
    });
  }
});

app.post("/api/payments/confirm", async (req, res) => {
  try {
    const {
      paymentIntentId,
      payment_intent_id,
      clientSecret,
      client_secret,
      paymentMethodId,
      bookingId,
      customerId,
      providerId
    } = req.body || {};
    
    const resolvedPaymentIntentId =
      extractPaymentIntentId(paymentIntentId) ||
      extractPaymentIntentId(payment_intent_id) ||
      extractPaymentIntentId(clientSecret) ||
      extractPaymentIntentId(client_secret);

    if (!resolvedPaymentIntentId) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment request. Please check booking details and try again.",
        message: "paymentIntentId or clientSecret is required",
        paymentIntentId: "",
        payment_intent_id: "",
        paymentStatus: "FAILED",
        bookingStatus: "PAYMENT_PENDING",
        bookingId: bookingId || "",
        status: ""
      });
    }

    const existingIntent = await stripe.paymentIntents.retrieve(String(resolvedPaymentIntentId));

    if (isSuccessfulStripeStatus(existingIntent.status)) {
      const mappedPaymentStatus = toAppPaymentStatus(existingIntent.status);
      const resolvedBookingId = bookingId || existingIntent.metadata.bookingId || "";
      const resolvedCustomerId = customerId || existingIntent.metadata.customerId || "";
      const resolvedProviderId = providerId || existingIntent.metadata.providerId || "";
      const syncResult = await syncPaymentToFirestore({
        bookingId: resolvedBookingId,
        paymentId: existingIntent.id,
        paymentIntentId: existingIntent.id,
        amount: existingIntent.amount,
        currency: existingIntent.currency,
        method: "STRIPE_CARD",
        customerId: resolvedCustomerId,
        providerId: resolvedProviderId,
        paymentStatus: mappedPaymentStatus,
        bookingStatus: "COMPLETED"
      });

      return res.status(200).json({
        success: true,
        message: "Payment confirmed successfully",
        paymentIntentId: existingIntent.id || "",
        payment_intent_id: existingIntent.id || "",
        status: existingIntent.status || "",
        paymentStatus: mappedPaymentStatus,
        bookingStatus: "COMPLETED",
        bookingId: resolvedBookingId,
        clientSecret: existingIntent.client_secret || "",
        client_secret: existingIntent.client_secret || "",
        syncedToDatabase: syncResult.updated,
        syncReason: syncResult.reason || ""
      });
    }

    const params = {};
    if (paymentMethodId) {
      params.payment_method = String(paymentMethodId);
    }

    if (existingIntent.status === "requires_confirmation") {
      const intent = await stripe.paymentIntents.confirm(String(resolvedPaymentIntentId), params);
      const confirmedSuccessfully = isSuccessfulStripeStatus(intent.status);
      const mappedPaymentStatus = toAppPaymentStatus(intent.status);
      const resolvedBookingId = bookingId || intent.metadata.bookingId || "";
      const resolvedCustomerId = customerId || intent.metadata.customerId || "";
      const resolvedProviderId = providerId || intent.metadata.providerId || "";
      const syncResult = confirmedSuccessfully
        ? await syncPaymentToFirestore({
          bookingId: resolvedBookingId,
          paymentId: intent.id,
          paymentIntentId: intent.id,
          amount: intent.amount,
          currency: intent.currency,
          method: "STRIPE_CARD",
          customerId: resolvedCustomerId,
          providerId: resolvedProviderId,
          paymentStatus: mappedPaymentStatus,
          bookingStatus: "COMPLETED"
        })
        : { updated: false, reason: "Payment is not in a completed state" };

      return res.status(200).json({
        success: confirmedSuccessfully,
        message: confirmedSuccessfully
          ? "Payment confirmed successfully"
          : "Payment confirmation requires additional action",
        paymentIntentId: intent.id || "",
        payment_intent_id: intent.id || "",
        status: intent.status || "",
        paymentStatus: mappedPaymentStatus,
        bookingStatus: confirmedSuccessfully ? "COMPLETED" : "PAYMENT_PENDING",
        bookingId: resolvedBookingId,
        clientSecret: intent.client_secret || "",
        client_secret: intent.client_secret || "",
        syncedToDatabase: syncResult.updated,
        syncReason: syncResult.reason || ""
      });
    }

    return res.status(400).json({
      success: false,
      error: "Payment intent is not ready for confirmation",
      message: "Payment intent is not ready for confirmation",
      paymentIntentId: existingIntent.id || "",
      payment_intent_id: existingIntent.id || "",
      paymentStatus: toAppPaymentStatus(existingIntent.status),
      bookingStatus: "PAYMENT_PENDING",
      bookingId: bookingId || "",
      status: existingIntent.status || "",
      clientSecret: existingIntent.client_secret || "",
      client_secret: existingIntent.client_secret || ""
    });
  } catch (error) {
    const statusCode =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;

    console.error("Failed to confirm payment", {
      type: error.type,
      code: error.code,
      message: error.message,
      statusCode: statusCode
    });

    return res.status(statusCode).json({
      success: false,
      error: "Invalid payment request. Please check booking details and try again.",
      message: error.message || "Unknown confirmation error",
      code: error.code || null,
      type: error.type || null,
      paymentIntentId: "",
      payment_intent_id: "",
      paymentStatus: "FAILED",
      bookingStatus: "PAYMENT_PENDING",
      status: ""
    });
  }
});

app.post("/api/payments/cash", (req, res) => {
  const { amount, currency = "usd", jobId, bookingId, customerId, providerId, note = "" } = req.body || {};
  const normalizedCurrency = String(currency).toLowerCase();
  const normalizedAmount = normalizeAmount(amount, normalizedCurrency);

  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid amount. Send positive number (minor units or decimal major units).",
      message: "Invalid amount",
      paymentStatus: "FAILED",
      bookingStatus: "PAYMENT_PENDING"
    });
  }

  const cashPaymentId = `cash_${Date.now()}`;

  syncPaymentToFirestore({
    bookingId: bookingId || "",
    paymentId: cashPaymentId,
    paymentIntentId: "",
    amount: normalizedAmount,
    currency: normalizedCurrency,
    method: "CASH",
    customerId: customerId || "",
    providerId: providerId || "",
    paymentStatus: "COMPLETED",
    bookingStatus: "COMPLETED"
  })
    .then((syncResult) => {
      return res.status(201).json({
        success: true,
        message: "Cash payment recorded successfully",
        paymentId: cashPaymentId,
        payment_id: cashPaymentId,
        paymentStatus: "COMPLETED",
        bookingStatus: "COMPLETED",
        bookingId: bookingId || "",
        method: "cash",
        status: "pending_collection",
        amount: normalizedAmount,
        currency: normalizedCurrency,
        jobId: jobId || null,
        customerId: customerId || null,
        note: String(note),
        syncedToDatabase: syncResult.updated,
        syncReason: syncResult.reason || ""
      });
    })
    .catch((error) => {
      return res.status(500).json({
        success: false,
        error: "Failed to sync cash payment",
        message: error.message || "Failed to sync cash payment",
        paymentStatus: "FAILED",
        bookingStatus: "PAYMENT_PENDING"
      });
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
