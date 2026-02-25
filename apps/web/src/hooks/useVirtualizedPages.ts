import { useMemo, useCallback } from 'react';

interface Page {
  id: string;
  name: string;
}

interface UseVirtualizedPagesProps {
  pages: Page[];
  currentPageIndex: number;
  pageHeight: number;
  pageSeparatorHeight: number;
  bufferSize?: number;
}

export function useVirtualizedPages({
  pages,
  currentPageIndex,
  pageHeight,
  pageSeparatorHeight,
  bufferSize = 2
}: UseVirtualizedPagesProps) {
  const visiblePages = useMemo(() => {
    const startIndex = Math.max(0, currentPageIndex - bufferSize);
    const endIndex = Math.min(pages.length - 1, currentPageIndex + bufferSize);
    
    return pages.slice(startIndex, endIndex + 1).map((page, index) => ({
      ...page,
      virtualIndex: startIndex + index,
      isVisible: startIndex + index === currentPageIndex
    }));
  }, [pages, currentPageIndex, bufferSize]);

  const getVisiblePageHeight = useCallback((pageIndex: number) => {
    return pageHeight + (pageIndex < pages.length - 1 ? pageSeparatorHeight : 0);
  }, [pageHeight, pageSeparatorHeight, pages.length]);

  const getTotalVisibleHeight = useCallback(() => {
    return visiblePages.reduce((total, page) => {
      return total + getVisiblePageHeight(page.virtualIndex);
    }, 0);
  }, [visiblePages, getVisiblePageHeight]);

  return {
    visiblePages,
    getVisiblePageHeight,
    getTotalVisibleHeight
  };
}
