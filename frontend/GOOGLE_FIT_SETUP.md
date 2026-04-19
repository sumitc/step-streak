# Google Fit Authentication Setup

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Create a **new project**:
   - Click project selector (top left)
   - Click **NEW PROJECT**
   - Name it "Step Streak"
   - Click **CREATE**

## Step 2: Enable Google Fit API

1. In Google Cloud Console, search for **"Fitness API"**
2. Click **Google Fit API**
3. Click **ENABLE**
4. Wait for activation (30 seconds)

## Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. You may be prompted to **Configure OAuth consent screen first**:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in required fields:
     - App name: "Step Streak"
     - User support email: your email
     - Developer contact: your email
   - Click **SAVE AND CONTINUE**
   - Skip scopes, click **SAVE AND CONTINUE**
   - Click **BACK TO DASHBOARD**

4. Now create OAuth credentials:
   - Click **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Application type: **Web application**
   - Name: "Step Streak Web"
   - Add Authorized JavaScript origins:
     - `http://localhost:4000`
     - `http://localhost:3000`
   - Add Authorized redirect URIs:
     - `http://localhost:4000`
     - `http://localhost:3000`
   - Click **CREATE**

5. Copy your **Client ID** (looks like: `123456789-abc.apps.googleusercontent.com`)

## Step 4: Add Client ID to Your App

Create a `.env` file in `/Users/sumitc/projects/step-streak-app/`:

```
REACT_APP_GOOGLE_FIT_CLIENT_ID=your_client_id_here
```

Replace `your_client_id_here` with the Client ID you copied above.

## Step 5: Restart Dev Server

```bash
cd /Users/sumitc/projects/step-streak-app
npm run dev
```

## Step 6: Test Google Fit Sign-In

1. Open `http://localhost:4000`
2. Click the **"Sign in with Google Fit"** button
3. Log in with your Google account
4. Grant permissions to access step data
5. Your steps for today should sync automatically!

## Troubleshooting

**"Sign in with Google Fit" button disabled:**
- Make sure `.env` file exists and contains `REACT_APP_GOOGLE_FIT_CLIENT_ID`
- Restart dev server after creating `.env`

**"Failed to sign in":**
- Check that `http://localhost:4000` is in Authorized JavaScript origins
- Check that Client ID is correct in `.env`

**Steps not syncing:**
- Make sure you have Google Fit app installed on your phone (if using Android)
- Your phone must have synced data to Google Fit
- Web version can't access real-time phone data without additional setup

**Redirect URI mismatch error:**
- Make sure exact URIs match in Google Cloud Console
- Include the port number (`localhost:4000`)

## For Production (Android APK)

When deploying as APK, you'll need:
1. SHA-1 certificate fingerprint of your signing key
2. Add to Google Cloud Console under Android restrictions
3. Update `capacitor.config.json` with your app ID: `com.yourcompany.stepstreak`

See `APK_DEPLOYMENT_GUIDE.md` for more details.
