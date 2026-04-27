import React, { useState, useEffect, useRef } from 'react';
import { DailySteps, StreakCycle } from '../types';
import { getLocalDateString } from '../utils/dateUtils';
import { syncStepsBatch } from '../utils/googleFit';
import { batchUpdateSteps } from '../utils/storage';
import '../styles/MonthChart.css';

const GOAL = 8000;
const CHART_HEIGHT = 130;

// ─── Pure date helpers ────────────────────────────────────────────────────────

const getWeekMondayFor = (dateStr: string): string => {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return getLocalDateString(d);
};

const getDaysInMonth = (monthDate: string): string[] => {
  const [year, month] = monthDate.split('-').map(Number);
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, i) =>
    `${monthDate}-${String(i + 1).padStart(2, '0')}`
  );
};

const shiftMonth = (m: string, delta: number): string => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Points from cycles whose Monday falls in this month
const computeMonthPoints = (
  monthDate: string,
  pastCycles: StreakCycle[],
  currentCycle: StreakCycle,
  firstOpenDate: string
): number | null => {
  const [year, month] = monthDate.split('-').map(Number);
  const firstTrackedWeek = getWeekMondayFor(firstOpenDate);
  const allCycles = [...pastCycles, currentCycle];
  let total = 0;
  let hasTracked = false;

  for (const cycle of allCycles) {
    const [cy, cm] = cycle.startDate.split('-').map(Number);
    if (cy !== year || cm !== month) continue;
    if (cycle.startDate >= firstTrackedWeek) {
      hasTracked = true;
      total += cycle.pointsAwarded;
    }
  }
  return hasTracked ? total : null;
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  monthDate: string;
  dailySteps: DailySteps[];
  todaySteps: number;
  pastCycles: StreakCycle[];
  currentCycle: StreakCycle;
  firstOpenDate: string;
  isAuthenticated: boolean;
  userId: string;
  onClose: () => void;
  onMonthChange: (m: string) => void;
  onDataFetched: () => void;
}

const MonthChart: React.FC<Props> = ({
  monthDate, dailySteps, todaySteps, pastCycles, currentCycle,
  firstOpenDate, isAuthenticated, userId,
  onClose, onMonthChange, onDataFetched,
}) => {
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(false);

  const today = getLocalDateString();
  const currentYearMonth = today.substring(0, 7);

  const days = getDaysInMonth(monthDate);
  const stepsMap = new Map(dailySteps.map((d) => [d.date, d.steps]));
  if (monthDate === currentYearMonth) stepsMap.set(today, todaySteps);

  const dayData = days.map((date) => ({
    date,
    steps: date <= today ? (stepsMap.has(date) ? stepsMap.get(date)! : null) : null,
    isToday: date === today,
    isFuture: date > today,
  }));

  // Pull-fetch missing past dates for this month
  useEffect(() => {
    cancelRef.current = false;
    if (!isAuthenticated) return;

    const missingDates = dayData
      .filter((d) => d.steps === null && !d.isFuture)
      .map((d) => d.date);

    if (missingDates.length === 0) return;

    setLoading(true);
    syncStepsBatch(missingDates, userId)
      .then((results) => {
        if (cancelRef.current) return;
        batchUpdateSteps(results);
        onDataFetched();
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelRef.current) setLoading(false);
      });

    return () => { cancelRef.current = true; };
  }, [monthDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const allStepValues = dayData
    .filter((d) => d.steps !== null && d.steps > 0)
    .map((d) => d.steps as number);
  const maxSteps = allStepValues.length > 0
    ? Math.max(GOAL * 1.3, Math.max(...allStepValues) * 1.1)
    : GOAL * 1.3;
  const goalLineBottom = Math.round((GOAL / maxSteps) * CHART_HEIGHT);

  const monthPoints = computeMonthPoints(monthDate, pastCycles, currentCycle, firstOpenDate);
  const monthLabel = new Date(`${monthDate}-15T12:00:00`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const prevM = shiftMonth(monthDate, -1);
  const nextM = shiftMonth(monthDate, 1);

  return (
    <div className="month-overlay">
      <div className="month-inner">

        {/* Navigation */}
        <div className="month-nav">
          <button className="month-nav-btn" onClick={() => onMonthChange(prevM)}>‹</button>
          <div className="month-title-wrap">
            <span className="month-title">{monthLabel}</span>
            {monthPoints !== null && (
              <span className="month-points-badge">🏆 {monthPoints} pts</span>
            )}
          </div>
          <button
            className="month-nav-btn"
            onClick={() => onMonthChange(nextM)}
            disabled={nextM > currentYearMonth}
          >›</button>
          <button className="month-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Bar chart */}
        <div className="month-chart-wrap">
          <div className="month-chart-area" style={{ height: `${CHART_HEIGHT}px` }}>
            {/* Goal line */}
            <div className="month-goal-line" style={{ bottom: `${goalLineBottom}px` }}>
              <span className="month-goal-label">8k</span>
            </div>
            {/* Bars */}
            <div className="month-bars">
              {dayData.map(({ date, steps, isToday }) => {
                const barH = steps === null
                  ? 0
                  : steps === 0
                    ? 1
                    : Math.max(2, (steps / maxSteps) * CHART_HEIGHT);
                const barClass = steps === null
                  ? 'empty'
                  : steps >= GOAL
                    ? 'green'
                    : isToday
                      ? 'today-bar'
                      : 'grey';
                return (
                  <div key={date} className={`month-bar-col${isToday ? ' col-today' : ''}`}>
                    <div className={`month-bar ${barClass}`} style={{ height: `${barH}px` }} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Day tick labels */}
          <div className="month-day-labels">
            {dayData.map(({ date }) => {
              const dayNum = parseInt(date.split('-')[2], 10);
              const show = dayNum === 1 || dayNum % 5 === 0;
              return (
                <div key={date} className="month-day-tick">
                  {show ? dayNum : ''}
                </div>
              );
            })}
          </div>
        </div>

        {loading && <div className="month-loading">⏳ Loading history…</div>}
        {!isAuthenticated && (
          <div className="month-no-auth">Connect Google Fit to load step history</div>
        )}

      </div>
    </div>
  );
};

export default MonthChart;
