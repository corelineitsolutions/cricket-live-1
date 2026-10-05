'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest, type PaginationMeta, type RequestOptions } from './api';

export interface ApiState<T> {
  data: T | null;
  meta: PaginationMeta | undefined;
  error: ApiError | null;
  /** True only until the first response arrives. */
  loading: boolean;
  /** True during any request, including background refreshes. */
  refreshing: boolean;
  lastLoadedAt: number | null;
  reload: () => void;
}

/**
 * GET with optional polling. Polling pauses while the tab is hidden, and the previous
 * data stays on screen during refreshes and after a failed refresh.
 */
export function useApi<T>(path: string | null, options: { query?: RequestOptions['query']; pollMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<PaginationMeta | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  /** Key of the last request that finished (success or error). */
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const queryKey = JSON.stringify(options.query ?? {});
  const requestKey = path ? `${path}?${queryKey}#${tick}` : null;

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      return;
    }
    const key = `${path}?${queryKey}#${tick}`;
    const controller = new AbortController();
    apiRequest<T>(path, { query: JSON.parse(queryKey) as RequestOptions['query'], signal: controller.signal })
      .then((result) => {
        setData(result.data);
        setMeta(result.meta);
        setError(null);
        setLastLoadedAt(Date.now());
        setSettledKey(key);
      })
      .catch((caught: unknown) => {
        if ((caught as Error).name === 'AbortError') {
          return;
        }
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', 'Unexpected error'));
        setSettledKey(key);
      });
    return () => controller.abort();
  }, [path, queryKey, tick]);

  const loading = settledKey === null;
  const refreshing = requestKey !== null && settledKey !== requestKey;

  useEffect(() => {
    if (!options.pollMs) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        reload();
      }
    }, options.pollMs);
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [options.pollMs, reload]);

  return { data, meta, error, loading, refreshing, lastLoadedAt, reload };
}

/** Re-renders every `intervalMs` so relative times ("12 s ago") stay current. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Value that only changes after it has been stable for `delayMs`. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
