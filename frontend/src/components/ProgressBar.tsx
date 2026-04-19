import React from 'react';
import '../styles/ProgressBar.css';

interface ProgressBarProps {
  current: number;
  goal: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ current, goal }) => {
  const percentage = Math.min((current / goal) * 100, 100);

  return (
    <div className="progress-bar-container">
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      <p className="progress-text">{Math.round(percentage)}%</p>
    </div>
  );
};

export default ProgressBar;
