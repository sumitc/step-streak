# OAuth Backend Setup

## Overview
The backend server handles Google OAuth securely by:
1. Storing the client secret (never exposed to frontend)
2. Exchanging authorization codes for access tokens
3. Managing token refresh
4. Proxying Google Fit API requests

## Step 1: Update Google Cloud Console

Your OAuth credentials need new settings:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. APIs & Services → Credentials
3. Edit your OAuth 2.0 Client (Web application)
4. Add **Authorized Redirect URIs**:
   - `http://localhost:5000/auth/callback`
   - `http://localhost:4000/auth/callback` (for direct frontend testing)
5. Copy your **Client Secret** (new!)

## Step 2: Configure Backend .env

Create `.env` file in `/Users/sumitc/projects/step-streak-backend/`:

```
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
REDIRECT_URI=http://localhost:5000/auth/callback
PORT=5000
```

Replace with your actual credentials from Google Cloud Console.

## Step 3: Start Backend Server

```bash
cd /Users/sumitc/projects/step-streak-backend
npm start
```

Server will start on `http://localhost:5000`

## Step 4: Update Frontend

The frontend now calls the backend instead of Google directly:

- Click "Sync with Google Fit"
- Redirects to: `http://localhost:5000/auth/login`
- You log in with Google
- Backend stores tokens securely
- Returns step data to frontend

## Backend Endpoints

### POST /auth/login
Returns Google OAuth URL
```bash
curl http://localhost:5000/auth/login
```

### POST /auth/callback
Exchange authorization code for tokens
```bash
curl -X POST http://localhost:5000/auth/callback \
  -H "Content-Type: application/json" \
  -d '{"code":"auth_code_here"}'
```

### POST /api/steps
Get steps for a date (requires authentication)
```bash
curl -X POST http://localhost:5000/api/steps \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-04-18","userId":"user1"}'
```

## Running Both Servers

**Terminal 1 - Frontend:**
```bash
cd /Users/sumitc/projects/step-streak-app
npm run dev
# Opens http://localhost:4000
```

**Terminal 2 - Backend:**
```bash
cd /Users/sumitc/projects/step-streak-backend
npm start
# Runs http://localhost:5000
```

## Testing

1. Open http://localhost:4000
2. Click "Sync with Google Fit"
3. You'll be redirected to Google login
4. Grant permissions
5. Steps sync automatically!

## Production Deployment

When deploying:
1. Update `REDIRECT_URI` to your production domain
2. Store credentials in environment variables
3. Use a proper session/token store (Redis, DB) instead of memory
4. Enable HTTPS
5. Use secure cookie flags

## Troubleshooting

**"Not authenticated" error:**
- Make sure backend is running
- Check Client ID/Secret in .env

**"Redirect URI mismatch":**
- Ensure `REDIRECT_URI` matches Google Cloud Console settings
- Restart backend after changing .env

**Tokens not persisting:**
- Current implementation uses in-memory storage
- For production, implement database persistence
