import React, { useEffect, useRef } from 'react';
import { StreakCycle, DayStatus } from '../types';
import '../styles/StreakDots.css';

interface StreakDotsProps {
  cycle: StreakCycle;
  totalPoints: number;
  onCelebrationDone?: () => void;
}

const DOT_LABELS = ['1', '2', '3', '4', '5', '6', '7'];

const DOT_SIZE = 32;
const DOT_GAP = 6;

const StreakDots: React.FC<StreakDotsProps> = ({ cycle, totalPoints, onCelebrationDone }) => {
  // Initialize with current state so no false animations fire on first mount
  const prevDaysRef = useRef<DayStatus[]>(cycle.days.map((d) => d.status));
  const prevMilestonesRef = useRef(cycle.milestones);

  // Detect newly-completed dots and milestone events after each render
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

  return (
    <div className="streak-dots-bar">
      <div className="streak-dots-track">
        {/* Grey baseline + green progress line */}
        <div className="streak-line-bg" />
        <div className="streak-line-progress" style={{ width: progressLineWidth }} />
        {cycle.days.map((day, i) => (
          <div
            key={day.date}
            id={`dot-${i}`}
            className={`streak-dot streak-dot--${day.status}`}
            title={`Day ${i + 1} · ${day.date}`}
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
