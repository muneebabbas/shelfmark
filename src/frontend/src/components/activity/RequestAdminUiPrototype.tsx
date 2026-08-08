import { useState } from 'react';

import { useDependencyEffect } from '../../hooks/useMountEffect';
import type { RequestRecord } from '../../types';
import { getRequestBookIdentity } from './activityMappers';
import type { ActivityItem } from './activityTypes';
import { groupPendingRequestsByBook } from './RequestBookGroups';

// PROTOTYPE: Three request-admin layouts, switchable with ?variant=queue|case-file|ledger.

const VARIANTS = [
  ['queue', 'Book work queue'],
  ['case-file', 'Requester case file'],
  ['ledger', 'Triage ledger'],
] as const;

type Variant = (typeof VARIANTS)[number][0];

const getVariant = (): Variant | null => {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get('variant');
  return VARIANTS.find(([key]) => key === value)?.[0] ?? null;
};

export const isRequestAdminUiPrototypeActive = (): boolean => getVariant() !== null;

const PrototypeNotice = () => (
  <p className="mb-4 rounded-md border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-xs text-violet-800 dark:text-violet-200">
    Prototype: real request data, read-only actions. Pick a layout from the floating switcher.
  </p>
);

const Cover = ({ record }: { record: RequestRecord }) => {
  const book = getRequestBookIdentity(record);
  return book.coverUrl ? (
    <img src={book.coverUrl} alt="" className="h-16 w-11 rounded-sm bg-(--bg-soft) object-cover" />
  ) : (
    <div className="flex h-16 w-11 items-center justify-center rounded-sm bg-(--bg-soft) text-[9px] opacity-60">
      No cover
    </div>
  );
};

const RejectPreview = ({ record, onClose }: { record: RequestRecord; onClose: () => void }) => (
  <div className="mt-3 border-t border-(--border-muted) pt-3">
    <p className="text-sm font-medium">Decline this requester?</p>
    <p className="mt-1 text-xs opacity-65">
      An optional note should be visible to {record.username || 'the requester'} with the declined
      status.
    </p>
    <textarea
      className="mt-3 w-full rounded-md border border-(--border-muted) bg-transparent p-2 text-xs"
      placeholder="Optional note for the requester"
      rows={3}
      disabled
    />
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1.5 text-xs">
        Cancel
      </button>
      <button
        type="button"
        disabled
        className="rounded-md bg-rose-700 px-2.5 py-1.5 text-xs font-medium text-white opacity-60"
      >
        Decline request
      </button>
    </div>
  </div>
);

const FindReleaseButton = () => (
  <button
    type="button"
    disabled
    className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white opacity-60"
  >
    Find a release
  </button>
);

const QueueVariant = ({ items }: { items: ActivityItem[] }) => {
  const [rejecting, setRejecting] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <PrototypeNotice />
      {groupPendingRequestsByBook(items).map((group) => {
        const leader = group.requests[0]?.requestRecord;
        if (!leader) return null;
        return (
          <article
            key={group.book.id}
            className="overflow-hidden rounded-lg border border-(--border-muted)"
          >
            <div className="flex items-start gap-3 bg-(--bg-soft) p-3">
              <Cover record={leader} />
              <div className="min-w-0 flex-1">
                <p className="leading-tight font-semibold">{group.book.title}</p>
                <p className="mt-1 text-xs opacity-60">{group.book.author}</p>
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                  {group.requests.length} request{group.requests.length === 1 ? '' : 's'} waiting
                </p>
              </div>
              <FindReleaseButton />
            </div>
            <div className="divide-y divide-(--border-muted)">
              {group.requests.map((item) => {
                const record = item.requestRecord;
                if (!record) return null;
                return (
                  <div key={record.id} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm">{record.username || `User ${record.user_id}`}</p>
                        {record.note && (
                          <p className="mt-0.5 text-xs italic opacity-60">“{record.note}”</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRejecting(record.id)}
                        className="text-xs text-rose-700 hover:underline dark:text-rose-300"
                      >
                        Decline
                      </button>
                    </div>
                    {rejecting === record.id && (
                      <RejectPreview record={record} onClose={() => setRejecting(null)} />
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
};

const CaseFileVariant = ({ items }: { items: ActivityItem[] }) => {
  const pending = items.filter((item) => item.requestRecord?.status === 'pending');
  const [selectedId, setSelectedId] = useState<number | null>(pending[0]?.requestId ?? null);
  const [rejecting, setRejecting] = useState(false);
  const selected = pending.find((item) => item.requestId === selectedId)?.requestRecord;
  return (
    <div>
      <PrototypeNotice />
      <div className="grid min-h-90 grid-cols-[minmax(0,1fr)_minmax(11rem,0.85fr)] border border-(--border-muted)">
        <div className="divide-y divide-(--border-muted)">
          {pending.map((item) => {
            const record = item.requestRecord;
            if (!record) return null;
            const book = getRequestBookIdentity(record);
            return (
              <button
                key={record.id}
                type="button"
                onClick={() => {
                  setSelectedId(record.id);
                  setRejecting(false);
                }}
                className={`flex w-full gap-2 p-3 text-left ${selectedId === record.id ? 'bg-sky-500/10' : 'hover:bg-(--hover-surface)'}`}
              >
                <Cover record={record} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{book.title}</span>
                  <span className="mt-1 block text-xs opacity-60">
                    {record.username || `User ${record.user_id}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <aside className="border-l border-(--border-muted) p-3">
          {selected ? (
            <>
              <p className="text-[11px] font-medium tracking-wide uppercase opacity-55">
                Request details
              </p>
              <p className="mt-3 text-sm font-semibold">{getRequestBookIdentity(selected).title}</p>
              <dl className="mt-4 space-y-3 text-xs">
                <div>
                  <dt className="opacity-55">Requester</dt>
                  <dd className="mt-0.5">{selected.username || `User ${selected.user_id}`}</dd>
                </div>
                <div>
                  <dt className="opacity-55">Their note</dt>
                  <dd className="mt-0.5 italic">
                    {selected.note ? `“${selected.note}”` : 'No note'}
                  </dd>
                </div>
              </dl>
              <div className="mt-6 space-y-2">
                <FindReleaseButton />
                <button
                  type="button"
                  onClick={() => setRejecting(true)}
                  className="block text-xs text-rose-700 hover:underline dark:text-rose-300"
                >
                  Decline this request
                </button>
              </div>
              {rejecting && <RejectPreview record={selected} onClose={() => setRejecting(false)} />}
            </>
          ) : (
            <p className="text-sm opacity-60">No pending requests.</p>
          )}
        </aside>
      </div>
    </div>
  );
};

const LedgerVariant = ({ items }: { items: ActivityItem[] }) => {
  const [rejecting, setRejecting] = useState<number | null>(null);
  const pending = items.filter((item) => item.requestRecord?.status === 'pending');
  return (
    <div>
      <PrototypeNotice />
      <div className="overflow-hidden rounded-lg border border-(--border-muted)">
        <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(5rem,0.8fr)_auto] gap-3 bg-(--bg-soft) px-3 py-2 text-[10px] font-medium tracking-wide uppercase opacity-60">
          <span>Request</span>
          <span>Requester</span>
          <span>Next step</span>
        </div>
        {pending.map((item) => {
          const record = item.requestRecord;
          if (!record) return null;
          const book = getRequestBookIdentity(record);
          return (
            <div key={record.id} className="border-t border-(--border-muted) px-3 py-3">
              <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(5rem,0.8fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{book.title}</p>
                  <p className="truncate text-xs opacity-60">{book.author}</p>
                </div>
                <div className="truncate text-xs">
                  {record.username || `User ${record.user_id}`}
                </div>
                <div className="flex gap-2">
                  <FindReleaseButton />
                  <button
                    type="button"
                    onClick={() => setRejecting(record.id)}
                    className="rounded-md border border-rose-400/60 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-300"
                  >
                    Decline
                  </button>
                </div>
              </div>
              {record.note && (
                <p className="mt-2 text-xs italic opacity-60">Requester note: “{record.note}”</p>
              )}
              {rejecting === record.id && (
                <RejectPreview record={record} onClose={() => setRejecting(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const RequestAdminUiPrototype = ({ items }: { items: ActivityItem[] }) => {
  const [variant, setVariant] = useState<Variant>(() => getVariant() ?? 'queue');
  useDependencyEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return;
      const index = VARIANTS.findIndex(([key]) => key === variant);
      const next =
        (index + (event.key === 'ArrowRight' ? 1 : VARIANTS.length - 1)) % VARIANTS.length;
      setVariant(VARIANTS[next][0]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [variant]);
  useDependencyEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('variant', variant);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?${params}${window.location.hash}`,
    );
  }, [variant]);
  const [, name] = VARIANTS.find(([key]) => key === variant) ?? VARIANTS[0];
  return (
    <>
      <div>
        {variant === 'queue' && <QueueVariant items={items} />}
        {variant === 'case-file' && <CaseFileVariant items={items} />}
        {variant === 'ledger' && <LedgerVariant items={items} />}
      </div>
      <div className="fixed bottom-4 left-1/2 z-100 flex -translate-x-1/2 items-center gap-3 rounded-full bg-gray-950 px-2 py-2 text-xs text-white shadow-xl">
        <button
          type="button"
          onClick={() =>
            setVariant(
              VARIANTS[
                (VARIANTS.findIndex(([key]) => key === variant) + VARIANTS.length - 1) %
                  VARIANTS.length
              ][0],
            )
          }
          className="rounded-full px-2 py-1 hover:bg-white/15"
          aria-label="Previous prototype variant"
        >
          ←
        </button>
        <span className="min-w-32 text-center">
          {variant} · {name}
        </span>
        <button
          type="button"
          onClick={() =>
            setVariant(
              VARIANTS[(VARIANTS.findIndex(([key]) => key === variant) + 1) % VARIANTS.length][0],
            )
          }
          className="rounded-full px-2 py-1 hover:bg-white/15"
          aria-label="Next prototype variant"
        >
          →
        </button>
      </div>
    </>
  );
};
