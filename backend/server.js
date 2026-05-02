const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4000';

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    // Allow configured frontend and common dev origins
    const allowed = [FRONTEND_URL, 'http://localhost:4000', 'http://localhost:3000'];
    if (allowed.includes(origin) || origin.match(/^http:\/\/192\.168\.\d+\.\d+:\d+$/)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:5001/auth/callback';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  console.error('See OAUTH_BACKEND_SETUP.md for configuration');
}

// --- Token persistence ---
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

// ── Upstash Redis helpers (optional) ──────────────────────────────────────────
// If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set in the env,
// tokens are saved to Redis after every OAuth / token refresh and reloaded on
// every server restart — fully automatic, no manual copy-paste needed.
const UPSTASH_URL  = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_AUTH = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSave(userId, tokens) {
  if (!UPSTASH_URL || !UPSTASH_AUTH) return;
  const key = `tokens:${userId}`;
  const val = encodeURIComponent(JSON.stringify(tokens));
  try {
    const r = await axios.get(`${UPSTASH_URL}/set/${key}/${val}`, {
      headers: { Authorization: `Bearer ${UPSTASH_AUTH}` },
    });
    if (r.data?.result !== 'OK') console.warn('[redis] unexpected SET result:', r.data);
    else console.log(`[redis] tokens saved for ${userId}`);
  } catch (err) {
    console.warn('[redis] save failed:', err.message);
  }
}

async function redisLoad(userId) {
  if (!UPSTASH_URL || !UPSTASH_AUTH) return null;
  const key = `tokens:${userId}`;
  try {
    const r = await axios.get(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_AUTH}` },
    });
    const raw = r.data?.result;
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('[redis] load failed:', err.message);
    return null;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Decode a Google id_token (JWT) and return the `sub` claim (permanent Google user ID).
// No signature verification needed — we just received this token directly from Google's servers.
function decodeIdToken(idToken) {
  try {
    const b64 = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return payload.sub || null;
  } catch {
    return null;
  }
}

// Lazy-load tokens for a userId: memory first, then Redis.
// This means the backend doesn't need to pre-load anything on startup — the
// userId coming in from the browser's first request is enough to hydrate state.
async function getTokensForUser(userId) {
  if (userTokens[userId]) return userTokens[userId];
  const saved = await redisLoad(userId);
  if (saved) {
    userTokens[userId] = saved;
    console.log(`[auth] lazy-loaded tokens for ${userId} from Redis`);
  }
  return userTokens[userId] || null;
}

function loadTokensFromFile() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('⚠️  Failed to load tokens.json:', err.message);
  }
  return {};
}

function saveTokens() {
  try {
    const tmp = TOKENS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(userTokens, null, 2));
    fs.renameSync(tmp, TOKENS_FILE); // atomic write
  } catch (err) {
    console.error('⚠️  Failed to save tokens.json:', err.message);
  }
}

const userTokens = loadTokensFromFile();

// Bootstrap priority (async — runs before server starts listening):
//   1. tokens.json (local dev, or Render with a persistent disk)
//   2. Upstash Redis (preferred for Render free tier — add 2 env vars, done)
//   3. GOOGLE_REFRESH_TOKEN env var (manual fallback)
async function bootstrapTokens() {
  if (Object.keys(userTokens).length > 0) {
    console.log('🔑 Loaded tokens from tokens.json');
    return;
  }

  // Try Redis first
  const redisToken = await redisLoad('default_user');
  if (redisToken) {
    userTokens['default_user'] = redisToken;
    console.log('🔑 Bootstrapped tokens from Upstash Redis');
    return;
  }

  // Fall back to env var (legacy / manual setup)
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    userTokens['default_user'] = {
      accessToken: null,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      expiryTime: 0,
    };
    console.log('🔑 Bootstrapped token from GOOGLE_REFRESH_TOKEN env var');
  }
}

// --- Timezone-aware day boundary helpers ---

// Returns the UTC offset in ms for a given timezone at a specific moment.
// Positive = ahead of UTC (e.g. IST = +19800000)
function getOffsetMs(timezone, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
    const match = offsetStr.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0;
    const sign = match[1] === '+' ? 1 : -1;
    const h = parseInt(match[2], 10);
    const m = parseInt(match[3] || '0', 10);
    return sign * (h * 60 + m) * 60 * 1000;
  } catch {
    return 0;
  }
}

// Returns { startTimeMillis, endTimeMillis } for a calendar day in the user's timezone.
// e.g. "2026-04-21" in IST (UTC+5:30) → 2026-04-20T18:30:00Z … 2026-04-21T18:29:59Z
function getDayBoundaries(dateStr, timezone) {
  const refDate = new Date(`${dateStr}T12:00:00.000Z`); // noon UTC — safe from DST edge cases
  const offsetMs = getOffsetMs(timezone, refDate);
  const startTimeMillis = Date.parse(`${dateStr}T00:00:00.000Z`) - offsetMs;
  const endTimeMillis = startTimeMillis + 24 * 60 * 60 * 1000 - 1000;
  return { startTimeMillis, endTimeMillis };
}

// Returns today's date string in the given timezone (YYYY-MM-DD)
function getTodayInTimezone(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

// --- Google Fit fetch helper (reused by /api/steps and /api/steps/batch) ---
//
// Strategy: query two sources in parallel and return the higher count.
//   1. estimated_steps  — Google's smart deduplicated estimate, the same number shown
//                         in the Google Fit app. Merges across all fitness apps (Garmin,
//                         Samsung Health, Fitbit, etc.) without double-counting.
//   2. default merge    — legacy behaviour (no dataSourceId); used as fallback in case
//                         estimated_steps isn't populated for a particular day/device.
//
async function fetchStepsForDate(userId, dateStr, timezone) {
  const token = userTokens[userId].accessToken;
  const { startTimeMillis, endTimeMillis } = getDayBoundaries(dateStr, timezone);

  const base = { bucketByTime: { durationMillis: 86400000 }, startTimeMillis, endTimeMillis };

  const queries = [
    // Google's cross-source deduplicated estimate
    { ...base, aggregateBy: [{ dataTypeName: 'com.google.step_count.delta', dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps' }] },
    // Default data-type aggregate (current / fallback behaviour)
    { ...base, aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }] },
  ];

  const counts = await Promise.all(queries.map(async (body) => {
    try {
      const resp = await axios.post(
        'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
        body,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      let steps = 0;
      resp.data.bucket?.forEach((bucket) => {
        bucket.dataset?.[0]?.point?.forEach((point) => {
          steps += point.value?.[0]?.intVal || 0;
        });
      });
      return steps;
    } catch (err) {
      console.warn(`[steps] source query failed for ${dateStr}: ${err.message}`);
      return 0;
    }
  }));

  const best = Math.max(...counts, 0);
  console.log(`[steps] ${dateStr}: estimated=${counts[0]}, default=${counts[1]} → best=${best}`);
  return best;
}

// Auth Routes
app.get('/auth/login', (req, res) => {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid https://www.googleapis.com/auth/fitness.activity.read');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  res.json({ authUrl: authUrl.toString() });
});

// GET endpoint for Google OAuth redirect
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`<h1>Authentication Error</h1><p>${error}</p><a href="${FRONTEND_URL}">Back to app</a>`);
  }

  if (!code) {
    return res.send(`<h1>Error</h1><p>No authorization code provided</p><a href="${FRONTEND_URL}">Back to app</a>`);
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in, id_token } = tokenResponse.data;
    const sub = id_token ? decodeIdToken(id_token) : null;
    const userId = sub || state || 'default_user';

    // Store tokens
    userTokens[userId] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiryTime: Date.now() + (expires_in * 1000),
    };
    saveTokens();
    redisSave(userId, userTokens[userId]); // persist to Redis (no-op if not configured)

    // Log refresh token (only needed as manual fallback if Redis isn't configured)
    if (!UPSTASH_URL) {
      console.log(`🔑 OAuth success for ${userId}. No Upstash configured — set this in Render env vars to survive restarts:`);
      console.log(`   GOOGLE_REFRESH_TOKEN=${refresh_token}`);
    } else {
      console.log(`🔑 OAuth success for ${userId}. Token saved to Upstash Redis.`);
    }

    // Redirect back to frontend with success
    res.redirect(`${FRONTEND_URL}?auth=success&userId=${userId}`);
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    res.send(`<h1>Authentication Failed</h1><p>Error: ${error.message}</p><a href="${FRONTEND_URL}">Back to app</a>`);
  }
});

// POST endpoint for frontend token exchange (alternative)
app.post('/auth/callback', async (req, res) => {
  const { code, state } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in, id_token } = tokenResponse.data;
    const sub = id_token ? decodeIdToken(id_token) : null;
    const userId = sub || state || 'default_user';

    // Store tokens
    userTokens[userId] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiryTime: Date.now() + (expires_in * 1000),
    };
    saveTokens();
    redisSave(userId, userTokens[userId]);

    res.json({
      success: true,
      message: 'Authentication successful',
      userId,
    });
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to exchange authorization code' });
  }
});

// API Routes

// Auth status — lets the frontend verify tokens are still valid without a full sync
app.get('/auth/status', async (req, res) => {
  const { userId = 'default_user' } = req.query;
  const stored = await getTokensForUser(userId);
  res.json({ authenticated: !!(stored && stored.refreshToken) });
});

// Returns the current refresh token so you can set GOOGLE_REFRESH_TOKEN in Render once.
// After that the backend bootstraps itself on every restart — no more re-logins.
app.get('/auth/export-token', async (req, res) => {
  const { userId = 'default_user' } = req.query;
  const stored = await getTokensForUser(userId);
  if (!stored?.refreshToken) {
    return res.status(404).json({ error: 'No token found. Please log in first.' });
  }
  res.json({
    refreshToken: stored.refreshToken,
    instructions: 'Copy the refreshToken value. In Render → your backend service → Environment, add: GOOGLE_REFRESH_TOKEN=<value>. Then redeploy. You will never need to log in again.',
  });
});

// Reset auth for a userId — clears in-memory tokens, tokens.json, and Redis key.
// Useful for testing the fresh-login flow. Call with DELETE /auth/reset?userId=<id>
// or DELETE /auth/reset (clears ALL users — full factory reset).
app.delete('/auth/reset', async (req, res) => {
  const { userId } = req.query;

  if (userId) {
    delete userTokens[userId];
    // Also delete from Redis
    if (UPSTASH_URL && UPSTASH_AUTH) {
      try {
        await axios.get(`${UPSTASH_URL}/del/tokens:${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${UPSTASH_AUTH}` },
        });
      } catch (err) {
        console.warn('[redis] delete failed:', err.message);
      }
    }
    console.log(`[reset] cleared tokens for userId=${userId}`);
  } else {
    // Full reset — clear everything
    Object.keys(userTokens).forEach(k => delete userTokens[k]);
    console.log('[reset] cleared ALL tokens');
  }

  saveTokens();
  res.json({ success: true, message: userId ? `Tokens cleared for ${userId}` : 'All tokens cleared' });
});

app.post('/api/steps', async (req, res) => {
  const { userId = 'default_user', date, timezone = 'UTC' } = req.body;

  const tokens = await getTokensForUser(userId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated. Please login first.' });
  }

  const targetDate = date || getTodayInTimezone(timezone);

  try {
    const steps = await fetchStepsForDate(userId, targetDate, timezone);
    res.json({ date: targetDate, steps });
  } catch (error) {
    if (error.response?.status === 401) {
      try {
        await refreshAccessToken(userId);
        const steps = await fetchStepsForDate(userId, targetDate, timezone);
        res.json({ date: targetDate, steps });
      } catch (refreshError) {
        return res.status(401).json({ error: 'Authentication expired. Please login again.' });
      }
    } else {
      console.error('Google Fit API error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Failed to fetch steps from Google Fit' });
    }
  }
});

app.post('/api/steps/batch', async (req, res) => {
  const { userId = 'default_user', dates, timezone = 'UTC' } = req.body;

  const tokens = await getTokensForUser(userId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated. Please login first.' });
  }

  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: 'dates must be a non-empty array' });
  }

  const results = [];
  for (const dateStr of dates) {
    let fetched = false;
    // Retry up to 2 times on transient errors (503, 429, network)
    for (let attempt = 1; attempt <= 2 && !fetched; attempt++) {
      try {
        const steps = await fetchStepsForDate(userId, dateStr, timezone);
        results.push({ date: dateStr, steps });
        fetched = true;
      } catch (error) {
        const status = error.response?.status;
        if (status === 401) {
          try {
            await refreshAccessToken(userId);
            const steps = await fetchStepsForDate(userId, dateStr, timezone);
            results.push({ date: dateStr, steps });
            fetched = true;
          } catch {
            return res.status(401).json({ error: 'Authentication expired. Please login again.' });
          }
        } else if ((status === 503 || status === 429) && attempt < 2) {
          console.warn(`Transient ${status} for ${dateStr}, retrying after 1s...`);
          await new Promise(r => setTimeout(r, 1000));
        } else {
          console.error(`Failed to fetch steps for ${dateStr}:`, error.response?.data || error.message);
          // Omit from results so backfill retries this date next time
        }
      }
    }
  }

  console.log(`[batch] dates requested: ${dates.join(', ')}`);
  console.log(`[batch] results: ${JSON.stringify(results)}`);
  res.json({ results });
});

app.post('/api/refresh-token', async (req, res) => {
  const { userId = 'default_user' } = req.body;

  const tokens = await getTokensForUser(userId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated. Please login first.' });
  }

  try {
    await refreshAccessToken(userId);
    res.json({ success: true, message: 'Token refreshed' });
  } catch (error) {
    res.status(401).json({ error: 'Failed to refresh token. Please login again.' });
  }
});

async function refreshAccessToken(userId) {
  const stored = userTokens[userId];
  if (!stored || !stored.refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: stored.refreshToken,
    grant_type: 'refresh_token',
  });

  const { access_token, expires_in } = response.data;
  userTokens[userId].accessToken = access_token;
  userTokens[userId].expiryTime = Date.now() + (expires_in * 1000);
  saveTokens();
  redisSave(userId, userTokens[userId]); // keep Redis in sync with refreshed access token
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Backend running', port: PORT });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server — bootstrap tokens first (async), then listen
const certsDir = path.join(__dirname, 'cert');
const certFile = path.join(certsDir, 'sumits-macbook-air.tail2cae07.ts.net.crt');
const keyFile  = path.join(certsDir, 'sumits-macbook-air.tail2cae07.ts.net.key');

async function main() {
  await bootstrapTokens();
  console.log(`🔑 Active tokens for: [${Object.keys(userTokens).join(', ') || 'none'}]`);

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const sslOptions = {
      cert: fs.readFileSync(certFile),
      key: fs.readFileSync(keyFile),
    };
    https.createServer(sslOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Backend running on https://0.0.0.0:${PORT} (HTTPS)`);
      console.log(`🔒 Tailscale: https://sumits-macbook-air.tail2cae07.ts.net:${PORT}`);
      console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
    });
  } else {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Backend running on http://0.0.0.0:${PORT} (HTTP)`);
      console.log(`⚠️  No TLS certs found in certs/ — using HTTP`);
      console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
