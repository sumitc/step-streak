import { UserData, DailySteps, StreakCycle, CycleDay, DayStatus } from '../types';
import { getLocalDateString } from './dateUtils';

const STORAGE_KEY = 'step_streak_data';
const SCHEMA_VERSION = 4;
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

// Returns the Monday of the ISO week containing dateStr
const getWeekMonday = (dateStr: string): string => {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
};

// ─── Cycle builders ──────────────────────────────────────────────────────────

const buildCycle = (
  startDate: string,       // always the Monday of the week
  dailySteps: DailySteps[],
  firstOpenDate: string    // days before this are pending, not missed
): StreakCycle => {
  const today = getLocalDateString();
  const stepsMap = new Map(dailySteps.map((d) => [d.date, d.steps]));
  const cycleNumber = Math.max(0, Math.round(daysBetween(getWeekMonday(firstOpenDate), startDate) / 7));

  const days: CycleDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startDate, i);
    let status: DayStatus;
    if (date > today) {
      status = 'pending';
    } else if (date === today) {
      const steps = stepsMap.get(date) ?? 0;
      status = steps >= STEPS_THRESHOLD ? 'complete' : 'pending';
    } else if (date < firstOpenDate) {
      // Before install: honour Google Fit data if synced; pending only if no data yet
      if (stepsMap.has(date)) {
        status = stepsMap.get(date)! >= STEPS_THRESHOLD ? 'complete' : 'missed';
      } else {
        status = 'pending';
      }
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
  let maxConsec = 0;
  let run = 0;
  for (const day of days) {
    if (day.status === 'complete') { run++; maxConsec = Math.max(maxConsec, run); }
    else { run = 0; }
  }
  const perfectWeek = days.filter((d) => d.date <= getLocalDateString()).every((d) => d.status === 'complete');
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

const migrateFromLegacy = (raw: any): UserData => {
  const today = getLocalDateString();
  const dailySteps: DailySteps[] = Array.isArray(raw.dailySteps) ? raw.dailySteps : [];
  const firstOpenDate = raw.firstOpenDate ?? raw.appStartDate ?? today;
  return {
    schemaVersion: 3, // will be bumped by migrateToV4
    dailySteps,
    firstOpenDate,
    totalPoints: 0,
    currentCycle: buildCycle(getWeekMonday(today), dailySteps, firstOpenDate),
    pastCycles: [],
    lastSyncDate: raw.lastSyncDate ?? new Date().toISOString(),
    lastSyncTimestamp: raw.lastSyncTimestamp ?? '',
    isAuthenticated: raw.isAuthenticated ?? false,
    userId: raw.userId ?? 'default_user',
  };
};

// v2/v3 → v4: switch from personal anchor to Mon–Sun calendar weeks
const migrateToV4 = (data: any): UserData => {
  const today = getLocalDateString();
  const firstOpenDate = data.firstOpenDate ?? data.appStartDate ?? today;
  const migrated = { ...data, schemaVersion: 4, firstOpenDate } as UserData;
  delete (migrated as any).appStartDate;
  return rebuildCycles(migrated);
};

// ─── Core storage API ────────────────────────────────────────────────────────

const getDefaultData = (): UserData => {
  const today = getLocalDateString();
  return {
    schemaVersion: SCHEMA_VERSION,
    dailySteps: [],
    firstOpenDate: today,
    totalPoints: 0,
    currentCycle: buildCycle(getWeekMonday(today), [], today),
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
  if (!raw.schemaVersion || raw.schemaVersion < 4) {
    data = migrateFromLegacy(raw);
  } else {
    data = raw as UserData;
  }

  if (data.schemaVersion < SCHEMA_VERSION) {
    data = migrateToV4(data);
    saveData(data);
  }

  return data;
};

export const saveData = (data: UserData): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

// ─── Cycle management ────────────────────────────────────────────────────────

// Rebuild all cycles from dailySteps using Mon–Sun calendar weeks.
const rebuildCycles = (data: UserData): UserData => {
  const today = getLocalDateString();
  const currentWeekMonday = getWeekMonday(today);
  const firstWeekMonday = getWeekMonday(data.firstOpenDate);
  const totalPastWeeks = Math.max(0, Math.round(daysBetween(firstWeekMonday, currentWeekMonday) / 7));

  const pastCycles: StreakCycle[] = [];
  for (let i = 0; i < totalPastWeeks; i++) {
    const weekStart = addDays(firstWeekMonday, i * 7);
    pastCycles.push(buildCycle(weekStart, data.dailySteps, data.firstOpenDate));
  }

  const newCurrentCycle = buildCycle(currentWeekMonday, data.dailySteps, data.firstOpenDate);

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

export const setStepsForDate = (steps: number, date: string): void => {
  let data = getStoredData();
  const idx = data.dailySteps.findIndex((d) => d.date === date);
  if (idx >= 0) { data.dailySteps[idx].steps = steps; }
  else { data.dailySteps.push({ date, steps }); }
  data = rebuildCycles(data);
  saveData(data);
};

export const addDailySteps = (steps: number): void => {
  setStepsForDate(steps, getLocalDateString());
};

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

