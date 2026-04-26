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

function loadTokens() {
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

const userTokens = loadTokens();

// On cloud deployments (ephemeral filesystem), bootstrap from env var if no tokens file exists.
// Set GOOGLE_REFRESH_TOKEN in your hosting platform's env vars after first local OAuth login.
if (Object.keys(userTokens).length === 0 && process.env.GOOGLE_REFRESH_TOKEN) {
  userTokens['default_user'] = {
    accessToken: null,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    expiryTime: 0, // forces refresh on first API call
  };
  console.log('🔑 Bootstrapped token from GOOGLE_REFRESH_TOKEN env var');
}

console.log(`🔑 Loaded tokens for users: [${Object.keys(userTokens).join(', ') || 'none'}]`);

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
async function fetchStepsForDate(userId, dateStr, timezone) {
  const token = userTokens[userId].accessToken;
  const { startTimeMillis, endTimeMillis } = getDayBoundaries(dateStr, timezone);

  const response = await axios.post(
    'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
    {
      aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis,
      endTimeMillis,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  let totalSteps = 0;
  if (response.data.bucket?.length > 0) {
    response.data.bucket.forEach((bucket) => {
      bucket.dataset?.[0]?.point?.forEach((point) => {
        totalSteps += point.value?.[0]?.intVal || 0;
      });
    });
  }
  return totalSteps;
}

// Auth Routes
app.get('/auth/login', (req, res) => {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/fitness.activity.read');
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

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const userId = state || 'default_user';

    // Store tokens
    userTokens[userId] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiryTime: Date.now() + (expires_in * 1000),
    };
    saveTokens();

    // Log refresh token — copy this to GOOGLE_REFRESH_TOKEN in Render env vars for persistence
    console.log(`🔑 OAuth success for ${userId}. Set this in Render env vars to survive restarts:`);
    console.log(`   GOOGLE_REFRESH_TOKEN=${refresh_token}`);

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

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const userId = state || 'default_user';

    // Store tokens
    userTokens[userId] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiryTime: Date.now() + (expires_in * 1000),
    };
    saveTokens();

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
app.get('/auth/status', (req, res) => {
  const { userId = 'default_user' } = req.query;
  const stored = userTokens[userId];
  res.json({ authenticated: !!(stored && stored.refreshToken) });
});

// Returns the current refresh token so you can set GOOGLE_REFRESH_TOKEN in Render once.
// After that the backend bootstraps itself on every restart — no more re-logins.
app.get('/auth/export-token', (req, res) => {
  const { userId = 'default_user' } = req.query;
  const stored = userTokens[userId];
  if (!stored?.refreshToken) {
    return res.status(404).json({ error: 'No token found. Please log in first.' });
  }
  res.json({
    refreshToken: stored.refreshToken,
    instructions: 'Copy the refreshToken value. In Render → your backend service → Environment, add: GOOGLE_REFRESH_TOKEN=<value>. Then redeploy. You will never need to log in again.',
  });
});

app.post('/api/steps', async (req, res) => {
  const { userId = 'default_user', date, timezone = 'UTC' } = req.body;

  if (!userTokens[userId]) {
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

  if (!userTokens[userId]) {
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

// Start server with HTTPS if certs exist, otherwise HTTP
const certsDir = path.join(__dirname, 'cert');
const certFile = path.join(certsDir, 'sumits-macbook-air.tail2cae07.ts.net.crt');
const keyFile = path.join(certsDir, 'sumits-macbook-air.tail2cae07.ts.net.key');

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
