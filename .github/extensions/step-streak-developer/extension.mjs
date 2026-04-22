// Extension: step-streak-developer
// Step Streak developer skill — architecture context, server management, and project knowledge

import { joinSession } from "@github/copilot-sdk/extension";
import { execSync, spawn } from "child_process";

// ─── Project paths ────────────────────────────────────────────────────────────
const PROJECTS_DIR = "/Users/sumitc/projects";
const BACKEND_DIR  = `${PROJECTS_DIR}/step-streak-backend`;
const FRONTEND_DIR = `${PROJECTS_DIR}/step-streak-app`;
const BACKEND_URL  = "https://step-streak.onrender.com";
const FRONTEND_URL = "http://localhost:4000";

// ─── Architecture knowledge ───────────────────────────────────────────────────
const ARCHITECTURE = `
# Step Streak — Architecture Reference

## Overview
Step Streak is a daily 8,000-step challenge app.
- Frontend: React + TypeScript, bundled with Webpack, packaged as Android APK via Capacitor
- Backend: Node.js / Express, HTTPS via Tailscale TLS cert, proxies Google Fit API

## Project Directories
- step-streak-backend/   → Express API server (port 5001, HTTPS)
- step-streak-app/       → React + Capacitor frontend (port 4000 in dev)
- step-streak/           → Legacy/reference (not active)

## Backend (step-streak-backend/server.js)

### Endpoints
| Method | Path                | Purpose |
|--------|---------------------|---------|
| GET    | /health             | Health check |
| GET    | /auth/login         | Returns Google OAuth URL |
| GET    | /auth/callback      | OAuth redirect handler, stores tokens, redirects to frontend |
| POST   | /auth/callback      | Alternative token exchange |
| GET    | /auth/status        | Checks if userId has valid tokens (?userId=) |
| POST   | /api/steps          | Fetch steps for one date { userId, date, timezone } |
| POST   | /api/steps/batch    | Fetch steps for multiple dates { userId, dates[], timezone } |
| POST   | /api/refresh-token  | Force token refresh |

### Token persistence
- Tokens stored in tokens.json (gitignored), loaded on startup
- Atomic write: write to tokens.json.tmp then rename (avoids corruption)
- userTokens object: { [userId]: { accessToken, refreshToken, expiryTime } }
- userId defaults to 'default_user' (single-user app)

### Timezone-aware day boundaries
- CRITICAL: Google Fit uses epoch milliseconds. Must pass IST day boundaries, not UTC.
- getDayBoundaries(dateStr, timezone) computes correct UTC epoch range for a local calendar day
- e.g. "2026-04-21" in IST (UTC+5:30) → 2026-04-20T18:30:00Z to 2026-04-21T18:29:59Z
- Using UTC boundaries gives WRONG (partial) step counts — this caused a major bug

### Error handling
- 503/429 from Google Fit: retry once after 1s
- 401: refresh token, retry once; if still 401, return 401 to frontend
- On batch failure: omit the date from results (don't save 0), so backfill retries it next time

### HTTPS / TLS
- Cert: cert/sumits-macbook-air.tail2cae07.ts.net.crt (Tailscale cert)
- Key:  cert/sumits-macbook-air.tail2cae07.ts.net.key
- Falls back to HTTP if certs not found
- OAuth REDIRECT_URI must match what's registered in Google Cloud Console

### CORS
- Allows: FRONTEND_URL, localhost:4000, localhost:3000, 192.168.x.x:xxxx pattern
- Credentials: true

## Frontend (step-streak-app/src/)

### Key files
| File | Purpose |
|------|---------|
| utils/dateUtils.ts    | getLocalDateString(), getTimezone(), getLastNDates(n) |
| utils/storage.ts      | localStorage CRUD, updateStreaks(), batchUpdateSteps() |
| utils/googleFit.ts    | Backend API calls: checkAuthStatus, syncStepsFromBackend, syncStepsBatch |
| utils/syncManager.ts  | Sync orchestration: syncOnOpen, forceSyncToday, syncBackfill |
| components/Dashboard.tsx | Main UI, Capacitor appStateChange listener |
| types.ts              | UserData, DailySteps, StreakData, Reward |

### Sync flow
1. App open/resume → syncOnOpen() (15-min cooldown, verifies auth first)
2. Manual sync button → forceSyncToday() (no cooldown) + syncBackfill() in background
3. Capacitor appStateChange listener fires syncOnOpen() on every foreground resume

### syncOnOpen
- Reads isAuthenticated from localStorage
- Calls /auth/status to verify backend still has tokens (clears local auth if not)
- If shouldSync() (15-min cooldown passed): calls /api/steps for today
- Returns { steps, synced }

### forceSyncToday
- Same as syncOnOpen but skips cooldown check
- Used by manual sync button

### syncBackfill
- Re-fetches all 6 prior days (today-1 through today-6) every time it runs
- Why always re-fetch: old data may have been saved with wrong timezone (UTC vs local)
  and Google Fit data can arrive late
- Calls /api/steps/batch with all 6 dates
- Non-blocking (.then() in Dashboard)

### Streak calculation (storage.ts updateStreaks)
- currentStreak: walks sortedDays (most recent first) checking expectedDate == actual date
  on each step. Breaks on any gap or day below 8000 steps threshold.
- longestStreak: sliding window over sorted array, checks consecutive dates explicitly
- CRITICAL: dates must be sorted before streak calculation — unsorted gives wrong results
- CRITICAL: use getLocalDateString() not toISOString().split('T')[0] — UTC date != IST date
  in the first 5h30m of the IST day

### Date handling rules (CRITICAL)
- NEVER use new Date().toISOString().split('T')[0] — this gives UTC date
- ALWAYS use getLocalDateString() from dateUtils.ts — uses local timezone
- ALWAYS pass timezone to backend (getTimezone() returns IANA name e.g. "Asia/Kolkata")
- Streak bugs caused by timezone mismatch are silent and hard to detect

### localStorage schema (STORAGE_KEY = 'step_streak_data')
\`\`\`json
{
  "dailySteps":     [{ "date": "2026-04-22", "steps": 10844 }],
  "streakData":     { "currentStreak": 7, "longestStreak": 7, "lastUpdateDate": "2026-04-22" },
  "rewards":        [{ "days": 3, "earned": true }, { "days": 5, "earned": true }, { "days": 7, "earned": false }],
  "lastSyncDate":   "2026-04-22T16:30:49.887Z",
  "lastSyncTimestamp": "2026-04-22T16:30:49.887Z",
  "isAuthenticated": true,
  "userId": "default_user"
}
\`\`\`

### Environment (.env)
- REACT_APP_BACKEND_URL=https://sumits-macbook-air.tail2cae07.ts.net:5001
- REACT_APP_GOOGLE_FIT_CLIENT_ID=<client_id>
- Note: env vars are baked in at webpack build time. After changing .env, restart dev server.

## Dev server startup
- Backend: cd step-streak-backend && nohup node server.js > /tmp/backend.log 2>&1 & disown $!
- Frontend: cd step-streak-app && nohup npm run dev > /tmp/webpack-dev.log 2>&1 & disown $!
- Use nohup + disown — plain & causes process to die when shell exits
- Backend logs: /tmp/backend.log
- Frontend logs: /tmp/webpack-dev.log

## Google Cloud Console
- OAuth Client ID: 655331959412-s8nf4u3a9htnd72lmt72ud1b4dbf89e2.apps.googleusercontent.com
- Authorized redirect URI: https://sumits-macbook-air.tail2cae07.ts.net:5001/auth/callback
- Scopes: https://www.googleapis.com/auth/fitness.activity.read

## Known gotchas & learnings
1. TIMEZONE BUG: Most insidious bug. toISOString().split('T')[0] returns UTC date.
   In IST (UTC+5:30), this is wrong for the first 5h30m of every local day.
   Always use getLocalDateString() on frontend. Always use getDayBoundaries() on backend.

2. STALE DATA: Old data fetched with wrong timezone can't be detected by looking at step counts.
   Solution: syncBackfill always re-fetches all 6 prior days (not just missing ones).

3. TOKEN LOSS ON RESTART: In-memory tokens lost when backend crashes. 
   Solution: persist to tokens.json with atomic write.

4. BACKEND DIES WITH SHELL: Using & without nohup/disown kills process when shell exits.
   Solution: always use nohup + disown for both servers.

5. ENV VARS NOT UPDATED: After editing .env, the running webpack dev server still has old values baked in.
   Solution: always restart the dev server after .env changes.

6. REACT DOESN'T REMOUNT ON RESUME: useEffect on mount doesn't fire when app resumes from background.
   Solution: Capacitor App.addListener('appStateChange', ...) in a separate useEffect.

7. STREAK CALC NEEDS SORTED DATA: The old longestStreak calc ran on unsorted array — gave wrong results.
   Solution: always sort dailySteps by date before any streak calculation.

8. 503 FROM GOOGLE FIT: Transient. Don't save 0 steps for failed dates — omit them so backfill retries.

9. isAuthenticated IN LOCALSTORAGE CAN DRIFT: localStorage says authenticated but backend lost tokens.
   Solution: always call /auth/status before any sync attempt.
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isStepStreakCwd(cwd) {
    return cwd && (
        cwd.includes("step-streak") ||
        cwd === PROJECTS_DIR
    );
}

function checkPort(port) {
    try {
        execSync(`lsof -i :${port} | grep LISTEN`, { stdio: "pipe" });
        return true;
    } catch { return false; }
}

// ─── Extension ────────────────────────────────────────────────────────────────
const session = await joinSession({
    tools: [
        {
            name: "step_streak_get_context",
            description: "Returns the full Step Streak architecture reference, design decisions, known gotchas, and file map. Call this when starting any Step Streak work.",
            parameters: { type: "object", properties: {} },
            skipPermission: true,
            handler: async () => ARCHITECTURE,
        },
        {
            name: "step_streak_server_status",
            description: "Checks whether the Step Streak backend (5001) and frontend (4000) dev servers are currently running.",
            parameters: { type: "object", properties: {} },
            skipPermission: true,
            handler: async () => {
                const backendUp = checkPort(5001);
                const frontendUp = checkPort(4000);
                const lines = [
                    `Backend (port 5001): ${backendUp ? "✅ running" : "❌ not running"}`,
                    `Frontend (port 4000): ${frontendUp ? "✅ running" : "❌ not running"}`,
                ];
                if (backendUp) {
                    try {
                        const out = execSync(`curl -sk ${BACKEND_URL}/health`, { timeout: 3000 }).toString();
                        lines.push(`Backend health: ${out.trim()}`);
                    } catch { lines.push("Backend health: unreachable via Tailscale URL"); }
                }
                return lines.join("\n");
            },
        },
        {
            name: "step_streak_start_servers",
            description: "Starts the Step Streak backend and/or frontend dev servers using nohup so they persist. Pass which='backend', 'frontend', or 'both'.",
            parameters: {
                type: "object",
                properties: {
                    which: {
                        type: "string",
                        enum: ["backend", "frontend", "both"],
                        description: "Which server(s) to start",
                    },
                },
                required: ["which"],
            },
            handler: async ({ which }) => {
                const results = [];

                if (which === "backend" || which === "both") {
                    if (checkPort(5001)) {
                        results.push("Backend already running on port 5001");
                    } else {
                        execSync(
                            `cd ${BACKEND_DIR} && nohup node server.js > /tmp/backend.log 2>&1 & disown $!`,
                            { shell: "/bin/bash" }
                        );
                        // Wait briefly then verify
                        await new Promise(r => setTimeout(r, 3000));
                        results.push(checkPort(5001)
                            ? "✅ Backend started on port 5001"
                            : "❌ Backend failed to start — check /tmp/backend.log");
                    }
                }

                if (which === "frontend" || which === "both") {
                    if (checkPort(4000)) {
                        results.push("Frontend already running on port 4000");
                    } else {
                        execSync(
                            `cd ${FRONTEND_DIR} && nohup npm run dev > /tmp/webpack-dev.log 2>&1 & disown $!`,
                            { shell: "/bin/bash" }
                        );
                        await new Promise(r => setTimeout(r, 8000));
                        results.push(checkPort(4000)
                            ? `✅ Frontend started — open ${FRONTEND_URL}`
                            : "❌ Frontend failed to start — check /tmp/webpack-dev.log");
                    }
                }

                return results.join("\n");
            },
        },
        {
            name: "step_streak_setup_guide",
            description: "Returns a full first-time setup guide for the Step Streak project — how to get Google OAuth credentials, configure Tailscale HTTPS, create .env files, install dependencies, and run the servers.",
            parameters: { type: "object", properties: {} },
            skipPermission: true,
            handler: async () => `
# Step Streak — First-Time Setup Guide

## Prerequisites
- Node.js 18+
- A Google account
- Tailscale installed (for HTTPS on local network / mobile access)

---

## Step 1 — Google Cloud Project & OAuth Credentials

1. Go to https://console.cloud.google.com/
2. Create a new project (or select existing).
3. Enable the **Fitness API**:
   - Search "Fitness API" in the API Library → Enable it.
4. Create OAuth credentials:
   - Go to **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Web application**
   - Add an **Authorized redirect URI**:
     \`https://<your-tailscale-hostname>:5001/auth/callback\`
     (e.g. \`https://sumits-macbook-air.tail2cae07.ts.net:5001/auth/callback\`)
   - Click Create → copy the **Client ID** and **Client Secret**
5. Configure the OAuth consent screen:
   - Go to **APIs & Services → OAuth consent screen**
   - Set User Type to **External** (or Internal if GSuite)
   - Add scope: \`https://www.googleapis.com/auth/fitness.activity.read\`
   - Add your Google account as a **Test user** (required while app is in Testing mode)

---

## Step 2 — Tailscale HTTPS cert

Tailscale provides free TLS certs for your machine's Tailscale hostname.

1. Install Tailscale: https://tailscale.com/download
2. Log in: \`tailscale up\`
3. Find your hostname: \`tailscale status\` (looks like \`yourname-macbook-air.tail2cae07.ts.net\`)
4. Provision the TLS cert:
   \`\`\`bash
   sudo tailscale cert <your-tailscale-hostname>
   \`\`\`
   This creates two files — copy them into the backend:
   \`\`\`bash
   mkdir -p backend/cert
   sudo cp /etc/ssl/certs/<hostname>.crt backend/cert/
   sudo cp /etc/ssl/private/<hostname>.key backend/cert/
   sudo chown $(whoami) backend/cert/*
   \`\`\`
   The cert files must be named exactly \`<hostname>.crt\` and \`<hostname>.key\`.

---

## Step 3 — Backend .env

Create \`backend/.env\` (copy from \`backend/.env.example\`):
\`\`\`
GOOGLE_CLIENT_ID=<paste Client ID from Step 1>
GOOGLE_CLIENT_SECRET=<paste Client Secret from Step 1>
REDIRECT_URI=https://<your-tailscale-hostname>:5001/auth/callback
FRONTEND_URL=http://localhost:4000
PORT=5001
\`\`\`

---

## Step 4 — Frontend .env

Create \`frontend/.env\` (copy from \`frontend/.env.example\`):
\`\`\`
REACT_APP_BACKEND_URL=https://<your-tailscale-hostname>:5001
REACT_APP_GOOGLE_FIT_CLIENT_ID=<paste Client ID from Step 1>
\`\`\`

⚠️  After editing .env, always restart the webpack dev server — env vars are baked in at build time.

---

## Step 5 — Install dependencies

\`\`\`bash
cd backend && npm install
cd ../frontend && npm install
\`\`\`

---

## Step 6 — Start the servers

\`\`\`bash
# Backend (persists after shell exits)
cd backend && nohup node server.js > /tmp/backend.log 2>&1 & disown $!

# Frontend (persists after shell exits)
cd frontend && nohup npm run dev > /tmp/webpack-dev.log 2>&1 & disown $!
\`\`\`

Or use the \`step_streak_start_servers\` tool which does this for you.

---

## Step 7 — Authenticate

1. Open http://localhost:4000
2. Click **Connect Google Fit**
3. Complete the OAuth consent flow in the browser
4. You'll be redirected back to the app — the backend stores your tokens in \`backend/tokens.json\`

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Backend server not responding" | Check backend is running: \`step_streak_server_status\` |
| OAuth redirect fails | Ensure REDIRECT_URI in .env matches exactly what's in Google Cloud Console |
| Steps always 0 | Timezone mismatch — ensure frontend sends \`timezone\` (IANA name) to backend |
| Stale step data | Hit manual sync — backfill always re-fetches last 6 days |
| Backend loses tokens on restart | tokens.json missing or unreadable — check \`backend/tokens.json\` exists |
| TLS handshake error | cert files not found or hostname mismatch — re-run \`tailscale cert\` |
`,
        },
        {
            name: "step_streak_check_env",
            description: "Checks whether the backend and frontend .env files exist and have all required keys. Reports what is missing or empty.",
            parameters: { type: "object", properties: {} },
            skipPermission: true,
            handler: async () => {
                const fs = await import("fs");
                const path = await import("path");

                const checks = [
                    {
                        label: "backend/.env",
                        file: path.join(BACKEND_DIR, ".env"),
                        required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "REDIRECT_URI", "FRONTEND_URL", "PORT"],
                    },
                    {
                        label: "frontend/.env",
                        file: path.join(FRONTEND_DIR, ".env"),
                        required: ["REACT_APP_BACKEND_URL"],
                    },
                ];

                const lines = [];
                for (const { label, file, required } of checks) {
                    if (!fs.existsSync(file)) {
                        lines.push(`❌ ${label} — FILE MISSING (copy from .env.example and fill in values)`);
                        continue;
                    }
                    const content = fs.readFileSync(file, "utf8");
                    const parsed = Object.fromEntries(
                        content.split("\n")
                            .filter(l => l.includes("=") && !l.startsWith("#"))
                            .map(l => [l.split("=")[0].trim(), l.split("=").slice(1).join("=").trim()])
                    );
                    const missing = required.filter(k => !parsed[k] || parsed[k].startsWith("your_") || parsed[k] === "");
                    if (missing.length === 0) {
                        lines.push(`✅ ${label} — all required keys present`);
                    } else {
                        lines.push(`⚠️  ${label} — missing or placeholder values:`);
                        missing.forEach(k => lines.push(`   • ${k}`));
                    }
                }

                // Also check cert
                const certDir = path.join(BACKEND_DIR, "cert");
                if (!fs.existsSync(certDir) || fs.readdirSync(certDir).length === 0) {
                    lines.push("⚠️  backend/cert/ — no TLS cert files found (run: tailscale cert <hostname>)");
                } else {
                    const certs = fs.readdirSync(certDir);
                    lines.push(`✅ backend/cert/ — ${certs.join(", ")}`);
                }

                lines.push("");
                lines.push("Run step_streak_setup_guide for full setup instructions.");
                return lines.join("\n");
            },
        },
        {
            name: "step_streak_read_logs",
            description: "Read the last N lines from the Step Streak backend or frontend dev server logs.",
            parameters: {
                type: "object",
                properties: {
                    which: { type: "string", enum: ["backend", "frontend"], description: "Which log to read" },
                    lines: { type: "number", description: "Number of lines from end (default 50)" },
                },
                required: ["which"],
            },
            skipPermission: true,
            handler: async ({ which, lines = 50 }) => {
                const logFile = which === "backend" ? "/tmp/backend.log" : "/tmp/webpack-dev.log";
                try {
                    return execSync(`tail -${lines} ${logFile}`, { encoding: "utf8" });
                } catch {
                    return `Log file not found: ${logFile}`;
                }
            },
        },
    ],

    hooks: {
        onSessionStart: async ({ cwd }) => {
            if (!isStepStreakCwd(cwd)) return;
            return {
                additionalContext: `
You are working on the Step Streak project. Key facts:
- Backend dir: ${BACKEND_DIR} (Node/Express, port 5001 HTTPS)
- Frontend dir: ${FRONTEND_DIR} (React+TS+Capacitor, port 4000 dev)
- Backend URL: ${BACKEND_URL} (Tailscale TLS cert)
- Logs: /tmp/backend.log, /tmp/webpack-dev.log
- Always use nohup + disown when starting servers (plain & dies with shell)
- CRITICAL timezone rule: never use toISOString().split('T')[0] — always use getLocalDateString()
- Call step_streak_get_context for full architecture reference.
- Call step_streak_server_status to check if servers are up before debugging.
`,
            };
        },
    },
});

