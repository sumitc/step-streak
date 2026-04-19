import React from 'react';
import { Reward } from '../types';
import '../styles/RewardCard.css';

interface RewardCardProps {
  reward: Reward;
}

const RewardCard: React.FC<RewardCardProps> = ({ reward }) => {
  const getRewardEmoji = (days: number): string => {
    switch (days) {
      case 3:
        return '🥉';
      case 5:
        return '🥈';
      case 7:
        return '🥇';
      default:
        return '⭐';
    }
  };

  return (
    <div className={`reward-card ${reward.earned ? 'earned' : 'locked'}`}>
      <div className="reward-emoji">{getRewardEmoji(reward.days)}</div>
      <h4>{reward.days}-Day Streak</h4>
      {reward.earned ? (
        <p className="earned-text">✓ Unlocked</p>
      ) : (
        <p className="locked-text">Locked</p>
      )}
    </div>
  );
};

export default RewardCard;
