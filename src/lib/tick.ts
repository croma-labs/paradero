import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `ms`. Pass it to anything computed from the clock: with the React Compiler on,
 * a component that only re-renders keeps the memoized result of a call that reads Date.now() inside.
 */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
