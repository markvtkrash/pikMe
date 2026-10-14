import { useEffect, useMemo, useState } from 'react';
import { clampPage, LIST_PAGE_SIZE, pageCountFor, pageRange, pageSlice } from '../utils/paging';

// Pages an already-filtered list. The page goes back to the first whenever resetKey changes (a new search or filter). onPageChange lets the
// screen scroll its list to the top when the page changes.
export function usePaging<T>(items: T[], resetKey: string, onPageChange?: () => void, size: number = LIST_PAGE_SIZE) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  const safePage = clampPage(page, items.length, size);
  const pageItems = useMemo(() => pageSlice(items, safePage, size), [items, safePage, size]);
  const range = pageRange(safePage, items.length, size);

  function goTo(next: number) {
    setPage(clampPage(next, items.length, size));
    onPageChange?.();
  }

  return { pageItems, page: safePage, pageCount: pageCountFor(items.length, size), total: items.length, from: range.from, to: range.to, goTo };
}
