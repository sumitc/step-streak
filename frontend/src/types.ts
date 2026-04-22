export interface DailySteps {
  date: string;
  steps: number;
}

// Status of a single day in a streak cycle
// 'pending'  = today or future (not yet decided)
// 'complete' = synced with steps >= threshold
// 'missed'   = past day confirmed below threshold or unsynced
export type DayStatus = 'pending' | 'complete' | 'missed';

export interface CycleDay {
  date: string;       // YYYY-MM-DD
  status: DayStatus;
}

export interface StreakCycle {
  cycleNumber: number;     // 0-indexed from appStartDate
  startDate: string;       // YYYY-MM-DD, first day of this cycle
  days: CycleDay[];        // exactly 7 entries
  milestones: {
    consecutive3: boolean; // ever had 3 consecutive complete days
    consecutive5: boolean; // ever had 5 consecutive complete days
    perfectWeek: boolean;  // all 7 days complete
  };
  pointsAwarded: number;   // cached derived total (recomputed on each update)
}

export interface UserData {
  schemaVersion: number;         // bump on breaking changes; current = 2
  dailySteps: DailySteps[];
  appStartDate: string;          // YYYY-MM-DD, fixed anchor set once
  totalPoints: number;           // lifetime points, derived from all cycles
  currentCycle: StreakCycle;
  pastCycles: StreakCycle[];
  lastSyncDate: string;
  lastSyncTimestamp: string;     // ISO timestamp of last successful sync (for cooldown)
  isAuthenticated: boolean;
  userId: string;
}
