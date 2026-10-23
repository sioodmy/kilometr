import { useCallback, useEffect, useState } from 'react';
import { useActiveCity } from './cityStore';
import { loadLineTimetable } from './lineTimetable';

export function useLineTimetable(routeId: string, date: string) {
  const { cityId } = useActiveCity();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadLineTimetable>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    void loadLineTimetable(routeId, date)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, date, cityId, attempt]);

  return { data, loading, error, retry };
}
