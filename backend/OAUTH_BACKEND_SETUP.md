# OAuth Backend Setup

## Overview

The backend handles Google OAuth securely:
1. Stores client credentials (never exposed to frontend)
2. Exchanges authorization codes for access/refresh tokens
3. Extracts the user's real Google ID (`sub`) from the `id_token` — no `default_user` hardcoding
4. Persists tokens to Upstash Redis so logins survive Render restarts
5. Lazy-loads tokens per user on first request — no startup pre-loading needed
6. Proxies all Google Fit API requests

---

## Environment Variables

### Local development — `backend/.env`

```
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:5001/auth/callback
PORT=5001
FRONTEND_URL=http://localhost:4000
```

### Render (production) — set in Render → your backend service → Environment

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `REDIRECT_URI` | `https://step-streak-backend.onrender.com/auth/callback` |
| `FRONTEND_URL` | `https://step-streak.onrender.com` |
| `UPSTASH_REDIS_REST_URL` | From [upstash.com](https://upstash.com) — free tier |
| `UPSTASH_REDIS_REST_TOKEN` | From [upstash.com](https://upstash.com) — free tier |

> **Why Upstash?** Render's free tier has an ephemeral filesystem — `tokens.json` is wiped on every restart. Upstash persists OAuth tokens across restarts so users never have to re-login. The browser stores the `userId` (Google `sub`); on backend restart, the first API request triggers a lazy Redis load for that userId.

---

## Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Edit your OAuth 2.0 Client (Web application)
3. Add **Authorized Redirect URIs**:
   - `http://localhost:5001/auth/callback` (local dev)
   - `https://step-streak-backend.onrender.com/auth/callback` (production)
4. Ensure these scopes are enabled in OAuth consent screen:
   - `openid` (required — gives `id_token` with user's `sub`)
   - `https://www.googleapis.com/auth/fitness.activity.read`

---

## Running Locally

```bash
# Terminal 1 — Backend
cd /Users/sumitc/projects/step-streak/backend
npm start
# Runs on http://localhost:5001

# Terminal 2 — Frontend
cd /Users/sumitc/projects/step-streak/frontend
npm start
# Runs on http://localhost:4000
```

---

## API Endpoints

### `GET /auth/login`
Returns Google OAuth URL to redirect the user to.

### `GET /auth/callback`
OAuth redirect target. Exchanges code → tokens, extracts `sub` from `id_token`, saves to Redis. Redirects browser to frontend with `?auth=success&userId=<sub>`.

### `GET /auth/status?userId=<id>`
Returns `{ authenticated: true/false }`. Lazy-loads from Redis if not in memory.

### `POST /api/steps`
Fetch steps for one date. Body: `{ userId, date, timezone }`.

### `POST /api/steps/batch`
Fetch steps for multiple dates. Body: `{ userId, dates[], timezone }`.

### `GET /auth/export-token?userId=<id>`
Returns the stored refresh token (useful as manual backup).

### `DELETE /auth/reset?userId=<id>`
Clears tokens for a specific user (omit `userId` to reset all). Useful for testing fresh login.

```bash
# Reset a specific user
curl -X DELETE "http://localhost:5001/auth/reset?userId=default_user"

# Full reset (all users)
curl -X DELETE "http://localhost:5001/auth/reset"
```

---

## Token Persistence — How It Works

**On login:**
1. Google returns `access_token` + `refresh_token` + `id_token`
2. Backend decodes `id_token` → extracts `sub` (e.g. `109234567890`)
3. Tokens stored in memory + `tokens.json` + Upstash Redis under key `tokens:109234567890`
4. Browser stores `userId=109234567890` in localStorage

**On Render restart (cold start):**
1. Memory and `tokens.json` are empty
2. Browser's first request includes `userId=109234567890`
3. Backend calls `getTokensForUser()` → lazy-loads from Redis
4. Request succeeds — user never sees a re-login prompt ✅

**Bootstrap priority at startup** (for backward compat):
1. `tokens.json` (local dev)
2. Upstash Redis (production)
3. `GOOGLE_REFRESH_TOKEN` env var (manual fallback, legacy)

---

## Troubleshooting

**"No Upstash configured" in logs:**
Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Render environment variables (see table above). After deploy, log in once — tokens will be saved to Redis automatically.

**"Not authenticated" after Render restart:**
Upstash is not configured or the `userId` in the browser doesn't match what's in Redis. Run the reset endpoint and log in fresh.

**"Redirect URI mismatch":**
Ensure `REDIRECT_URI` in Render env exactly matches one of the URIs registered in Google Cloud Console.

**Steps differ from Google Fit app:**
The backend queries two sources in parallel and returns the maximum:
- `estimated_steps` (Google's deduplicated cross-source estimate)
- Default aggregate (fallback)
This should match what the Google Fit app shows.

