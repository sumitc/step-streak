# Step Streak App

A React web app that rewards users for maintaining daily step streaks using Google Fit API integration.

## Features
- **Daily Step Tracking**: Log steps manually or sync from Google Fit
- **Streak Tracking**: Current and longest streaks
- **Rewards System**: Unlock badges for 3, 5, and 7-day streaks
- **Progress Visualization**: See how many steps until daily goal (8,000)
- **Responsive Design**: Works on desktop and mobile

## Tech Stack
- React 18 + TypeScript
- Webpack for bundling
- CSS for styling
- Google Fit REST API for data

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a Google OAuth 2.0 credential:
   - Go to Google Cloud Console
   - Create OAuth 2.0 credentials (Web Application)
   - Add `http://localhost:3000` to authorized redirect URIs
   - Note your Client ID

3. Create `.env` file (or pass via environment):
```
REACT_APP_GOOGLE_FIT_CLIENT_ID=your_client_id_here
```

## Development

Start the dev server:
```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## Build

Create a production build:
```bash
npm run build
```

Output will be in the `dist/` folder.

## Features Explained

### Daily Steps
- Enter steps manually or connect to Google Fit
- Tracks toward 8,000 step daily goal
- Shows remaining steps to goal

### Streaks
- Automatic tracking of consecutive days hitting goal
- Shows current streak and longest streak
- Resets if goal not met on a day

### Rewards
- 🥉 Bronze: 3-day streak
- 🥈 Silver: 5-day streak
- 🥇 Gold: 7-day streak

### Local Storage
- All data stored in browser localStorage
- Persists across sessions
- No server required (optional Google Fit sync)

## Packaging as APK

To package as Android APK using Capacitor:

1. Install Capacitor:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init
```

2. Build the web app:
```bash
npm run build
```

3. Add Android platform:
```bash
npx cap add android
```

4. Build Android project:
```bash
npx cap open android
```

5. Build APK in Android Studio:
   - Select Build → Build Bundle(s) / APK(s) → Build APK(s)
   - Sign with your keystore
   - APK ready for deployment

## Notes
- Google Fit integration requires OAuth setup
- Falls back to manual step entry if Google Fit unavailable
- localStorage works offline, syncs when online
