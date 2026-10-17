import { useEffect, useState } from 'react';

export function useElapsed(start: string | undefined, active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, start]);
  const origin = start ? Date.parse(start) : NaN;
  return Number.isFinite(origin) ? Math.max(0, Math.floor((now - origin) / 1000)) : null;
}
