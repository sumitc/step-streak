import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserData } from '../types';
import { getStoredData, addDailySteps, setAuthenticated } from '../utils/storage';
import { getStepsFromGoogleFit } from '../utils/googleFit';
import { syncOnOpen, syncBackfill, forceSyncToday } from '../utils/syncManager';
import { getLocalDateString } from '../utils/dateUtils';
import StreakDots from './StreakDots';
import PointsCounter from './PointsCounter';
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
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const syncStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initDone = useRef(false);

  const refreshFromStorage = useCallback(() => {
    const stored = getStoredData();
    const today = getLocalDateString();
    const todayData = stored.dailySteps.find((d) => d.date === today);
    setData(stored);
    setIsAuthenticated(stored.isAuthenticated);
    if (todayData) {
      setTodaySteps(todayData.steps);
      if (todayData.steps >= GOAL) setCelebrating(true);
    }
  }, []);

  const showSyncStatus = useCallback((status: 'done' | 'error') => {
    if (syncStatusTimer.current) clearTimeout(syncStatusTimer.current);
    setSyncStatus(status);
    syncStatusTimer.current = setTimeout(() => setSyncStatus('idle'), 2500);
  }, []);

  const runSync = useCallback(async () => {
    setSyncLoading(true);
    try {
      const { steps, synced } = await syncOnOpen();
      if (synced) {
        refreshFromStorage();
        setTodaySteps(steps);
        if (steps >= GOAL) setCelebrating(true);
        showSyncStatus('done');
      }
    } catch (err) {
      console.error('Sync error:', err);
      showSyncStatus('error');
    } finally {
      setSyncLoading(false);
    }
  }, [refreshFromStorage, showSyncStatus]);

  // Initial load + OAuth callback handling
  useEffect(() => {
    const initializeApp = async () => {
      try {
        refreshFromStorage();

        const params = new URLSearchParams(window.location.search);
        if (params.get('auth') === 'success') {
          const userId = params.get('userId') || 'default_user';
          setAuthenticated(userId);
          setIsAuthenticated(true);
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        await runSync();

        syncBackfill().then(() => refreshFromStorage()).catch(console.error);
      } catch (error) {
        console.error('Error initializing app:', error);
      }
    };

    initializeApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capacitor resume listener
  useEffect(() => {
    let removeListener: (() => void) | undefined;

    const setupCapacitorListener = async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive && initDone.current) runSync();
        });
        removeListener = () => handle.remove();
      } catch {
        // Not running inside Capacitor — skip silently
      }
      initDone.current = true;
    };

    setupCapacitorListener();
    return () => { removeListener?.(); };
  }, [runSync]);

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
        const { steps } = await forceSyncToday();
        if (steps > 0) {
          setTodaySteps(steps);
          if (steps >= GOAL) setCelebrating(true);
        }
        refreshFromStorage();
        syncBackfill().then(() => refreshFromStorage()).catch(console.error);
        showSyncStatus('done');
      }
    } catch (error) {
      console.error('Sync error:', error);
      showSyncStatus('error');
    } finally {
      setSyncLoading(false);
    }
  };

  if (!data) return <div className="loading">Loading...</div>;

  const today = getLocalDateString();
  const isViewingPast = viewingDate !== null && viewingDate !== today;
  const displaySteps = isViewingPast
    ? (data.dailySteps.find((d) => d.date === viewingDate)?.steps ?? 0)
    : todaySteps;
  const displayDate = new Date((viewingDate ?? today) + 'T12:00:00')
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const percentage = Math.min((displaySteps / GOAL) * 100, 100);
  const exceeded = displaySteps > GOAL;
  const overSteps = displaySteps - GOAL;
  const circumference = 2 * Math.PI * 90;
  const strokeOffset = circumference - (percentage / 100) * circumference;

  return (
    <>
      <div className={`dashboard ${celebrating ? 'celebrate' : ''}`}>
        {/* Header row: title + points */}
        <header className="header-row">
          <div className="header-text">
            <h1>Step Streak</h1>
            <p>Daily 8K step challenge</p>
          </div>
          <div className="header-right">
            <PointsCounter points={data.totalPoints} />
            <div className="sync-wrap">
              {syncStatus !== 'idle' && (
                <span className={`sync-status-chip ${syncStatus}`}>
                  {syncStatus === 'done' ? '✓ Synced' : '✕ Failed'}
                </span>
              )}
              <button
                className={`sync-btn ${syncLoading ? 'syncing' : ''}`}
                onClick={handleGoogleFitSync}
                disabled={syncLoading}
                title={isAuthenticated ? 'Sync Google Fit' : 'Connect Google Fit'}
              >
                {syncLoading ? (
                  <svg className="gfit-icon spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg className="gfit-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2.5c-2.1 0-3.8 1.7-3.8 3.8S9.9 10.1 12 10.1s3.8-1.7 3.8-3.8S14.1 2.5 12 2.5z" fill="#EA4335"/>
                    <path d="M6.3 10.1c-2.1 0-3.8 1.7-3.8 3.8s1.7 3.8 3.8 3.8 3.8-1.7 3.8-3.8-1.7-3.8-3.8-3.8z" fill="#FBBC05"/>
                    <path d="M17.7 10.1c-2.1 0-3.8 1.7-3.8 3.8s1.7 3.8 3.8 3.8 3.8-1.7 3.8-3.8-1.7-3.8-3.8-3.8z" fill="#34A853"/>
                    <path d="M12 17.9c-2.1 0-3.8 1.7-3.8 3.8H15.8c0-2.1-1.7-3.8-3.8-3.8z" fill="#4285F4"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* 7-day streak dots */}
        <StreakDots
          cycle={data.currentCycle}
          totalPoints={data.totalPoints}
          onDaySelect={(date) => setViewingDate(date)}
        />

        {/* Main: Circular progress */}
        <div className="ring-section">
          <div className="viewing-date-label">📅 {displayDate}</div>
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
                  <div className="step-number exceeded">{displaySteps.toLocaleString()}</div>
                  <div className="step-label">🎉 +{overSteps.toLocaleString()} bonus!</div>
                </>
              ) : (
                <>
                  <div className="step-number">{displaySteps.toLocaleString()}</div>
                  <div className="step-label">
                    {isViewingPast ? (displaySteps >= GOAL ? '✅ Goal met' : `${(GOAL - displaySteps).toLocaleString()} short`) : `${(GOAL - displaySteps).toLocaleString()} to go`}
                  </div>
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
      </div>

      {/* Manual entry */}
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
    </>
  );
};

export default Dashboard;

