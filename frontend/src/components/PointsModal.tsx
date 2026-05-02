import React, { useState } from 'react';
import { UserData, StreakCycle } from '../types';
import { recalculateFromScratch } from '../utils/syncManager';
import { getLocalDateString } from '../utils/dateUtils';
import '../styles/PointsModal.css';

interface Props {
  data: UserData;
  isAuthenticated: boolean;
  onClose: () => void;
  onRecalculated: () => void;
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Returns a motivational nudge based on what bonuses are still achievable this week
const getWeekMotivation = (cycle: StreakCycle): string => {
  const today = getLocalDateString();
  const pastAndToday = cycle.days.filter((d) => d.date <= today);
  const missedCount = cycle.days.filter((d) => d.status === 'missed').length;
  const completedCount = cycle.days.filter((d) => d.status === 'complete').length;
  const remainingCount = cycle.days.filter((d) => d.date > today).length;

  // Current active consecutive run (from today backwards)
  let currentRun = 0;
  for (let i = pastAndToday.length - 1; i >= 0; i--) {
    if (pastAndToday[i].status === 'complete') currentRun++;
    else break;
  }

  if (completedCount === 0) return "Hit 8,000 steps today to start earning points!";

  if (!cycle.milestones.perfectWeek && missedCount === 0 && remainingCount > 0) {
    return `${remainingCount} day${remainingCount === 1 ? '' : 's'} left — miss none → 🏆 Perfect Week (+100 pts)!`;
  }
  if (!cycle.milestones.consecutive5 && currentRun >= 3) {
    const needed = 5 - currentRun;
    return needed > 0
      ? `${needed} more day${needed === 1 ? '' : 's'} in a row → ⚡ +50 pts bonus!`
      : "Keep the streak alive for ⚡ +50 pts!";
  }
  if (!cycle.milestones.consecutive3 && currentRun > 0) {
    const needed = 3 - currentRun;
    return needed > 0
      ? `${needed} more day${needed === 1 ? '' : 's'} in a row → 🔥 +30 pts bonus!`
      : "Keep the streak alive for 🔥 +30 pts!";
  }
  if (cycle.milestones.perfectWeek) return "🏆 Perfect week! You've earned every bonus available!";
  if (cycle.milestones.consecutive5) return "⚡ 5-in-a-row bonus earned! Gunning for perfect week?";
  if (cycle.milestones.consecutive3) return "🔥 3-in-a-row bonus earned! 2 more in a row → ⚡ +50 pts!";
  return "Keep going — every completed day earns 10 pts!";
};

const WeekDots: React.FC<{ cycle: StreakCycle }> = ({ cycle }) => (
  <div className="pm-week-dots">
    {cycle.days.map((day, i) => (
      <div key={day.date} className="pm-week-dot-col">
        <div className={`pm-dot pm-dot--${day.status}`} />
        <span className="pm-dot-label">{DAY_LABELS[i]}</span>
      </div>
    ))}
  </div>
);

const PointsModal: React.FC<Props> = ({ data, isAuthenticated, onClose, onRecalculated }) => {
  const [recalcState, setRecalcState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  const handleRecalculate = async () => {
    setRecalcState('running');
    try {
      await recalculateFromScratch();
      setRecalcState('done');
      onRecalculated();
      setTimeout(() => setRecalcState('idle'), 2500);
    } catch {
      setRecalcState('error');
      setTimeout(() => setRecalcState('idle'), 3000);
    }
  };

  const { currentCycle, pastCycles, totalPoints, firstOpenDate } = data;
  const recentPast = [...pastCycles].reverse().slice(0, 5);
  const motivation = getWeekMotivation(currentCycle);

  return (
    <div className="pm-backdrop" onClick={onClose}>
      <div className="pm-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pm-header">
          <span className="pm-title">💎 {totalPoints.toLocaleString()} pts</span>
          <button className="pm-close" onClick={onClose}>✕</button>
        </div>

        {/* Formula */}
        <section className="pm-section">
          <div className="pm-section-title">How you earn points</div>
          <div className="pm-formula-grid">
            <span className="pm-formula-icon">✅</span>
            <span className="pm-formula-pts">10 pts</span>
            <span className="pm-formula-desc">Each day you hit 8,000 steps</span>

            <span className="pm-formula-icon">🔥</span>
            <span className="pm-formula-pts">+30 pts</span>
            <span className="pm-formula-desc">3 days in a row (bonus)</span>

            <span className="pm-formula-icon">⚡</span>
            <span className="pm-formula-pts">+50 pts</span>
            <span className="pm-formula-desc">5 days in a row (bonus)</span>

            <span className="pm-formula-icon">🏆</span>
            <span className="pm-formula-pts">+100 pts</span>
            <span className="pm-formula-desc">Perfect week — all 7 days</span>
          </div>
        </section>

        {/* This week */}
        <section className="pm-section">
          <div className="pm-section-title">This week</div>
          <WeekDots cycle={currentCycle} />
          <div className="pm-week-pts">
            {currentCycle.milestones.consecutive3 && <span className="pm-badge">🔥 3-in-a-row</span>}
            {currentCycle.milestones.consecutive5 && <span className="pm-badge">⚡ 5-in-a-row</span>}
            {currentCycle.milestones.perfectWeek && <span className="pm-badge">🏆 Perfect!</span>}
            <span className="pm-week-earned">{currentCycle.pointsAwarded} pts this week</span>
          </div>
          <div className="pm-motivation">{motivation}</div>
        </section>

        {/* Past weeks */}
        {recentPast.length > 0 && (
          <section className="pm-section">
            <div className="pm-section-title">Recent weeks</div>
            <div className="pm-past-list">
              {recentPast.map((cycle) => (
                <div key={cycle.startDate} className="pm-past-row">
                  <div className="pm-past-dots">
                    {cycle.days.map((d) => (
                      <span key={d.date} className={`pm-mini-dot pm-mini-dot--${d.status}`} />
                    ))}
                  </div>
                  <span className="pm-past-pts">{cycle.pointsAwarded} pts</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recalculate */}
        {isAuthenticated && (
          <section className="pm-section pm-section--last">
            <button
              className={`pm-recalc-btn pm-recalc-btn--${recalcState}`}
              onClick={handleRecalculate}
              disabled={recalcState === 'running'}
            >
              {recalcState === 'idle' && '🔄 Sync Full History from Google Fit'}
              {recalcState === 'running' && '⏳ Syncing all history…'}
              {recalcState === 'done' && '✓ Done! Points recalculated'}
              {recalcState === 'error' && '✕ Sync failed — try again'}
            </button>
            <p className="pm-recalc-hint">
              Re-fetches every day since {firstOpenDate} to ensure your points match across all devices.
            </p>
          </section>
        )}
      </div>
    </div>
  );
};

export default PointsModal;
