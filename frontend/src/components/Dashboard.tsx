import React, { useState, useEffect } from 'react';
import { UserData } from '../types';
import { getStoredData, addDailySteps } from '../utils/storage';
import { getStepsFromGoogleFit, syncStepsFromBackend } from '../utils/googleFit';
import ProgressBar from './ProgressBar';
import StreakBadge from './StreakBadge';
import RewardCard from './RewardCard';
import '../styles/Dashboard.css';

const Dashboard: React.FC = () => {
  const [data, setData] = useState<UserData | null>(null);
  const [todaySteps, setTodaySteps] = useState(0);
  const [stepsInput, setStepsInput] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const userData = getStoredData();
        setData(userData);

        const today = new Date().toISOString().split('T')[0];
        const todayData = userData.dailySteps.find((d) => d.date === today);
        if (todayData) {
          setTodaySteps(todayData.steps);
        }

        // Check if authenticated (after OAuth redirect from backend)
        const params = new URLSearchParams(window.location.search);
        if (params.has('auth') && params.get('auth') === 'success') {
          const userId = params.get('userId') || 'default_user';
          // Token was already stored by backend, just fetch steps
          setIsAuthenticated(true);
          window.history.replaceState({}, document.title, window.location.pathname);
          try {
            const steps = await syncStepsFromBackend();
            if (steps > 0) {
              addDailySteps(steps);
              setTodaySteps(steps);
              const updatedData = getStoredData();
              setData(updatedData);
              alert(`✅ Synced! Today's steps: ${steps.toLocaleString()}`);
            }
          } catch (error) {
            console.error('Error syncing steps after OAuth:', error);
          }
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setData({
          dailySteps: [],
          streakData: {
            currentStreak: 0,
            longestStreak: 0,
            lastUpdateDate: new Date().toISOString().split('T')[0],
          },
          rewards: [
            { days: 3, earned: false },
            { days: 5, earned: false },
            { days: 7, earned: false },
          ],
          lastSyncDate: new Date().toISOString(),
        });
      }
    };
    
    initializeApp();
  }, []);


  const handleAddSteps = () => {
    const steps = parseInt(stepsInput, 10);
    if (!isNaN(steps) && steps > 0) {
      addDailySteps(steps);
      setTodaySteps(steps);
      setStepsInput('');
      const updatedData = getStoredData();
      setData(updatedData);
    }
  };

  const handleGoogleFitSync = async () => {
    setSyncLoading(true);
    try {
      if (!isAuthenticated) {
        // Initiate login
        await getStepsFromGoogleFit();
      } else {
        // Fetch steps
        const steps = await syncStepsFromBackend();
        if (steps > 0) {
          addDailySteps(steps);
          setTodaySteps(steps);
          const updatedData = getStoredData();
          setData(updatedData);
          alert(`✅ Synced! Today's steps: ${steps.toLocaleString()}`);
        } else {
          alert('No step data found for today.');
        }
      }
    } catch (error) {
      console.error('Sync error:', error);
      alert('Failed to sync. Make sure backend is running on port 5000.');
    }
    setSyncLoading(false);
  };

  if (!data) {
    return <div className="loading">Loading...</div>;
  }

  const stepsRemaining = Math.max(0, 8000 - todaySteps);
  const goalReached = todaySteps >= 8000;

  return (
    <div className="dashboard">
      <header className="header">
        <h1>Step Streak</h1>
        <p>Build your daily walking habit</p>
      </header>

      <div className="main-content">
        <div className="step-section">
          <div className="step-count">
            <h2>{todaySteps.toLocaleString()}</h2>
            <p>Steps today</p>
          </div>

          <ProgressBar current={todaySteps} goal={8000} />

          {!goalReached ? (
            <div className="steps-remaining">
              <p className="remaining-text">
                {stepsRemaining.toLocaleString()} steps to go!
              </p>
            </div>
          ) : (
            <div className="goal-reached">
              <p>🎉 Goal reached for today!</p>
            </div>
          )}
        </div>

        <StreakBadge
          currentStreak={data.streakData.currentStreak}
          longestStreak={data.streakData.longestStreak}
        />

        <div className="input-section">
          <input
            type="number"
            value={stepsInput}
            onChange={(e) => setStepsInput(e.target.value)}
            placeholder="Enter steps manually"
            onKeyPress={(e) => e.key === 'Enter' && handleAddSteps()}
          />
          <button onClick={handleAddSteps}>Add Steps</button>
        </div>

        <div className="google-section">
          <button 
            onClick={handleGoogleFitSync}
            disabled={syncLoading}
            className="google-signin-btn"
          >
            {syncLoading ? 'Syncing...' : (isAuthenticated ? '✓ Sync with Google Fit' : '📱 Connect Google Fit')}
          </button>
        </div>

        <div className="rewards-section">
          <h3>Milestones</h3>
          <div className="rewards-grid">
            {data.rewards.map((reward) => (
              <RewardCard key={reward.days} reward={reward} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
