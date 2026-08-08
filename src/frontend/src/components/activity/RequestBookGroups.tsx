import { useState } from 'react';

import type { RequestRecord } from '../../types';
import { getRequestBookIdentity, type RequestBookIdentity } from './activityMappers';
import type { ActivityItem } from './activityTypes';

export interface RequestBookGroup {
  book: RequestBookIdentity;
  requests: ActivityItem[];
}

export const groupPendingRequestsByBook = (items: ActivityItem[]): RequestBookGroup[] => {
  const groups = new Map<string, RequestBookGroup>();

  items.forEach((item) => {
    const record = item.requestRecord;
    if (!record || record.status !== 'pending') return;

    const book = getRequestBookIdentity(record);
    const group = groups.get(book.id);
    if (group) {
      group.requests.push(item);
    } else {
      groups.set(book.id, { book, requests: [item] });
    }
  });

  return Array.from(groups.values()).toSorted(
    (left, right) =>
      Math.max(...right.requests.map((item) => item.timestamp)) -
      Math.max(...left.requests.map((item) => item.timestamp)),
  );
};

interface RequestBookGroupsProps {
  items: ActivityItem[];
  onFindRelease: (requestId: number, record: RequestRecord) => Promise<void> | void;
  onReject: (requestId: number, note?: string) => Promise<void> | void;
}

const CoverFallback = () => (
  <div className="flex h-18 w-12 items-center justify-center rounded-sm bg-gray-200 text-[8px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
    No Cover
  </div>
);

const RequestBookGroupCard = ({
  group,
  onFindRelease,
  onReject,
}: {
  group: RequestBookGroup;
} & Omit<RequestBookGroupsProps, 'items'>) => {
  const [rejectingRequestId, setRejectingRequestId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const leader = group.requests[0]?.requestRecord;
  const rejectingRequest = group.requests.find(
    (item) => item.requestId === rejectingRequestId,
  )?.requestRecord;

  if (!leader) return null;

  const closeReject = () => {
    setRejectingRequestId(null);
    setNote('');
  };

  const confirmReject = async () => {
    if (!rejectingRequest) return;
    setIsRejecting(true);
    try {
      await onReject(rejectingRequest.id, note.trim() || undefined);
      closeReject();
    } catch {
      // The caller reports the failure; leave the form intact for a retry.
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <article className="rounded-lg border border-(--border-muted) p-3">
      <div className="-m-3 mb-0 flex items-start gap-3 bg-(--bg-soft) p-3">
        <div className="h-18 w-12 shrink-0 overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700">
          {group.book.coverUrl ? (
            <img
              src={group.book.coverUrl}
              alt={`${group.book.title} cover`}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <CoverFallback />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight">
            <span className="font-semibold">{group.book.title}</span>
            {group.book.author && (
              <span className="text-xs opacity-60"> - {group.book.author}</span>
            )}
          </p>
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            {group.requests.length} request{group.requests.length === 1 ? '' : 's'} waiting
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onFindRelease(leader.id, leader)}
          className="rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
        >
          Find a release
        </button>
      </div>

      <div className="mt-3 divide-y divide-(--border-muted)">
        {group.requests.map((item) => {
          const record = item.requestRecord;
          if (!record) return null;
          const isOpen = rejectingRequestId === record.id;
          return (
            <div key={item.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">{record.username?.trim() || `User ${record.user_id}`}</p>
                  {record.note && (
                    <p className="mt-0.5 text-xs italic opacity-60">&ldquo;{record.note}&rdquo;</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRejectingRequestId(record.id);
                    setNote('');
                  }}
                  disabled={isRejecting}
                  className="shrink-0 text-xs text-rose-700 hover:underline dark:text-rose-300"
                  aria-label={`Decline request from ${record.username?.trim() || `User ${record.user_id}`}`}
                >
                  Decline
                </button>
              </div>
              {isOpen && (
                <div className="mt-3 border-t border-(--border-muted) pt-3">
                  <p className="text-sm font-medium">Decline this requester?</p>
                  <p className="mt-1 text-xs opacity-65">
                    The optional note is shown to {record.username?.trim() || 'the requester'}.
                  </p>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value.slice(0, 1000))}
                    className="mt-3 w-full rounded-md border border-(--border-muted) bg-transparent p-2 text-xs"
                    placeholder="Optional note for the requester"
                    aria-label={`Optional note for ${record.username?.trim() || `User ${record.user_id}`}`}
                    rows={3}
                    disabled={isRejecting}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] opacity-50">{note.length}/1000</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={closeReject}
                        disabled={isRejecting}
                        className="rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmReject()}
                        disabled={isRejecting}
                        className="rounded-md bg-rose-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-60"
                      >
                        {isRejecting ? 'Declining...' : 'Decline request'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
};

export const RequestBookGroups = ({ items, onFindRelease, onReject }: RequestBookGroupsProps) => (
  <div className="space-y-3">
    {groupPendingRequestsByBook(items).map((group) => (
      <RequestBookGroupCard
        key={group.book.id}
        group={group}
        onFindRelease={onFindRelease}
        onReject={onReject}
      />
    ))}
  </div>
);
