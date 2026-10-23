import { useCallback, useEffect, useRef, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface CursorPageShape<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

/**
 * Cursor-paginated list state with request-order protection so stale
 * responses never overwrite newer ones.
 */
export function useCursorQuery<T>(
  fetcher: (cursor: string | null) => Promise<CursorPageShape<T>>,
  deps: unknown[]
) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const page = await fetcherRef.current(null);
      if (id !== requestId.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      setError(null);
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, deps);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const id = ++requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetcherRef.current(nextCursor);
      if (id !== requestId.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (id === requestId.current) setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { items, setItems, nextCursor, total, loading, loadingMore, error, refresh, loadMore };
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, value === true ? "1" : String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}
