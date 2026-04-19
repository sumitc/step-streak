export interface DailySteps {
  date: string;
  steps: number;
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastUpdateDate: string;
}

export interface Reward {
  days: number;
  earned: boolean;
  earnedDate?: string;
}

export interface UserData {
  dailySteps: DailySteps[];
  streakData: StreakData;
  rewards: Reward[];
  lastSyncDate: string;
}
