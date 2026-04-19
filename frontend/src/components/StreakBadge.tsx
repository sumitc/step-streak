import React from 'react';
import '../styles/StreakBadge.css';

interface StreakBadgeProps {
  currentStreak: number;
  longestStreak: number;
}

const StreakBadge: React.FC<StreakBadgeProps> = ({ currentStreak, longestStreak }) => {
  return (
    <div className="streak-inline">
      <span className="streak-item">🔥 {currentStreak} day streak</span>
      <span className="streak-divider">•</span>
      <span className="streak-item">⭐ Best: {longestStreak} days</span>
    </div>
  );
};

export default StreakBadge;
