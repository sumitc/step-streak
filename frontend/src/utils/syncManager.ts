import {
  getStoredData,
  clearAuthenticated,
  setLastSyncTimestamp,
  addDailySteps,
  batchUpdateSteps,
} from './storage';
import { getLocalDateString, getTimezone, getLastNDates } from './dateUtils';
import { checkAuthStatus, syncStepsFromBackend, syncStepsBatch } from './googleFit';

const SYNC_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// Returns true if enough time has passed since the last successful sync
export const shouldSync = (): boolean => {
  const data = getStoredData();
  if (!data.isAuthenticated) return false;
  if (!data.lastSyncTimestamp) return true;
  return Date.now() - new Date(data.lastSyncTimestamp).getTime() > SYNC_COOLDOWN_MS;
};

// Called on every app open/resume. Verifies auth, then syncs today if cooldown passed.
export const syncOnOpen = async (): Promise<{ steps: number; synced: boolean }> => {
  const data = getStoredData();
  if (!data.isAuthenticated) return { steps: 0, synced: false };

  // Verify the backend still has valid tokens
  const authOk = await checkAuthStatus(data.userId);
  if (!authOk) {
    clearAuthenticated();
    return { steps: 0, synced: false };
  }

  const today = getLocalDateString();

  if (!shouldSync()) {
    const todayData = data.dailySteps.find((d) => d.date === today);
    return { steps: todayData?.steps || 0, synced: false };
  }

  try {
    const steps = await syncStepsFromBackend(today, getTimezone(), data.userId);
    addDailySteps(steps);
    setLastSyncTimestamp();
    return { steps, synced: true };
  } catch (error: any) {
    if (error.status === 401) clearAuthenticated();
    return { steps: 0, synced: false };
  }
};

// Force a sync for today, ignoring the cooldown. Used by the manual sync button.
export const forceSyncToday = async (): Promise<{ steps: number }> => {
  const data = getStoredData();
  if (!data.isAuthenticated) return { steps: 0 };

  const authOk = await checkAuthStatus(data.userId);
  if (!authOk) {
    clearAuthenticated();
    return { steps: 0 };
  }

  try {
    const steps = await syncStepsFromBackend(getLocalDateString(), getTimezone(), data.userId);
    addDailySteps(steps);
    setLastSyncTimestamp();
    return { steps };
  } catch (error: any) {
    if (error.status === 401) clearAuthenticated();
    return { steps: 0 };
  }
};

// Backfill last 7 days for any days not yet synced.
// Always refreshes yesterday (data can arrive late).
// Only fetches older days if they have no local entry.
export const syncBackfill = async (): Promise<void> => {
  const data = getStoredData();
  if (!data.isAuthenticated) return;

  const last7Days = getLastNDates(7);
  const [today] = last7Days;

  // Skip today (handled by syncOnOpen/forceSyncToday). Always re-fetch all other
  // days in the window — this corrects any previously-saved data with wrong timezone
  // boundaries and picks up late-arriving step data.
  const datesToSync = last7Days.filter((date) => date !== today);

  if (datesToSync.length === 0) return;

  console.log('[syncBackfill] syncing dates:', datesToSync);
  try {
    const results = await syncStepsBatch(datesToSync, data.userId, getTimezone());
    console.log('[syncBackfill] results:', results);
    batchUpdateSteps(results);
    setLastSyncTimestamp();
  } catch (error: any) {
    if (error.status === 401) clearAuthenticated();
  }
};
