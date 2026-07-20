// Book detail page at `/library/:bookId` — per ticket #08.
//
// Land of the central library UX surface: per-format downloads, per-file
// release-level list with unlink, Send-to-Kindle with #05 format override
// picker, Find Releases modal trigger (auto-open on empty state per #02),
// in-flight indicator, loading skeleton + error retry card.
//
// Wired to the live #06 API: `GET /api/library/books/:book_id` per #04's
// response shape. Download / Unlink / Send-to-Kindle / Find Releases onClicks
// stay stubbed for the prototype (a visible "prototype only" notice fires on
// click) — #11 owns wiring those into the existing release-list flow and the
// SMTP machinery.

import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Tooltip } from '../components/shared/Tooltip';
import { useDependencyEffect } from '../hooks/useMountEffect';
import { withBasePath, getApiBase } from '../utils/basePath';
import { isRecord } from '../utils/objectHelpers';
import {
  type BookDetailResponse,
  type InFlightDownload,
  type LibraryFile,
  DEFAULT_LIBRARY_AUTO_FIND_RELEASES,
  formatSize,
  resolveKindleFormat,
  unionFormats,
} from './types';

interface BookDetailPageProps {
  // Prototype: callbacks are stubs. When wired into App.tsx, Find Releases
  // opens the existing ReleaseModal via `setReleaseBook` (App.tsx:519,1608);
  // settings opens SelfSettingsModal via `setSelfSettingsOpen` (App.tsx:684).
  onPrototypeAction?: (label: string) => void;
  onFindReleases?: () => void;
  onOpenSettings?: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; notFound: boolean; retryToken: number }
  | { kind: 'ready'; data: BookDetailResponse };

const FETCH_LATENCY_MS_MIN = 200;

// Live fetch against #06's `GET /api/library/books/:book_id`. Under
// `AUTH_METHOD=none` (admin-equivalent per library_routes.py:76-78), every
// book the user navigates to is visible (no membership gate failure surface).
async function fetchBookDetail(bookId: number): Promise<BookDetailResponse> {
  const url = `${getApiBase()}/library/books/${bookId}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (res.status === 404) {
    throw new BookNotFoundError('Book not found');
  }
  if (res.status === 403) {
    throw new BookNotFoundError('Book not in your library');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as unknown;
    const errorMessage =
      isRecord(body) && typeof body['error'] === 'string' && body['error'].length > 0
        ? body['error']
        : `Failed to load book (${res.status})`;
    throw new Error(errorMessage);
  }
  const payload = (await res.json()) as unknown;
  if (!isBookDetailResponse(payload)) {
    throw new Error('Malformed book detail response');
  }
  return payload;
}

function isBookDetailResponse(value: unknown): value is BookDetailResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value['book_id'] === 'number' &&
    Array.isArray(value['files']) &&
    Array.isArray(value['in_flight'])
  );
}

class BookNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookNotFoundError';
  }
}

function isBookNotFound(err: unknown): boolean {
  return err instanceof BookNotFoundError;
}

export const BookDetailPage = ({
  onPrototypeAction,
  onFindReleases,
  onOpenSettings,
}: BookDetailPageProps) => {
  const params = useParams();
  const navigate = useNavigate();
  const bookIdParam = params.bookId;
  const bookId = bookIdParam ? Number.parseInt(bookIdParam, 10) : Number.NaN;

  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    // Small artificial latency floor only — keeps the skeleton visible long
    // enough to perceive the loading state. Real fetch dominates above this.
    window.setTimeout(() => {
      void fetchBookDetail(bookId)
        .then((data) => setState({ kind: 'ready', data }))
        .catch((err: unknown) => {
          const notFound = isBookNotFound(err);
          const message = err instanceof Error ? err.message : 'Failed to load book';
          setState({ kind: 'error', message, notFound, retryToken: Date.now() });
        });
    }, FETCH_LATENCY_MS_MIN);
  }, [bookId]);

  useDependencyEffect(() => {
    if (Number.isNaN(bookId)) {
      setState({
        kind: 'error',
        message: 'Invalid book id',
        notFound: true,
        retryToken: Date.now(),
      });
      return;
    }
    load();
  }, [bookId, load]);

  if (Number.isNaN(bookId) || (state.kind === 'error' && state.notFound)) {
    return (
      <NotFoundCard
        message={state.kind === 'error' ? state.message : 'Invalid book id'}
        onBack={() => {
          void navigate('/library', { replace: true });
        }}
      />
    );
  }

  if (state.kind === 'loading') return <BookDetailSkeleton />;
  if (state.kind === 'error') {
    return <ErrorCard message={state.message} onRetry={load} retryLabel="Retry" />;
  }

  const data = state.data;
  const formats = unionFormats(data.files);
  const filesExistGlobally = data.files.length > 0 || data.in_flight.length > 0;
  const inFlightGlobally = data.in_flight.length > 0;
  // Per #02 sub-decision 5: auto-open Find Releases only when both
  // files_exist_globally == false AND LIBRARY_AUTO_FIND_RELEASES == true.
  const shouldAutoOpenFindReleases = !filesExistGlobally && DEFAULT_LIBRARY_AUTO_FIND_RELEASES;

  return (
    <BookDetailContent
      data={data}
      formats={formats}
      filesExistGlobally={filesExistGlobally}
      inFlightGlobally={inFlightGlobally}
      shouldAutoOpenFindReleases={shouldAutoOpenFindReleases}
      onPrototypeAction={onPrototypeAction}
      onFindReleases={onFindReleases}
      onOpenSettings={onOpenSettings}
    />
  );
};

interface BookDetailContentProps {
  data: BookDetailResponse;
  formats: string[];
  filesExistGlobally: boolean;
  inFlightGlobally: boolean;
  shouldAutoOpenFindReleases: boolean;
  onPrototypeAction?: (label: string) => void;
  onFindReleases?: () => void;
  onOpenSettings?: () => void;
}

const BookDetailContent = ({
  data,
  formats,
  filesExistGlobally,
  inFlightGlobally,
  shouldAutoOpenFindReleases,
  onPrototypeAction,
  onFindReleases,
  onOpenSettings,
}: BookDetailContentProps) => {
  // Per #05: override picker state is local. When the user picks a format, the
  // Send-to-Kindle button reflects that format. Resets when the page remounts.
  const [formatOverride, setFormatOverride] = useState<string | null>(null);
  const resolvedKindleFormat = formatOverride ?? resolveKindleFormat(formats);
  const kindleDisabled = resolvedKindleFormat == null;

  // Auto-open Find Releases once per (book, empty-state) entry.
  const [findReleasesTriggered, setFindReleasesTriggered] = useState(false);
  useDependencyEffect(() => {
    if (shouldAutoOpenFindReleases && !findReleasesTriggered) {
      setFindReleasesTriggered(true);
      onFindReleases?.();
    }
  }, [shouldAutoOpenFindReleases, findReleasesTriggered, data.book_id]);

  const handleFindReleasesClick = () => {
    setFindReleasesTriggered(true);
    onFindReleases?.();
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      {inFlightGlobally && <InFlightIndicator count={data.in_flight.length} />}

      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex w-32 shrink-0 justify-center sm:w-40">
          {data.cover_url ? (
            <img
              src={withBasePath(data.cover_url)}
              alt=""
              className="h-auto max-h-64 w-full rounded-lg shadow-md"
            />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg border border-dashed border-(--border-muted) bg-(--bg-soft) text-xs text-gray-500 dark:text-gray-400">
              No cover
            </div>
          )}
        </div>
        <div className="flex-1 space-y-1">
          <h1 className="text-xl font-semibold text-(--text) sm:text-2xl">
            {data.title || 'Untitled'}
          </h1>
          {data.subtitle && (
            <p className="text-sm text-gray-600 dark:text-gray-300">{data.subtitle}</p>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {data.author || 'Unknown author'}
          </p>
          <div className="flex flex-wrap gap-2 pt-2 text-xs text-gray-500 dark:text-gray-400">
            {data.publish_year && <span>{data.publish_year}</span>}
            {data.series_name && (
              <span>
                {data.series_position != null ? `#${data.series_position} in ` : ''}
                {data.series_name}
              </span>
            )}
            {data.language && <span className="uppercase">{data.language}</span>}
            {data.isbn_13 && <span>ISBN {data.isbn_13}</span>}
            {data.metadata_provider && (
              <span className="rounded bg-(--bg-soft) px-1.5 py-0.5">{data.metadata_provider}</span>
            )}
          </div>
        </div>
      </header>

      {/* Formats on disk — union across all complete download_history rows */}
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Formats on disk
        </h2>
        {filesExistGlobally ? (
          <div className="overflow-hidden rounded-xl border border-(--border-muted) bg-(--bg-soft)">
            {formats.map((fmt) => (
              <div
                key={fmt}
                className="flex items-center justify-between border-b border-(--border-muted) px-4 py-3 last:border-b-0"
              >
                <span className="text-sm font-medium text-(--text) uppercase">{fmt}</span>
                <button
                  type="button"
                  className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-800"
                  onClick={() => {
                    onPrototypeAction?.(
                      `Download ${fmt.toUpperCase()} (prototype only — wires to GET /api/library/books/${data.book_id}/download?format=${fmt} in #11)`,
                    );
                  }}
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyFilesState onFindReleases={handleFindReleasesClick} />
        )}
      </section>

      {/* Per-file release-level list — completed + in-flight (per #04 sub-decision 6 + #08 unlink UX) */}
      {filesExistGlobally && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            Files in your library
          </h2>
          <div className="overflow-x-auto rounded-xl border border-(--border-muted) bg-(--bg-soft)">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-(--border-muted) text-xs text-gray-500 uppercase dark:text-gray-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Format</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Indexer</th>
                  <th className="px-4 py-2 font-medium">Downloaded</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.files.map((file) => (
                  <FileRow
                    key={file.history_id}
                    file={file}
                    bookId={data.book_id}
                    onPrototypeAction={onPrototypeAction}
                  />
                ))}
                {data.in_flight.map((inFlight) => (
                  <InFlightRow
                    key={inFlight.history_id}
                    inFlight={inFlight}
                    bookId={data.book_id}
                    onPrototypeAction={onPrototypeAction}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <SendToKindleCard
        bookId={data.book_id}
        resolvedFormat={resolvedKindleFormat}
        kindleDisabled={kindleDisabled}
        formats={formats}
        onPickFormat={setFormatOverride}
        selectedOverride={formatOverride}
        onPrototypeAction={onPrototypeAction}
      />

      {/* Always-present Find Releases surface — empty-state is the persistent button above */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--border-muted) bg-(--bg-soft) px-4 py-3">
        <p className="text-xs text-gray-600 dark:text-gray-300">Looking for a different release?</p>
        <button
          type="button"
          onClick={handleFindReleasesClick}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          Find Releases
        </button>
      </div>

      {/* Inline Kindle-email surface — #08 decision 6 */}
      <div className="mt-2 px-1 text-xs text-gray-600 dark:text-gray-300">
        {/* Conditional in SendToKindleCard below — left as a separate hint for the
            reviewer to know where the settings entrypoint lives. */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-emerald-700 underline decoration-dotted underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          Configure Kindle email in Settings
        </button>
      </div>
    </div>
  );
};

const InFlightIndicator = ({ count }: { count: number }) => (
  <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
    {count === 1
      ? 'A download is in progress for this book'
      : `${count} downloads are in progress for this book`}
  </div>
);

const EmptyFilesState = ({ onFindReleases }: { onFindReleases: () => void }) => (
  <div className="rounded-xl border border-dashed border-(--border-muted) bg-(--bg-soft) px-4 py-6 text-center">
    <p className="text-sm text-gray-600 dark:text-gray-300">No files on disk for this book yet.</p>
    <button
      type="button"
      onClick={onFindReleases}
      className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
        />
      </svg>
      Find Releases
    </button>
  </div>
);

const FileRow = ({
  file,
  bookId,
  onPrototypeAction,
}: {
  file: LibraryFile;
  bookId: number;
  onPrototypeAction?: (label: string) => void;
}) => {
  return (
    <tr className="border-b border-(--border-muted) last:border-b-0">
      <td className="px-4 py-2 font-medium text-(--text) uppercase">{file.format || '—'}</td>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{formatSize(file.size)}</td>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
        {file.indexer_display_name || '—'}
      </td>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
        {file.downloaded_at ? new Date(file.downloaded_at).toLocaleDateString() : '—'}
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {file.downloadable_by_me ? (
            <>
              <button
                type="button"
                className="rounded-md bg-sky-700 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-800"
                onClick={() => {
                  onPrototypeAction?.(
                    `Download ${file.format?.toUpperCase() || ''} (prototype only — wires to GET /api/library/books/${bookId}/download?history_id=${file.history_id} in #11)`,
                  );
                }}
              >
                Download
              </button>
              <button
                type="button"
                className="rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/40"
                onClick={() => {
                  onPrototypeAction?.(
                    `Unlink history_id=${file.history_id} (prototype only — wires to DELETE /api/library/books/${bookId}/downloads/${file.history_id} in #11)`,
                  );
                }}
              >
                Unlink
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
          )}
        </div>
      </td>
    </tr>
  );
};

const InFlightRow = ({
  inFlight,
  bookId,
  onPrototypeAction,
}: {
  inFlight: InFlightDownload;
  bookId: number;
  onPrototypeAction?: (label: string) => void;
}) => {
  // Per #08 decision 3: unlink mid-flight is disallowed with error. The DELETE
  // returns 409 when final_status='active'; the UI greys Unlink with a tooltip
  // explaining why. (In the live API, in-flight rows live in the separate
  // `in_flight` array — they're not in `files` because they don't yet have a
  // `download_path`. So the Unlink button on an in-flight row is the surface
  // where this decision *visibly* matters.)
  return (
    <tr className="border-b border-(--border-muted) bg-amber-50/30 last:border-b-0 dark:bg-amber-900/10">
      <td className="px-4 py-2 font-medium text-(--text) uppercase">
        {inFlight.format || '—'}
        <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          in flight
        </span>
      </td>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">in flight</td>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
        {inFlight.source_display_name || '—'}
      </td>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">—</td>
      <td className="px-4 py-2 text-right">
        <Tooltip content="This download is in progress — unlink it after it finishes.">
          <button
            type="button"
            disabled
            aria-label={`Unlink in-flight download ${inFlight.history_id} (disabled)`}
            onClick={() => {
              onPrototypeAction?.(
                `Unlink (blocked) history_id=${inFlight.history_id} — would attempt DELETE /api/library/books/${bookId}/downloads/${inFlight.history_id}, 409 per #08 decision 3`,
              );
            }}
            className="cursor-not-allowed rounded-md bg-gray-300 px-2 py-1 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400"
          >
            Unlink
          </button>
        </Tooltip>
      </td>
    </tr>
  );
};

interface SendToKindleCardProps {
  bookId: number;
  resolvedFormat: string | null;
  kindleDisabled: boolean;
  formats: string[];
  selectedOverride: string | null;
  onPickFormat: (format: string | null) => void;
  onPrototypeAction?: (label: string) => void;
}

const SendToKindleCard = ({
  bookId,
  resolvedFormat,
  kindleDisabled,
  formats,
  selectedOverride,
  onPickFormat,
  onPrototypeAction,
}: SendToKindleCardProps) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Per #08 decision 6: inline Kindle-email surface. The backend exposes
  // KINDLE_EMAIL as a per-user overrideable setting via the settings framework;
  // for the prototype, the prototype reads it via a separate `/api/config`
  // surface that lands with the wired-up version. The prototype just shows the
  // "settings link" half of the inline surface — the email itself is read in
  // #11 when the Send button is wired.
  const button = (
    <button
      type="button"
      disabled={kindleDisabled}
      onClick={() => {
        onPrototypeAction?.(
          `Send ${resolvedFormat?.toUpperCase() || ''} to Kindle (prototype only — wires to POST /api/library/books/${bookId}/send-to-kindle with body { format: ${resolvedFormat} } in #11)`,
        );
      }}
      className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        kindleDisabled ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700'
      }`}
    >
      {kindleDisabled
        ? 'No Kindle-compatible format'
        : `Send ${resolvedFormat?.toUpperCase()} to Kindle`}
    </button>
  );

  return (
    <section className="rounded-xl border border-(--border-muted) bg-(--bg-soft) px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            Send to Kindle
          </h2>
          {/* Inline email surface — wired to the live KINDLE_EMAIL read in #11.
              For the prototype, this is the placeholder line; #11 swaps the
              placeholder for the resolved email. */}
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Sending to the Kindle email configured in Settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {kindleDisabled ? (
            <Tooltip content="Send-to-Kindle supports EPUB only (#05). No EPUB on disk for this book.">
              {button}
            </Tooltip>
          ) : (
            button
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={kindleDisabled || formats.length === 0}
              aria-label="Override Send-to-Kindle format"
              className="rounded-md border border-(--border-muted) px-2 py-2 text-xs text-gray-600 transition-colors hover:bg-(--bg) disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                />
              </svg>
            </button>
            {pickerOpen && !kindleDisabled && (
              <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-(--border-muted) bg-(--bg) shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    onPickFormat(null);
                    setPickerOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-(--text) transition-colors hover:bg-(--bg-soft)"
                >
                  Auto ({resolveKindleFormat(formats)?.toUpperCase() ?? '—'})
                </button>
                {formats.map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => {
                      onPickFormat(fmt);
                      setPickerOpen(false);
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs uppercase transition-colors hover:bg-(--bg-soft) ${
                      selectedOverride === fmt
                        ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                        : 'text-(--text)'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const ErrorCard = ({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry: () => void;
  retryLabel: string;
}) => (
  <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
    <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-6 text-center dark:border-rose-800 dark:bg-rose-900/20">
      <p className="text-sm text-rose-800 dark:text-rose-300">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-800"
      >
        {retryLabel}
      </button>
    </div>
  </div>
);

const NotFoundCard = ({ message, onBack }: { message: string; onBack: () => void }) => (
  <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
    <div className="rounded-xl border border-(--border-muted) bg-(--bg-soft) px-4 py-10 text-center">
      <h1 className="text-lg font-semibold text-(--text)">Not in your library</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 rounded-md border border-(--border-muted) px-3 py-1.5 text-xs font-medium text-(--text) transition-colors hover:bg-(--bg)"
      >
        Back to library
      </button>
    </div>
  </div>
);

const BookDetailSkeleton = () => (
  <div className="mx-auto w-full max-w-5xl animate-pulse px-4 py-6 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
      <div className="h-64 w-32 shrink-0 rounded-lg bg-gray-200 sm:w-40 dark:bg-gray-700" />
      <div className="flex-1 space-y-2">
        <div className="h-6 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-1/3 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </header>
    <div className="mb-8 space-y-2">
      <div className="h-3 w-32 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-16 w-full rounded-xl bg-gray-200 dark:bg-gray-700" />
    </div>
    <div className="space-y-2">
      <div className="h-3 w-40 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-24 w-full rounded-xl bg-gray-200 dark:bg-gray-700" />
    </div>
  </div>
);
