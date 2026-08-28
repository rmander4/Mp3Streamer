import { useEffect, useState } from 'react';

// Virtuoso needs a stable *element* reference for `customScrollParent`, not
// a React ref object. `.main-content` (see App.css) is the app's one and
// only scroll container — it holds a `position: sticky` header above
// whatever's currently rendered below it — so every virtualized list/grid
// attaches to that existing element instead of each wrapping itself in a
// new nested scrollable div, which would break the sticky-header-over-one-
// scrollbar layout every screen already relies on.
export function useScrollParent(): HTMLElement | null {
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setScrollParent(document.querySelector('.main-content'));
  }, []);

  return scrollParent;
}
