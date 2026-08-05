import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDependencyEffect } from '../hooks/useMountEffect';
import { getLibraryReviewInbox } from '../services/api';
import type { InboxItem } from './types';

const InboxSkeleton = () => (
  <div className="space-y-3">
    {[0, 1, 2].map((index) => (
      <div key={index} className="animate-pulse rounded-xl border border-(--border-muted) p-4">
        <div className="h-4 w-2/5 rounded bg-(--bg-strong) motion-safe:animate-pulse" />
        <div className="mt-2 h-3 w-3/5 rounded bg-(--bg-strong) motion-safe:animate-pulse" />
      </div>
    ))}
  </div>
);

const InboxItemCard = ({ item, selected }: { item: InboxItem; selected: boolean }) => {
  const formatCounts = new Map<string, number>();
  for (const member of item.evidence) {
    if (!member.format) continue;
    formatCounts.set(member.format, (formatCounts.get(member.format) ?? 0) + 1);
  }
  const formatLabel = [...formatCounts.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([format, count]) => `${format.toUpperCase()}${count > 1 ? ` ×${count}` : ''}`)
    .join(' · ');

  const bookId = item.book_id;
  const reviewUrl = bookId ? `/library/${bookId}?review=${item.activity_id}` : null;

  return (
    <li
      data-book-id={bookId ?? undefined}
      className={`rounded-xl border bg-(--bg-soft) ${
        selected ? 'border-amber-500/60 ring-2 ring-amber-500/40' : 'border-(--border-muted)'
      }`}
    >
      <Link
        to={reviewUrl ?? '/library'}
        className={`flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${reviewUrl ? 'hover:bg-(--hover-row)' : ''}`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold break-words text-(--text)">{item.book_title}</span>
            {item.book_author && (
              <span className="text-sm text-gray-500">by {item.book_author}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {item.source_key && <span className="break-all">Source: {item.source_key}</span>}
            {formatLabel && <span>{formatLabel}</span>}
          </div>
        </div>
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          Review
        </span>
      </Link>
    </li>
  );
};

export const InboxPage = () => {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { bookId: rawBookId } = useParams<{ bookId: string }>();
  const selectedBookId = rawBookId ? Number(rawBookId) : undefined;

  const load = () => {
    void getLibraryReviewInbox()
      .then((response) => setItems(response.items))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Failed to load the Inbox'),
      );
  };

  useDependencyEffect(load, []);

  useDependencyEffect(() => {
    if (selectedBookId === undefined || !items?.length) return;
    document
      .querySelector<HTMLElement>(`[data-book-id="${selectedBookId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [items, selectedBookId]);

  if (error) {
    return (
      <section className="px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-(--text)">Inbox</h1>
        <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">{error}</p>
      </section>
    );
  }

  if (items === null) {
    return (
      <section className="px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-(--text)">Inbox</h1>
        <div className="mt-6">
          <InboxSkeleton />
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 py-10">
      <header>
        <p className="text-xs font-bold tracking-[0.18em] text-violet-700 uppercase dark:text-violet-300">
          Needs review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-(--text)">Inbox</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Books could not be imported automatically. Open one to review its retained source files.
        </p>
      </header>
      {items.length === 0 ? (
        <div className="mt-8 rounded-xl border border-(--border-muted) p-8 text-center">
          <p className="text-sm text-gray-500">Nothing needs review right now.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <InboxItemCard
              key={item.activity_id}
              item={item}
              selected={item.book_id !== null && item.book_id === selectedBookId}
            />
          ))}
        </ul>
      )}
    </section>
  );
};
