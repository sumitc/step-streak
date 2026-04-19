const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:4000', 'http://localhost:3000', 'http://127.0.0.1:4000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Store tokens in memory (in production, use database/session store)
const userTokens = {};

// Environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:4000/auth/callback';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  console.error('See OAUTH_BACKEND_SETUP.md for configuration');
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
    return res.send(`<h1>Authentication Error</h1><p>${error}</p><a href="http://localhost:4000">Back to app</a>`);
  }

  if (!code) {
    return res.send('<h1>Error</h1><p>No authorization code provided</p><a href="http://localhost:4000">Back to app</a>');
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

    // Redirect back to frontend with success
    res.redirect(`http://localhost:4000?auth=success&userId=${userId}`);
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    res.send(`<h1>Authentication Failed</h1><p>Error: ${error.message}</p><a href="http://localhost:4000">Back to app</a>`);
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
app.post('/api/steps', async (req, res) => {
  const { userId = 'default_user', date } = req.body;

  if (!userTokens[userId]) {
    return res.status(401).json({ error: 'Not authenticated. Please login first.' });
  }

  try {
    const token = userTokens[userId].accessToken;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const startTime = new Date(`${targetDate}T00:00:00`).getTime();
    const endTime = new Date(`${targetDate}T23:59:59`).getTime();

    const response = await axios.post(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      {
        aggregateBy: [{
          dataTypeName: 'com.google.step_count.delta',
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: startTime,
        endTimeMillis: endTime,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    let totalSteps = 0;
    if (response.data.bucket && response.data.bucket.length > 0) {
      response.data.bucket.forEach((bucket) => {
        if (bucket.dataset && bucket.dataset[0] && bucket.dataset[0].point) {
          bucket.dataset[0].point.forEach((point) => {
            if (point.value && point.value[0]) {
              totalSteps += point.value[0].intVal || 0;
            }
          });
        }
      });
    }

    res.json({ date: targetDate, steps: totalSteps });
  } catch (error) {
    console.error('Google Fit API error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      // Token expired, try to refresh
      try {
        await refreshAccessToken(userId);
        // Retry the request
        return res.json({ error: 'Token refreshed. Please retry.' });
      } catch (refreshError) {
        return res.status(401).json({ error: 'Authentication expired. Please login again.' });
      }
    }

    res.status(500).json({ error: 'Failed to fetch steps from Google Fit' });
  }
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

app.listen(PORT, () => {
  console.log(`✅ Backend server running on http://localhost:${PORT}`);
  console.log(`📝 See OAUTH_BACKEND_SETUP.md for Google OAuth setup`);
});
