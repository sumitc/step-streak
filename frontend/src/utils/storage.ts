import { UserData, DailySteps, StreakCycle, CycleDay, DayStatus } from '../types';
import { getLocalDateString } from './dateUtils';

const STORAGE_KEY = 'step_streak_data';
const SCHEMA_VERSION = 3;
const STEPS_THRESHOLD = 8000;

// ─── Date helpers ────────────────────────────────────────────────────────────

const addDays = (dateStr: string, n: number): string => {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return getLocalDateString(d);
};

const daysBetween = (a: string, b: string): number => {
  const msA = new Date(a + 'T12:00:00').getTime();
  const msB = new Date(b + 'T12:00:00').getTime();
  return Math.round((msB - msA) / 86_400_000);
};

// ─── Cycle builders ──────────────────────────────────────────────────────────

const buildCycle = (
  cycleNumber: number,
  startDate: string,
  dailySteps: DailySteps[]
): StreakCycle => {
  const today = getLocalDateString();
  const stepsMap = new Map(dailySteps.map((d) => [d.date, d.steps]));

  const days: CycleDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startDate, i);
    let status: DayStatus;
    if (date > today) {
      status = 'pending';
    } else if (date === today) {
      const steps = stepsMap.get(date) ?? 0;
      status = steps >= STEPS_THRESHOLD ? 'complete' : 'pending';
    } else {
      const steps = stepsMap.get(date) ?? 0;
      status = steps >= STEPS_THRESHOLD ? 'complete' : 'missed';
    }
    return { date, status };
  });

  const milestones = deriveMilestones(days);
  const pointsAwarded = deriveCyclePoints(days, milestones);

  return { cycleNumber, startDate, days, milestones, pointsAwarded };
};

const deriveMilestones = (days: CycleDay[]) => {
  // Find the max consecutive 'complete' run in the cycle
  let maxConsec = 0;
  let run = 0;
  for (const day of days) {
    if (day.status === 'complete') { run++; maxConsec = Math.max(maxConsec, run); }
    else { run = 0; }
  }
  const perfectWeek = days.every((d) => d.status === 'complete');
  return {
    consecutive3: maxConsec >= 3,
    consecutive5: maxConsec >= 5,
    perfectWeek,
  };
};

const deriveCyclePoints = (
  days: CycleDay[],
  milestones: StreakCycle['milestones']
): number => {
  const completed = days.filter((d) => d.status === 'complete').length;
  let pts = completed * 10;
  if (milestones.consecutive3) pts += 30;
  if (milestones.consecutive5) pts += 50;
  if (milestones.perfectWeek) pts += 100;
  return pts;
};

// ─── Migration ───────────────────────────────────────────────────────────────

const migrateToV2 = (raw: any): UserData => {
  const today = getLocalDateString();
  const dailySteps: DailySteps[] = Array.isArray(raw.dailySteps) ? raw.dailySteps : [];
  // Anchor 6 days back so today is day 7 and backfill data fills days 1–6
  const appStartDate = dailySteps.length > 0 ? addDays(today, -6) : today;
  const currentCycle = buildCycle(0, appStartDate, dailySteps);
  return {
    schemaVersion: 2,
    dailySteps,
    appStartDate,
    totalPoints: 0,
    currentCycle,
    pastCycles: [],
    lastSyncDate: raw.lastSyncDate ?? new Date().toISOString(),
    lastSyncTimestamp: raw.lastSyncTimestamp ?? '',
    isAuthenticated: raw.isAuthenticated ?? false,
    userId: raw.userId ?? 'default_user',
  };
};

// Fix v2 data that had appStartDate wrongly anchored to today
const migrateToV3 = (data: UserData): UserData => {
  const today = getLocalDateString();
  let { appStartDate } = data;
  if (appStartDate === today && data.dailySteps.some((d) => d.date < today)) {
    appStartDate = addDays(today, -6);
  }
  return rebuildCycles({ ...data, schemaVersion: 3, appStartDate });
};

// ─── Core storage API ────────────────────────────────────────────────────────

const getDefaultData = (): UserData => {
  const today = getLocalDateString();
  const currentCycle = buildCycle(0, today, []);
  return {
    schemaVersion: SCHEMA_VERSION,
    dailySteps: [],
    appStartDate: today,
    totalPoints: 0,
    currentCycle,
    pastCycles: [],
    lastSyncDate: new Date().toISOString(),
    lastSyncTimestamp: '',
    isAuthenticated: false,
    userId: 'default_user',
  };
};

export const getStoredData = (): UserData => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return getDefaultData();
  const raw = JSON.parse(stored);

  let data: UserData;
  if (!raw.schemaVersion || raw.schemaVersion < 2) {
    data = migrateToV2(raw);
  } else {
    data = raw as UserData;
  }

  if (data.schemaVersion < SCHEMA_VERSION) {
    data = migrateToV3(data);
    saveData(data);
  }

  return data;
};

export const saveData = (data: UserData): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

// ─── Cycle management ────────────────────────────────────────────────────────

// Rebuild current/past cycles from dailySteps + fixed appStartDate.
// Returns the updated data (caller must saveData).
const rebuildCycles = (data: UserData): UserData => {
  const today = getLocalDateString();
  const daysSinceStart = daysBetween(data.appStartDate, today);
  const currentCycleNumber = Math.floor(daysSinceStart / 7);

  // Rebuild current cycle fresh
  const currentCycleStart = addDays(data.appStartDate, currentCycleNumber * 7);
  const newCurrentCycle = buildCycle(currentCycleNumber, currentCycleStart, data.dailySteps);

  // Rebuild past cycles that have changed (e.g. due to backfill)
  const pastCycles: StreakCycle[] = [];
  for (let n = 0; n < currentCycleNumber; n++) {
    const startDate = addDays(data.appStartDate, n * 7);
    pastCycles.push(buildCycle(n, startDate, data.dailySteps));
  }

  // Derive total points from all cycles
  const totalPoints =
    pastCycles.reduce((sum, c) => sum + c.pointsAwarded, 0) +
    newCurrentCycle.pointsAwarded;

  return { ...data, currentCycle: newCurrentCycle, pastCycles, totalPoints };
};

// ─── Public write helpers ─────────────────────────────────────────────────────

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

// Update steps for a specific date and rebuild cycles
export const setStepsForDate = (steps: number, date: string): void => {
  let data = getStoredData();
  const idx = data.dailySteps.findIndex((d) => d.date === date);
  if (idx >= 0) { data.dailySteps[idx].steps = steps; }
  else { data.dailySteps.push({ date, steps }); }
  data = rebuildCycles(data);
  saveData(data);
};

// Backwards-compatible helper
export const addDailySteps = (steps: number): void => {
  setStepsForDate(steps, getLocalDateString());
};

// Batch-update multiple dates then rebuild once (used by backfill)
export const batchUpdateSteps = (updates: DailySteps[]): void => {
  let data = getStoredData();
  updates.forEach(({ date, steps }) => {
    const idx = data.dailySteps.findIndex((d) => d.date === date);
    if (idx >= 0) { data.dailySteps[idx].steps = steps; }
    else { data.dailySteps.push({ date, steps }); }
  });
  data = rebuildCycles(data);
  saveData(data);
};
