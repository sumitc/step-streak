import React, { useEffect, useRef, useState } from 'react';
import '../styles/PointsCounter.css';

interface PointsCounterProps {
  points: number;
  animate?: boolean; // trigger count-up when true
  onAnimationDone?: () => void;
}

const PointsCounter: React.FC<PointsCounterProps> = ({ points, animate, onAnimationDone }) => {
  const [displayed, setDisplayed] = useState(points);
  const prevPointsRef = useRef(points);
  const rafRef = useRef<number | null>(null);
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    const prev = prevPointsRef.current;
    if (points === prev) return;

    // Cancel any running animation
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const delta = points - prev;
    if (delta <= 0) {
      setDisplayed(points);
      prevPointsRef.current = points;
      return;
    }

    // Animate count-up over ~800ms
    setGlowing(true);
    const duration = 800;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayed(Math.round(prev + delta * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayed(points);
        prevPointsRef.current = points;
        setGlowing(false);
        onAnimationDone?.();
      }
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [points]);

  return (
    <div className={`points-counter ${glowing ? 'points-counter--glow' : ''}`} title="Your points">
      <span className="points-counter__icon">💎</span>
      <span className="points-counter__value">{displayed.toLocaleString()}</span>
    </div>
  );
};

export default PointsCounter;
