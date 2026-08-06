import { useState } from 'react';

import { useDependencyEffect } from '../hooks/useMountEffect';
import { getLibraryReviewInbox } from '../services/api';

export interface NeedsReviewBooks {
  byBookId: Record<number, number>;
}

export const useNeedsReviewBooks = (enabled: boolean): NeedsReviewBooks => {
  const [byBookId, setByBookId] = useState<Record<number, number>>({});

  useDependencyEffect(() => {
    if (!enabled) {
      setByBookId({});
      return undefined;
    }
    let cancelled = false;
    void getLibraryReviewInbox()
      .then((response) => {
        if (cancelled) return;
        const mapping: Record<number, number> = {};
        for (const item of response.items) {
          if (item.book_id !== null) mapping[item.book_id] = item.activity_id;
        }
        setByBookId(mapping);
      })
      .catch(() => {
        if (!cancelled) setByBookId({});
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { byBookId };
};
