import { UserData, DailySteps } from '../types';
import { getLocalDateString } from './dateUtils';

const STORAGE_KEY = 'step_streak_data';

const getDefaultData = (): UserData => ({
  dailySteps: [],
  streakData: {
    currentStreak: 0,
    longestStreak: 0,
    lastUpdateDate: getLocalDateString(),
  },
  rewards: [
    { days: 3, earned: false },
    { days: 5, earned: false },
    { days: 7, earned: false },
  ],
  lastSyncDate: new Date().toISOString(),
  lastSyncTimestamp: '',
  isAuthenticated: false,
  userId: 'default_user',
});

export const getStoredData = (): UserData => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return getDefaultData();
  // Merge with defaults so old data gains new fields
  return { ...getDefaultData(), ...JSON.parse(stored) };
};

export const saveData = (data: UserData): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const setAuthenticated = (userId: string = 'default_user'): void => {
  const data = getStoredData();
  data.isAuthenticated = true;
  data.userId = userId;
  saveData(data);
};

export const clearAuthenticated = (): void => {
  const data = getStoredData();
  data.isAuthenticated = false;
  saveData(data);
};

export const setLastSyncTimestamp = (): void => {
  const data = getStoredData();
  const now = new Date().toISOString();
  data.lastSyncTimestamp = now;
  data.lastSyncDate = now;
  saveData(data);
};

// Update steps for a specific date and recalculate streaks
export const setStepsForDate = (steps: number, date: string): void => {
  const data = getStoredData();
  const idx = data.dailySteps.findIndex((d) => d.date === date);
  if (idx >= 0) {
    data.dailySteps[idx].steps = steps;
  } else {
    data.dailySteps.push({ date, steps });
  }
  updateStreaks(data);
  saveData(data);
};

// Update today's steps (backwards-compatible helper)
export const addDailySteps = (steps: number): void => {
  setStepsForDate(steps, getLocalDateString());
};

// Batch-update multiple dates then recalculate once (used by backfill)
export const batchUpdateSteps = (updates: DailySteps[]): void => {
  const data = getStoredData();
  updates.forEach(({ date, steps }) => {
    const idx = data.dailySteps.findIndex((d) => d.date === date);
    if (idx >= 0) {
      data.dailySteps[idx].steps = steps;
    } else {
      data.dailySteps.push({ date, steps });
    }
  });
  updateStreaks(data);
  saveData(data);
};

const updateStreaks = (data: UserData): void => {
  const today = getLocalDateString();
  const threshold = 8000;

  const sortedDays = [...data.dailySteps].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Current streak: count consecutive calendar days ending today (or yesterday if today has no entry)
  let currentStreak = 0;
  let expectedDate = today;
  for (const daily of sortedDays) {
    if (daily.date !== expectedDate) break; // gap in consecutive days
    if (daily.steps >= threshold) {
      currentStreak++;
      // Step back one calendar day
      const d = new Date(daily.date + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      expectedDate = getLocalDateString(d);
    } else {
      break;
    }
  }

  // Longest streak: sliding window over date-sorted array
  let longestStreak = 0;
  let runStreak = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    if (sortedDays[i].steps >= threshold) {
      // Check this day is consecutive with the previous counted day
      if (runStreak === 0) {
        runStreak = 1;
      } else {
        const prev = new Date(sortedDays[i - 1].date + 'T12:00:00');
        prev.setDate(prev.getDate() - 1);
        if (getLocalDateString(prev) === sortedDays[i].date) {
          runStreak++;
        } else {
          runStreak = 1; // gap — restart
        }
      }
      longestStreak = Math.max(longestStreak, runStreak);
    } else {
      runStreak = 0;
    }
  }

  data.streakData.currentStreak = currentStreak;
  data.streakData.longestStreak = longestStreak;
  data.streakData.lastUpdateDate = today;



  updateRewards(data);
};

const updateRewards = (data: UserData): void => {
  const { currentStreak } = data.streakData;
  const today = getLocalDateString();

  data.rewards = data.rewards.map((reward) => {
    if (currentStreak >= reward.days && !reward.earned) {
      return { ...reward, earned: true, earnedDate: today };
    }
    return reward;
  });
};
