import { clearAuthenticated } from './storage';
import { getLocalDateString, getTimezone } from './dateUtils';

const getBackendUrl = () => process.env.REACT_APP_BACKEND_URL || 'http://localhost:5001';

// Redirects user to Google OAuth consent screen
export const getStepsFromGoogleFit = async (): Promise<void> => {
  try {
    const response = await fetch(`${getBackendUrl()}/auth/login`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error(`Backend error: ${response.status}`);

    const data = await response.json();
    if (data.authUrl) window.location.href = data.authUrl;
  } catch (error) {
    console.error('Error initiating Google Fit sync:', error);
    alert('❌ Backend server not responding. Make sure backend is running on port 5001.');
    throw error;
  }
};

// Verify that the backend still has valid tokens for this user
export const checkAuthStatus = async (userId: string = 'default_user'): Promise<boolean> => {
  try {
    const response = await fetch(`${getBackendUrl()}/auth/status?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
};

// Fetch steps for one date from the backend. Clears local auth on 401.
export const syncStepsFromBackend = async (
  date?: string,
  timezone?: string,
  userId: string = 'default_user'
): Promise<number> => {
  const targetDate = date || getLocalDateString();
  const tz = timezone || getTimezone();

  const response = await fetch(`${getBackendUrl()}/api/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, date: targetDate, timezone: tz }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthenticated();
      const err: any = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }
    throw new Error(`Backend error: ${response.status}`);
  }

  const data = await response.json();
  return data.steps || 0;
};

// Fetch steps for multiple dates in one call (used by backfill)
export const syncStepsBatch = async (
  dates: string[],
  userId: string = 'default_user',
  timezone?: string
): Promise<Array<{ date: string; steps: number }>> => {
  const tz = timezone || getTimezone();

  const response = await fetch(`${getBackendUrl()}/api/steps/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, dates, timezone: tz }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthenticated();
      const err: any = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }
    throw new Error(`Backend error: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
};

