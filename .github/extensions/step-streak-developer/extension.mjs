// Extension: step-streak-developer
// Step Streak developer skill — architecture context, server management, and project knowledge

import { joinSession } from "@github/copilot-sdk/extension";
import { execSync, spawn } from "child_process";

// ─── Project paths ────────────────────────────────────────────────────────────
const PROJECTS_DIR  = "/Users/sumitc/projects";
const BACKEND_DIR   = `${PROJECTS_DIR}/step-streak-backend`;
const FRONTEND_DIR  = `${PROJECTS_DIR}/step-streak/frontend`;   // active Render-deployed frontend
const BACKEND_URL   = "https://step-streak-backend.onrender.com";
const FRONTEND_URL  = "https://step-streak.onrender.com";

// ─── Architecture knowledge ───────────────────────────────────────────────────
const ARCHITECTURE = `
# Step Streak — Architecture Reference (schema v4, updated 2026-04)

## Overview
Step Streak is a daily 8,000-step challenge app synced with Google Fit.
- Frontend: React + TypeScript, Webpack, deployed to Render (step-streak.onrender.com)
- Backend: Node.js / Express, deployed to Render (step-streak-backend.onrender.com), proxies Google Fit API
- No native app currently — runs as a web app; Capacitor APK path is legacy/unused

## Active project directories
- step-streak/frontend/   → React/TS frontend (the live deployed one)
- step-streak-backend/    → Express backend (port 5001 locally, Render in prod)
- step-streak-app/        → LEGACY — old Capacitor frontend, not deployed, ignore
- step-streak/            → git repo root (frontend lives here, shared with backend on Render)

## Deployment
- Both services deployed on Render (free tier)
- Frontend build: cd frontend && npm run build → produces dist/ (index.html + hashed bundles)
- Backend: node server.js
- Render free tier: backend sleeps after 15 min idle; first request after sleep may 
  be slow or lack CORS headers (race condition on wake-up). Not a bug — expected.
- Bundle filenames use [contenthash] for cache-busting (not [hash])
- Env vars: set in Render dashboard as OS env vars. webpack.config.js reads from 
  process.env first, then dotenv() for local dev. Never rely solely on dotenv().

---

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
- userTokens: { [userId]: { accessToken, refreshToken, expiryTime } }
- userId defaults to 'default_user' (single-user app)

### Timezone-aware day boundaries
- CRITICAL: Google Fit uses epoch ms. Must pass IST day boundaries, not UTC.
- getDayBoundaries(dateStr, timezone) computes correct UTC epoch range for a local day
- e.g. "2026-04-21" in IST (UTC+5:30) → 2026-04-20T18:30:00Z to 2026-04-21T18:29:59Z
- Using UTC boundaries gives WRONG (partial) step counts

### Error handling
- 503/429: retry once after 1s
- 401: refresh token, retry once; if still 401, return 401 to frontend
- On batch failure: omit the date (don't save 0 steps), so backfill retries later

### CORS
- Allows: FRONTEND_URL (Render URL), localhost:4000, localhost:3000, 192.168.x.x pattern
- Credentials: true

---

## Frontend (step-streak/frontend/src/)

### Key files
| File | Purpose |
|------|---------|
| types.ts                     | All interfaces; schema version 4 |
| utils/dateUtils.ts           | getLocalDateString(), getTimezone(), getLastNDates(n) |
| utils/storage.ts             | localStorage CRUD, rebuildCycles(), batchUpdateSteps(), migrations |
| utils/googleFit.ts           | Backend API calls: checkAuthStatus, syncStepsFromBackend, syncStepsBatch |
| utils/syncManager.ts         | Sync orchestration: syncOnOpen, forceSyncToday, syncBackfill |
| components/Dashboard.tsx     | Main UI; viewingDate state drives ring for selected dot |
| components/StreakDots.tsx     | 7-dot progress bar with connecting line, animations, dot click |
| components/PointsCounter.tsx | Animated count-up points display (lives in header) |
| styles/StreakDots.css         | Dot styles, lines, heartbeat, glow, confetti |
| styles/PointsCounter.css     | Points counter styling |
| styles/Dashboard.css         | Main layout, ring, header, goal label, viewing-date-label |

---

## Schema v4 — TypeScript types (types.ts)

\`\`\`ts
type DayStatus = 'pending' | 'complete' | 'missed';

interface CycleDay {
  date: string;       // YYYY-MM-DD
  status: DayStatus;
}

interface StreakCycle {
  cycleNumber: number;      // weeks since firstOpenDate's Monday (0-indexed)
  startDate: string;        // always the Monday of the week (YYYY-MM-DD)
  days: CycleDay[];         // exactly 7 entries (Mon–Sun)
  milestones: {
    consecutive3: boolean;  // ever had 3 consecutive complete days
    consecutive5: boolean;  // ever had 5 consecutive complete days
    perfectWeek: boolean;   // all days up to today complete
  };
  pointsAwarded: number;    // cached derived total for this cycle
}

interface UserData {
  schemaVersion: number;        // current = 4; bump on breaking changes
  dailySteps: DailySteps[];     // raw step data from Google Fit
  firstOpenDate: string;        // YYYY-MM-DD; date user first opened app (never changes)
  totalPoints: number;          // lifetime points, derived from all cycles
  currentCycle: StreakCycle;
  pastCycles: StreakCycle[];
  lastSyncDate: string;
  lastSyncTimestamp: string;    // ISO timestamp for 15-min cooldown
  isAuthenticated: boolean;
  userId: string;
}
\`\`\`

---

## Cycle logic (storage.ts)

### Mon–Sun calendar weeks
- Cycles are fixed Mon–Sun calendar weeks, not rolling 7 days from install.
- getWeekMonday(dateStr): returns the Monday of the week containing dateStr.
- rebuildCycles(): fully rebuilds currentCycle + pastCycles from scratch on every update.
  This makes it idempotent — no double-award risk.

### buildCycle(startDate, stepsMap, firstOpenDate)
- Creates a 7-day cycle from startDate (always a Monday).
- For each day:
  - If date > today → status = 'pending'
  - If date < firstOpenDate AND no Google Fit data → status = 'pending' (never auto-miss pre-install days)
  - If date < firstOpenDate AND Google Fit data exists → evaluate against 8000 threshold
  - If date is today or any past day with data → evaluate against threshold
  - If past day with no data → status = 'missed'

### Points system (computed in rebuildCycles)
- +10 per complete day
- +30 bonus at 3 consecutive complete days (once per cycle)
- +50 bonus at 5 consecutive complete days (once per cycle)
- +100 bonus for perfect week (all days up to today complete)
- totalPoints = sum of pointsAwarded across all pastCycles + currentCycle

### Schema migrations
- migrateFromLegacy(): converts old streakData/rewards format to v4
- migrateToV4(): called for any schemaVersion < 4; sets firstOpenDate, rebuilds cycles
- saveData() is called after migration so it only runs once

---

## Sync flow

1. App open / resume → syncOnOpen() (15-min cooldown, verifies auth first)
2. Manual sync button → forceSyncToday() (no cooldown) + syncBackfill() in background
3. syncBackfill re-fetches last 7 days (today-1 through today-6) via /api/steps/batch

### syncOnOpen
- Reads isAuthenticated from localStorage
- Calls /auth/status to verify backend still has tokens
- If shouldSync() (15-min cooldown): calls /api/steps for today
- Returns { steps, synced }

### syncBackfill
- Always re-fetches all 6 prior days (not just missing ones)
- Old data may have wrong timezone; Google Fit data can arrive late
- On batch failure: omit the date (don't save 0), retry next time

---

## UI: 7-Dot Streak Bar (StreakDots.tsx)

### Visual states per dot
- complete: green fill + ✓
- missed: dark grey + ✕
- pending (future): dark bg, grey border, day letter (M/T/W/T/F/S/S)
- pending (today): amber border, amber letter, heartbeat pulse animation (1.8s infinite)
- selected (any): white glow ring (amber glow for today's dot)

### Connecting line
- Grey baseline: streak-line-bg (spans full 7 dots, left:16px to right:16px)
- Green progress: streak-line-progress, width = lastCompleteIdx * (DOT_SIZE + DOT_GAP)
  where DOT_SIZE=32, DOT_GAP=6. Each step = 38px.

### Dot click interaction
- Click a dot → calls onDaySelect(date) prop → Dashboard sets viewingDate state
- Click same dot again → onDaySelect(null) → Dashboard resets to today
- Dashboard uses viewingDate to drive the main ring display (no new component needed)

### Animations
- triggerDotPop(i): scale bounce when a dot turns green
- triggerMilestoneBurst(label): floating "+30" / "+50" label
- triggerPerfectWeek(): confetti (60 pieces) + large "🎉 Perfect Week!" burst
- prevDaysRef MUST be initialized from current cycle state (not []) to avoid
  triggering animations for all dots on first mount

---

## UI: Main Ring (Dashboard.tsx)

### viewingDate state
- null by default → ring shows today's live steps
- Set by StreakDots.onDaySelect(date) when a dot is clicked
- displaySteps = viewingDate is past → look up in dailySteps array, else todaySteps
- displayDate always visible (defaults to today on load) as "📅 Mon, Apr 21" above ring

### Ring labels when viewing a past day
- Below goal: "X,xxx short" instead of "X,xxx to go"
- Met goal: "✅ Goal met" instead of bonus text
- isViewingPast flag controls which text to show

---

## Known gotchas & learnings

1. TIMEZONE BUG (most insidious): toISOString().split('T')[0] returns UTC date.
   In IST (UTC+5:30), wrong for first 5h30m of every local day.
   → Always use getLocalDateString() on frontend; getDayBoundaries() on backend.

2. STALE DATA: Old data fetched with wrong timezone can't be detected by step count.
   → syncBackfill always re-fetches all 6 prior days.

3. TOKEN LOSS ON RESTART: In-memory tokens lost when backend restarts.
   → Persist to tokens.json with atomic write.

4. BACKEND SLEEPS ON RENDER FREE TIER: Wake-up requests may lack CORS headers.
   → Not a bug; first open may be slow. Show loading state gracefully.

5. ENV VARS ON RENDER: Render sets env vars at OS level. webpack.config.js must read
   process.env directly, not rely only on dotenv(). Always check both sources.

6. REACT DOESN'T REMOUNT ON RESUME: useEffect on mount doesn't fire on background resume.
   → Capacitor App.addListener('appStateChange', ...) in a separate useEffect.

7. CORS PREFLIGHT ON GET: Adding Content-Type: application/json to a GET triggers
   a CORS preflight OPTIONS request. Remove it from GET calls.
   → Fixed in googleFit.ts — no Content-Type header on GET /auth/login.

8. LARGE FILE REWRITES LEAVE DUPLICATE CODE: If edit tool's old_str only matches the
   start of a large block, the new content prepends and old content remains.
   → After any large rewrite, count lines and grep for duplicate symbol declarations.
   → babel parse error "Identifier has already been declared" is the symptom.

9. prevDaysRef INIT: Must be initialized with cycle.days.map(d=>d.status) at mount,
   not []. Empty init causes all dots to appear "newly complete" and fire animations.

10. PRE-INSTALL DAYS: Days before firstOpenDate with no Google Fit data should be 
    'pending', not 'missed'. Only mark missed if we have data showing < 8000 steps.
    → Prevents the anchor bug where backfill data fell outside the cycle window.

11. isAuthenticated IN LOCALSTORAGE CAN DRIFT: localStorage says authenticated but
    backend lost tokens (e.g. Render redeploy wipes tokens.json).
    → Always call /auth/status before any sync attempt.

12. PERFECT WEEK DEFINITION: Days up to today all complete — do NOT require future
    pending dots to be complete. Check: days.filter(d => d.date <= today).every(...)
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
- Active frontend: ${FRONTEND_DIR} (React+TS, deployed to Render)
- Backend dir: ${BACKEND_DIR} (Node/Express, deployed to Render)
- Frontend URL: ${FRONTEND_URL}
- Backend URL: ${BACKEND_URL}
- Schema version: 4 — Mon–Sun cycle weeks, firstOpenDate, totalPoints, currentCycle, pastCycles
- step-streak-app/ is LEGACY — do not edit it; all active frontend work is in step-streak/frontend/
- CRITICAL timezone rule: never use toISOString().split('T')[0] — always use getLocalDateString()
- CRITICAL after large file rewrites: grep for duplicate symbol declarations (babel parse error symptom)
- Call step_streak_get_context for full architecture reference.
- Call step_streak_server_status to check if servers are up before debugging.
`,
            };
        },
    },
});

