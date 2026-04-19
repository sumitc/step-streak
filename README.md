# Step Streak 🏃‍♂️🔥

A web app that rewards users for completing 8,000 steps daily and tracks their streaks.

## Features
- 📊 Daily step tracking with progress visualization
- 🔥 Streak tracking (current & longest)
- 🏆 Reward badges for 3, 5, and 7-day streaks
- 🔗 Google Fit integration for automatic step syncing
- ✏️ Manual step entry option

## Project Structure
```
step-streak/
├── frontend/    # React + TypeScript web app (port 4000)
├── backend/     # Node.js + Express OAuth server (port 5001)
└── README.md
```

## Quick Start

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env   # Add your Google OAuth credentials
npm start               # Runs on http://localhost:5001
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev             # Runs on http://localhost:4000
```

### Environment Variables
Create `backend/.env`:
```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:5001/auth/callback
PORT=5001
```

Create `frontend/.env`:
```
REACT_APP_GOOGLE_FIT_CLIENT_ID=your_client_id
```

## Google Fit Setup
See [frontend/GOOGLE_FIT_SETUP.md](frontend/GOOGLE_FIT_SETUP.md) and [backend/OAUTH_BACKEND_SETUP.md](backend/OAUTH_BACKEND_SETUP.md) for OAuth configuration.

## Tech Stack
- **Frontend:** React 18, TypeScript, Webpack, CSS
- **Backend:** Node.js, Express, Axios
- **API:** Google Fit REST API via OAuth 2.0
