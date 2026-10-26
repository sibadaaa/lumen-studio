import { ref, watch, type Ref } from "vue";

export function buildQuery(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, value === true ? "1" : String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}

/** Debounce a reactive value; returns a readonly-ish ref updated after `delay`. */
export function useDebouncedValue<T>(source: Ref<T>, delay = 300): Ref<T> {
  const debounced = ref(source.value) as Ref<T>;
  let timer: number | null = null;
  watch(
    source,
    (value) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        debounced.value = value;
        timer = null;
      }, delay);
    },
    { immediate: false }
  );
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
export function useCursorQuery<T>(fetcher: (cursor: string | null) => Promise<CursorPageShape<T>>) {
  const items = ref<T[]>([]) as Ref<T[]>;
  const nextCursor = ref<string | null>(null);
  const total = ref(0);
  const loading = ref(true);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  let requestId = 0;

  async function refresh() {
    const id = ++requestId;
    loading.value = true;
    loadingMore.value = false;
    try {
      const page = await fetcher(null);
      if (id !== requestId) return;
      items.value = page.items;
      nextCursor.value = page.nextCursor;
      total.value = page.total;
      error.value = null;
    } catch (err) {
      if (id === requestId) error.value = (err as Error).message;
    } finally {
      if (id === requestId) loading.value = false;
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) return;
    const id = ++requestId;
    loadingMore.value = true;
    try {
      const page = await fetcher(nextCursor.value);
      if (id !== requestId) return;
      items.value = [...items.value, ...page.items];
      nextCursor.value = page.nextCursor;
      total.value = page.total;
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      if (id === requestId) loadingMore.value = false;
    }
  }

  function setItems(next: T[] | ((current: T[]) => T[])) {
    items.value =
      typeof next === "function" ? (next as (current: T[]) => T[])(items.value) : next;
  }

  function patchItem(id: string, patch: Partial<T>) {
    items.value = items.value.map((item) =>
      (item as { id?: string }).id === id ? { ...item, ...patch } : item
    );
  }

  return {
    items,
    nextCursor,
    total,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
    setItems,
    patchItem,
    /** Invalidate in-flight requests without touching the visible list. */
    cancel() {
      requestId += 1;
      loading.value = false;
      loadingMore.value = false;
    },
  };
}
