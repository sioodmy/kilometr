import { useCallback, useEffect, useState } from 'react';
import { useActiveCity } from './cityStore';
import { loadLineTimetable, type LineTimetableLookupOptions } from './lineTimetable';

export function useLineTimetable(
  routeId: string,
  date: string,
  options?: LineTimetableLookupOptions,
) {
  const { cityId } = useActiveCity();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadLineTimetable>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const tripId = options?.tripId;
  const line = options?.line;
  const mode = options?.mode;
  const dbTarget = options?.dbTarget;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    void loadLineTimetable(routeId, date, { tripId, line, mode, dbTarget })
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
  }, [routeId, date, cityId, attempt, tripId, line, mode, dbTarget]);

  return { data, loading, error, retry };
}
