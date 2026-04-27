# Railway Deployment Setup for FixMate Payment Backend

## ⚠️ IMPORTANT: Your Stripe Key Issue

The key you provided (`mk_1SdSekKSL3YUt4e6eC5OGeCm`) is **NOT** a valid Stripe secret key.

- ❌ `mk_` prefix = Restricted API key (limited permissions)
- ✅ You need keys starting with:
  - `sk_test_` = Secret key for testing
  - `pk_test_` = Publishable key for testing

## 🔑 Step 1: Get Correct Stripe API Keys

1. Go to: https://dashboard.stripe.com/test/apikeys
2. You'll see TWO keys:

   **Publishable key** (safe to use in apps)
   ```
   pk_test_51QRkvyKSL3YUt4e6...  (starts with pk_test_)
   ```

   **Secret key** (NEVER share publicly - only on backend)
   ```
   sk_test_51QRkvyKSL3YUt4e6...  (starts with sk_test_)
   ```

3. Click "Reveal test key" to see the full secret key
4. Copy BOTH keys - you'll need them for Railway

---

## 🚂 Step 2: Set Environment Variables in Railway

### Option A: Via Railway Dashboard (Recommended)

1. Go to https://railway.app
2. Open your project: `magnificent-fulfillment-firebaseserviceaccount`
3. Click on your service
4. Go to **Variables** tab
5. Click **+ New Variable** for each:

#### Add These 3 Variables:

**Variable 1: STRIPE_SECRET_KEY**
```
Name: STRIPE_SECRET_KEY
Value: sk_test_51QRkvyKSL3YUt4e6... (paste your actual secret key)
```

**Variable 2: STRIPE_PUBLISHABLE_KEY**
```
Name: STRIPE_PUBLISHABLE_KEY
Value: pk_test_51QRkvyKSL3YUt4e6... (paste your actual publishable key)
```

**Variable 3: FIREBASE_SERVICE_ACCOUNT**
```
Name: FIREBASE_SERVICE_ACCOUNT
Value: (see Step 3 below for how to get this)
```

6. Click **Deploy** after adding all variables

---

## 🔥 Step 3: Get Firebase Service Account JSON

### 3.1 Download from Firebase Console

1. Go to: https://console.firebase.google.com
2. Select your FixMate project
3. Click the **gear icon ⚙️** → **Project settings**
4. Go to **Service accounts** tab
5. Click **Generate new private key**
6. Click **Generate key** (downloads a JSON file)

### 3.2 Convert JSON to Single Line for Railway

The downloaded file looks like this (formatted):
```json
{
  "type": "service_account",
  "project_id": "fixmate-12345",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nXXXXX...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@fixmate-12345.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40fixmate-12345.iam.gserviceaccount.com"
}
```

**Convert to ONE LINE** (remove all line breaks):
```json
{"type":"service_account","project_id":"fixmate-12345","private_key_id":"abc123...","private_key":"-----BEGIN PRIVATE KEY-----\nXXXXX...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xxxxx@fixmate-12345.iam.gserviceaccount.com","client_id":"123456789","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40fixmate-12345.iam.gserviceaccount.com"}
```

### 3.3 Tools to Convert to Single Line

**Method 1: Online Tool**
1. Go to: https://jsonformatter.org/json-minify
2. Paste your Firebase JSON
3. Click "Minify JSON"
4. Copy the result

**Method 2: VS Code**
1. Open the downloaded JSON file
2. Press `Ctrl+A` to select all
3. Press `Ctrl+H` to find and replace
4. Find: `\n` (with regex enabled)
5. Replace with: (nothing)
6. Copy the result

**Method 3: Command Line**
```bash
# On Windows PowerShell
Get-Content firebase-service-account.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress
```

---

## 🚀 Step 4: Redeploy on Railway

After adding all environment variables:

1. Railway will **auto-deploy** when you save variables
2. Or click **Deploy** manually
3. Wait 1-2 minutes for deployment

### Check Deployment Status:
1. Go to **Deployments** tab
2. Watch the build logs
3. Should see: `✅ FixMate Payment Backend running on port XXXX`

---

## ✅ Step 5: Test Your Backend

### Test 1: Health Check

Open in browser:
```
https://magnificent-fulfillment-firebaseserviceaccount.up.railway.app/health
```

Should return:
```json
{
  "status": "OK",
  "message": "FixMate Payment Backend is running",
  "timestamp": "2025-12-15T10:30:00.000Z"
}
```

### Test 2: From Android App

1. Your Android app is already configured with the Railway URL ✅
2. Open app and try to make a payment
3. Check Railway logs for requests:
   - Go to Railway Dashboard
   - Click your service
   - Click **Logs** tab
   - Watch for incoming requests

---

## 📋 Summary Checklist

Before testing payment:

- [ ] Got correct Stripe secret key (starts with `sk_test_`)
- [ ] Got correct Stripe publishable key (starts with `pk_test_`)
- [ ] Downloaded Firebase service account JSON
- [ ] Converted Firebase JSON to single line (no line breaks)
- [ ] Added `STRIPE_SECRET_KEY` to Railway variables
- [ ] Added `STRIPE_PUBLISHABLE_KEY` to Railway variables
- [ ] Added `FIREBASE_SERVICE_ACCOUNT` to Railway variables
- [ ] Railway deployment succeeded
- [ ] `/health` endpoint returns OK
- [ ] Android app shows no connection errors

---

## 🐛 Common Issues

### Issue 1: "Payment service not found"
**Cause**: Backend not running or wrong URL  
**Fix**:
- Check Railway deployment status
- Verify URL in Android app matches Railway URL
- Test `/health` endpoint in browser

### Issue 2: "Invalid API key"
**Cause**: Wrong Stripe key or not set in Railway  
**Fix**:
- Use `sk_test_` key, not `mk_` or `rk_`
- Verify key is set in Railway variables
- Redeploy after setting variables

### Issue 3: "Firebase initialization error"
**Cause**: Invalid or malformed JSON  
**Fix**:
- Ensure JSON is ONE LINE (no line breaks except in `private_key` field)
- Validate JSON at https://jsonlint.com
- Re-download from Firebase if needed

### Issue 4: "CORS error" in app
**Cause**: Railway URL not in CORS whitelist  
**Fix**: Already handled - CORS is set to allow all origins in backend

---

## 📞 Getting Help

If you still see "Payment service not found":

1. **Check Railway Logs**:
   - Railway Dashboard → Your Service → Logs
   - Look for errors during startup

2. **Check Android Logs** (Logcat):
   - Filter by "Payment" or "HTTP"
   - Look for detailed error messages

3. **Verify Environment Variables**:
   - Railway Dashboard → Your Service → Variables
   - Make sure all 3 variables are set
   - Keys should NOT have quotes around them

---

## 🎯 What the Backend Does Now

After this update, your backend has these working endpoints:

1. **GET `/health`** - Check if backend is running
2. **POST `/api/payments/create-intent`** - Create Stripe payment
3. **POST `/api/payments/confirm`** - Confirm card payment
4. **POST `/api/payments/cash`** - Process cash payment

These match exactly what your Android app expects! 🎉

---

## 🔐 Security Note

⚠️ **NEVER commit `.env` file to Git!**

The `.env` file should be in your `.gitignore`. Railway uses its own environment variables system, so you don't need to deploy the `.env` file.

In Railway:
- Variables are encrypted
- Only accessible to your service
- Not visible in Git repository

---

**Next Step**: Follow Step 1 to get your correct Stripe keys, then add all 3 environment variables to Railway! 🚀
