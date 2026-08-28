import { useCallback, useEffect, useRef, useState } from 'react';
import type { PagedResult } from '../api/types';

interface UseInfinitePagesResult<T> {
  items: T[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
  // Re-fetches from page 1 without needing a `deps` change — for when the
  // underlying data changed for a reason the hook can't see itself (e.g. a
  // bulk tag edit changed which album a track belongs to).
  reload: () => void;
  // Patches already-loaded items in place (e.g. an optimistic rating/tag
  // update) without a network round-trip — same "update the local array
  // directly" pattern the pre-pagination code used.
  updateItems: (updater: (items: T[]) => T[]) => void;
}

// Drives infinite-scroll list/grid data: fetches page 1 whenever `deps`
// change (search term, filter, sort — same idea as any other filtered
// fetch), then grows `items` page by page as `loadMore` is called (wired to
// a Virtuoso `endReached`/range callback by the caller). `fetchPage` should
// close over whatever fixed page size and filters the caller wants — this
// hook only tracks *which* page comes next and whether more remain.
//
// Aborts the in-flight request whenever `deps` change before it resolves —
// same reasoning as the pre-existing track-search abort-on-supersede
// pattern in App.tsx: a slow search resolving after a newer one would
// otherwise flicker stale results back in (reproduces reliably on Ryan's
// brother's ~285k-track library).
export function useInfinitePages<T>(
  fetchPage: (page: number, signal: AbortSignal) => Promise<PagedResult<T>>,
  deps: React.DependencyList,
): UseInfinitePagesResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetchPage is a fresh closure every render (it captures the caller's
  // current filters) — stash it in a ref so effects/callbacks below can
  // always call the latest version without needing it as a dependency.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const controllerRef = useRef<AbortController | null>(null);
  const nextPageRef = useRef(1);
  const loadedCountRef = useRef(0);
  const busyRef = useRef(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    nextPageRef.current = 1;
    loadedCountRef.current = 0;
    busyRef.current = true;

    setItems([]);
    setTotalCount(0);
    setError(null);
    setLoading(true);

    fetchPageRef
      .current(1, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items);
        setTotalCount(result.totalCount);
        nextPageRef.current = 2;
        loadedCountRef.current = result.items.length;
      })
      .catch((e) => {
        if (controller.signal.aborted || e?.name === 'AbortError') return;
        setError(String(e));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        busyRef.current = false;
        setLoading(false);
      });

    return () => controller.abort();
    // deps is caller-controlled — this effect intentionally re-runs only
    // when the caller's filter/search/sort values change (plus
    // reloadToken, bumped by the exposed `reload()`), not on every
    // fetchPage identity change (handled via fetchPageRef above instead).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  const loadMore = useCallback(() => {
    if (busyRef.current) return;
    if (loadedCountRef.current > 0 && loadedCountRef.current >= totalCount) return;
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) return;

    busyRef.current = true;
    setLoading(true);
    const page = nextPageRef.current;

    fetchPageRef
      .current(page, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems((prev) => [...prev, ...result.items]);
        setTotalCount(result.totalCount);
        nextPageRef.current = page + 1;
        loadedCountRef.current += result.items.length;
      })
      .catch((e) => {
        if (controller.signal.aborted || e?.name === 'AbortError') return;
        setError(String(e));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        busyRef.current = false;
        setLoading(false);
      });
  }, [totalCount]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { items, totalCount, loading, error, loadMore, reload, updateItems: setItems };
}
