import React, { useState, useEffect } from 'react';
import { UserData } from '../types';
import { getStoredData, addDailySteps } from '../utils/storage';
import { getStepsFromGoogleFit, syncStepsFromBackend } from '../utils/googleFit';
import '../styles/Dashboard.css';

const GOAL = 8000;

const Dashboard: React.FC = () => {
  const [data, setData] = useState<UserData | null>(null);
  const [todaySteps, setTodaySteps] = useState(0);
  const [stepsInput, setStepsInput] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const userData = getStoredData();
        setData(userData);

        const today = new Date().toISOString().split('T')[0];
        const todayData = userData.dailySteps.find((d) => d.date === today);
        if (todayData) {
          setTodaySteps(todayData.steps);
          if (todayData.steps >= GOAL) setCelebrating(true);
        }

        const params = new URLSearchParams(window.location.search);
        if (params.has('auth') && params.get('auth') === 'success') {
          setIsAuthenticated(true);
          window.history.replaceState({}, document.title, window.location.pathname);
          try {
            const steps = await syncStepsFromBackend();
            if (steps > 0) {
              addDailySteps(steps);
              setTodaySteps(steps);
              if (steps >= GOAL) setCelebrating(true);
              setData(getStoredData());
            }
          } catch (error) {
            console.error('Error syncing steps after OAuth:', error);
          }
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setData({
          dailySteps: [],
          streakData: { currentStreak: 0, longestStreak: 0, lastUpdateDate: new Date().toISOString().split('T')[0] },
          rewards: [{ days: 3, earned: false }, { days: 5, earned: false }, { days: 7, earned: false }],
          lastSyncDate: new Date().toISOString(),
        });
      }
    };
    initializeApp();
  }, []);

  const handleAddSteps = () => {
    const steps = parseInt(stepsInput, 10);
    if (!isNaN(steps) && steps > 0) {
      const newTotal = todaySteps + steps;
      addDailySteps(newTotal);
      setTodaySteps(newTotal);
      setStepsInput('');
      setShowManualEntry(false);
      if (newTotal >= GOAL && todaySteps < GOAL) setCelebrating(true);
      setData(getStoredData());
    }
  };

  const handleGoogleFitSync = async () => {
    setSyncLoading(true);
    try {
      if (!isAuthenticated) {
        await getStepsFromGoogleFit();
      } else {
        const steps = await syncStepsFromBackend();
        if (steps > 0) {
          addDailySteps(steps);
          setTodaySteps(steps);
          if (steps >= GOAL) setCelebrating(true);
          setData(getStoredData());
        }
      }
    } catch (error) {
      console.error('Sync error:', error);
    }
    setSyncLoading(false);
  };

  if (!data) return <div className="loading">Loading...</div>;

  const percentage = Math.min((todaySteps / GOAL) * 100, 100);
  const exceeded = todaySteps > GOAL;
  const overSteps = todaySteps - GOAL;
  const circumference = 2 * Math.PI * 90;
  const strokeOffset = circumference - (percentage / 100) * circumference;
  const currentStreak = data.streakData.currentStreak;
  const longestStreak = data.streakData.longestStreak;

  const getBadge = (days: number) => {
    const reward = data.rewards.find(r => r.days === days);
    const earned = reward?.earned || false;
    const emoji = days === 3 ? '🥉' : days === 5 ? '🥈' : '🥇';
    return { emoji, earned, days };
  };

  return (
    <div className={`dashboard ${celebrating ? 'celebrate' : ''}`}>
      {/* Row 1: Header with sync icon */}
      <header className="header-row">
        <div className="header-text">
          <h1>Step Streak</h1>
          <p>Daily 8K step challenge</p>
        </div>
        <button
          className={`sync-btn ${syncLoading ? 'syncing' : ''}`}
          onClick={handleGoogleFitSync}
          disabled={syncLoading}
          title={isAuthenticated ? 'Sync Google Fit' : 'Connect Google Fit'}
        >
          {syncLoading ? '⏳' : '🔄'}
        </button>
      </header>

      {/* Row 2: Streak + Badges */}
      <div className="stats-row">
        <div className="streak-pill">
          <span>🔥 {currentStreak}d</span>
          <span className="streak-sep">|</span>
          <span>⭐ {longestStreak}d best</span>
        </div>
        <div className="badges-row">
          {[3, 5, 7].map(d => {
            const b = getBadge(d);
            return (
              <div key={d} className={`badge ${b.earned ? 'earned' : 'locked'}`} title={`${d}-day streak`}>
                <span className="badge-emoji">{b.emoji}</span>
                <span className="badge-label">{d}d</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main: Circular progress */}
      <div className="ring-section">
        <div className="ring-container">
          <svg viewBox="0 0 200 200" className="progress-ring">
            <circle className="ring-bg" cx="100" cy="100" r="90" />
            <circle
              className={`ring-fill ${exceeded ? 'exceeded' : ''}`}
              cx="100" cy="100" r="90"
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
            />
          </svg>
          <div className="ring-content">
            {exceeded ? (
              <>
                <div className="step-number exceeded">{todaySteps.toLocaleString()}</div>
                <div className="step-label">🎉 +{overSteps.toLocaleString()} bonus!</div>
              </>
            ) : (
              <>
                <div className="step-number">{todaySteps.toLocaleString()}</div>
                <div className="step-label">{(GOAL - todaySteps).toLocaleString()} to go</div>
              </>
            )}
          </div>
        </div>
        <div className="goal-label">{Math.round(percentage)}% of {GOAL.toLocaleString()} steps</div>
      </div>

      {/* Celebration overlay */}
      {celebrating && exceeded && (
        <div className="celebration">
          <div className="confetti">🎊</div>
          <p>You crushed it! {todaySteps.toLocaleString()} steps!</p>
          <button className="dismiss-btn" onClick={() => setCelebrating(false)}>Nice! 👏</button>
        </div>
      )}

      {/* Manual entry toggle */}
      <div className="manual-section">
        {!showManualEntry ? (
          <button className="manual-toggle" onClick={() => setShowManualEntry(true)}>
            ✏️ Enter steps manually
          </button>
        ) : (
          <div className="manual-input-row">
            <input
              type="number"
              value={stepsInput}
              onChange={(e) => setStepsInput(e.target.value)}
              placeholder="Steps to add"
              onKeyDown={(e) => e.key === 'Enter' && handleAddSteps()}
              autoFocus
            />
            <button className="add-btn" onClick={handleAddSteps}>+</button>
            <button className="cancel-btn" onClick={() => setShowManualEntry(false)}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
