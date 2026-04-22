import React, { useEffect, useRef, useState } from 'react';
import { StreakCycle, DayStatus, CycleDay } from '../types';
import { getLocalDateString } from '../utils/dateUtils';
import '../styles/StreakDots.css';

interface StreakDotsProps {
  cycle: StreakCycle;
  totalPoints: number;
  onDaySelect?: (date: string | null) => void;
  onCelebrationDone?: () => void;
}

const DOT_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const DOT_SIZE = 32;
const DOT_GAP = 6;

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const StreakDots: React.FC<StreakDotsProps> = ({ cycle, onDaySelect, onCelebrationDone }) => {
  const prevDaysRef = useRef<DayStatus[]>(cycle.days.map((d) => d.status));
  const prevMilestonesRef = useRef(cycle.milestones);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const today = getLocalDateString();

  useEffect(() => {
    const prev = prevDaysRef.current;
    const newlyComplete: number[] = [];

    cycle.days.forEach((day, i) => {
      if (day.status === 'complete' && prev[i] !== 'complete') {
        newlyComplete.push(i);
      }
    });

    const m = cycle.milestones;
    const pm = prevMilestonesRef.current;
    const newMilestone =
      (!pm.consecutive3 && m.consecutive3) ? '+30'
      : (!pm.consecutive5 && m.consecutive5) ? '+50'
      : (!pm.perfectWeek && m.perfectWeek) ? 'perfect'
      : null;

    if (newlyComplete.length > 0) {
      newlyComplete.forEach((i) => triggerDotPop(i));
    }
    if (newMilestone === 'perfect') {
      setTimeout(() => triggerPerfectWeek(onCelebrationDone), 300);
    } else if (newMilestone) {
      setTimeout(() => triggerMilestoneBurst(newMilestone), 300);
    }

    prevDaysRef.current = cycle.days.map((d) => d.status);
    prevMilestonesRef.current = { ...cycle.milestones };
  });

  const lastCompleteIdx = cycle.days.reduce((last, d, i) => d.status === 'complete' ? i : last, -1);
  const progressLineWidth = lastCompleteIdx >= 0 ? lastCompleteIdx * (DOT_SIZE + DOT_GAP) : 0;

  const getDotClass = (day: CycleDay, i: number): string => {
    const isToday = day.date === today && day.status === 'pending';
    const base = isToday ? 'streak-dot streak-dot--today' : `streak-dot streak-dot--${day.status}`;
    return selectedIdx === i ? `${base} streak-dot--selected` : base;
  };

  const handleDotClick = (day: CycleDay, i: number) => {
    const next = selectedIdx === i ? null : i;
    setSelectedIdx(next);
    onDaySelect?.(next !== null ? day.date : null);
  };

  return (
    <div className="streak-dots-bar">
      <div className="streak-dots-track">
        <div className="streak-line-bg" />
        <div className="streak-line-progress" style={{ width: progressLineWidth }} />
        {cycle.days.map((day, i) => (
          <div
            key={day.date}
            id={`dot-${i}`}
            className={getDotClass(day, i)}
            title={formatDate(day.date)}
            onClick={() => handleDotClick(day, i)}
          >
            {day.status === 'complete' ? '✓' : day.status === 'missed' ? '✕' : DOT_LABELS[i]}
          </div>
        ))}
      </div>
      <div id="milestone-burst" className="milestone-burst hidden" />
    </div>
  );
};

// ─── Animation helpers ────────────────────────────────────────────────────────

function triggerDotPop(index: number) {
  const el = document.getElementById(`dot-${index}`);
  if (!el) return;
  el.classList.remove('dot-pop');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('dot-pop');
  el.addEventListener('animationend', () => el.classList.remove('dot-pop'), { once: true });
}

function triggerMilestoneBurst(label: string) {
  const el = document.getElementById('milestone-burst');
  if (!el) return;
  el.textContent = label;
  el.classList.remove('hidden', 'burst-fade');
  void el.offsetWidth;
  el.classList.add('burst-fade');
  el.addEventListener('animationend', () => el.classList.add('hidden'), { once: true });
}

function triggerPerfectWeek(onDone?: () => void) {
  // Spawn confetti then notify parent to show points animation
  spawnConfetti();
  const el = document.getElementById('milestone-burst');
  if (el) {
    el.textContent = '🎉 Perfect Week!';
    el.classList.remove('hidden', 'burst-fade', 'burst-big');
    void el.offsetWidth;
    el.classList.add('burst-big');
    el.addEventListener(
      'animationend',
      () => {
        el.classList.add('hidden');
        el.classList.remove('burst-big');
        onDone?.();
      },
      { once: true }
    );
  } else {
    onDone?.();
  }
}

function spawnConfetti() {
  const colors = ['#4CAF50', '#FFD700', '#FF6B6B', '#64B5F6', '#CE93D8'];
  const container = document.body;
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.8}s`;
    piece.style.animationDuration = `${1.2 + Math.random() * 0.8}s`;
    container.appendChild(piece);
    piece.addEventListener('animationend', () => piece.remove(), { once: true });
  }
}

export default StreakDots;
