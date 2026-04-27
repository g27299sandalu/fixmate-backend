# 🚀 QUICK FIX CHECKLIST - Payment Backend Setup

## ⚠️ THE PROBLEM
Your Stripe key `mk_1SdSekKSL3YUt4e6eC5OGeCm` is **WRONG TYPE**!
- `mk_` = Restricted key ❌
- You need `sk_test_` = Secret key ✅

---

## ✅ 3 STEPS TO FIX (5 minutes)

### STEP 1: Get Correct Stripe Keys (2 min)

1. Go to: https://dashboard.stripe.com/test/apikeys
2. Find these TWO keys:
   ```
   Publishable key: pk_test_51... (visible)
   Secret key: sk_test_51... (click "Reveal test key")
   ```
3. **Copy both keys** - you'll paste them in Step 2

---

### STEP 2: Add Keys to Railway (2 min)

1. Go to: https://railway.app/dashboard
2. Open project: `magnificent-fulfillment-firebaseserviceaccount`
3. Click **Variables** tab
4. Click **+ New Variable** and add:

   **Variable 1:**
   ```
   Name: STRIPE_SECRET_KEY
   Value: [paste your sk_test_... key here]
   ```

   **Variable 2:**
   ```
   Name: STRIPE_PUBLISHABLE_KEY  
   Value: [paste your pk_test_... key here]
   ```

   **Variable 3:** (if not already set)
   ```
   Name: FIREBASE_SERVICE_ACCOUNT
   Value: [paste your Firebase JSON - see below]
   ```

5. Click **Deploy** button

---

### STEP 3: Get Firebase JSON (1 min) - Skip if already set

Only needed if Variable 3 above is not set:

1. Go to: https://console.firebase.google.com
2. Select your FixMate project
3. ⚙️ Settings → **Service accounts** → **Generate new private key**
4. Open downloaded JSON file
5. Copy ENTIRE contents
6. Go to: https://jsonformatter.org/json-minify
7. Paste JSON → Click "Minify" → Copy result
8. Use this as Variable 3 value above

---

## ✅ VERIFY IT WORKS

After Railway redeploys (1-2 minutes):

**Test 1: Browser**
```
https://magnificent-fulfillment-firebaseserviceaccount.up.railway.app/health
```
Should show: `{"status":"OK"...}`

**Test 2: Android App**
1. Open FixMate app
2. Try to make a payment
3. Should now connect successfully!

---

## 📊 Check Railway Deployment Status

1. Railway Dashboard → Your Service → **Deployments** tab
2. Latest deployment should show: ✅ Success
3. Click **Logs** to see: `✅ FixMate Payment Backend running on port...`

---

## ❓ Still Not Working?

**Error: "Payment service not found"**
- Wait 2 minutes for Railway to finish deploying
- Check Deployments tab shows green checkmark
- Test `/health` endpoint in browser

**Error: "Invalid API key"**  
- Make sure you used `sk_test_` key, NOT `mk_` or `rk_`
- Verify key is copied completely (usually 100+ characters)
- Check no extra spaces before/after the key

**Error: "Firebase error"**
- Make sure Firebase JSON is ONE LINE (use jsonformatter.org)
- Verify JSON is valid (paste in jsonlint.com)
- Re-download from Firebase if needed

---

## 📝 Summary

✅ Backend code is updated and pushed to GitHub  
✅ Railway will auto-deploy from GitHub  
⏳ **YOU NEED TO**: Add the 3 environment variables in Railway  
⏳ **MUST USE**: Correct Stripe keys (sk_test_ and pk_test_)  

**Time to fix**: 5 minutes  
**Cost**: $0 (Railway free tier)  

---

## 🎯 After This Works

Once payment works in test mode:

1. **For Production**:
   - Get live Stripe keys (sk_live_ and pk_live_)
   - Update Railway variables with live keys
   - Test with small real payment first

2. **Monitor**:
   - Railway Dashboard → Logs (see all requests)
   - Stripe Dashboard → Payments (see transactions)

---

**Need the detailed guide?** See `RAILWAY_SETUP.md` in your backend folder!

Good luck! 🚀
