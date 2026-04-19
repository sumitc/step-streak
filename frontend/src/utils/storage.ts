import { UserData, DailySteps, StreakData } from '../types';

const STORAGE_KEY = 'step_streak_data';

export const getStoredData = (): UserData => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return {
      dailySteps: [],
      streakData: {
        currentStreak: 0,
        longestStreak: 0,
        lastUpdateDate: new Date().toISOString().split('T')[0],
      },
      rewards: [
        { days: 3, earned: false },
        { days: 5, earned: false },
        { days: 7, earned: false },
      ],
      lastSyncDate: new Date().toISOString(),
    };
  }
  return JSON.parse(stored);
};

export const saveData = (data: UserData): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const addDailySteps = (steps: number): void => {
  const data = getStoredData();
  const today = new Date().toISOString().split('T')[0];
  
  const existingIndex = data.dailySteps.findIndex((d) => d.date === today);
  if (existingIndex >= 0) {
    data.dailySteps[existingIndex].steps = steps;
  } else {
    data.dailySteps.push({ date: today, steps });
  }
  
  updateStreaks(data);
  saveData(data);
};

const updateStreaks = (data: UserData): void => {
  const today = new Date().toISOString().split('T')[0];
  const threshold = 8000;
  
  let currentStreak = 0;
  const sortedDays = data.dailySteps
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  for (const daily of sortedDays) {
    if (daily.steps >= threshold) {
      currentStreak++;
    } else {
      break;
    }
  }

  const longestStreak = Math.max(
    ...(data.dailySteps.reduce((streaks, daily, idx, arr) => {
      let streak = 0;
      for (let i = idx; i < arr.length && arr[i].steps >= threshold; i++) {
        streak++;
      }
      return [...streaks, streak];
    }, [0] as number[]))
  );

  data.streakData.currentStreak = currentStreak;
  data.streakData.longestStreak = longestStreak;
  data.streakData.lastUpdateDate = today;

  updateRewards(data);
};

const updateRewards = (data: UserData): void => {
  const { currentStreak } = data.streakData;
  const today = new Date().toISOString().split('T')[0];

  data.rewards = data.rewards.map((reward) => {
    if (currentStreak >= reward.days && !reward.earned) {
      return { ...reward, earned: true, earnedDate: today };
    }
    return reward;
  });
};
