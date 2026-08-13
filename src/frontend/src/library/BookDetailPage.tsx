import { useCallback, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useSocket } from '../contexts/SocketContext';
import { useDependencyEffect, useMountEffect } from '../hooks/useMountEffect';
import {
  cancelLibraryReview,
  cancelRequest,
  createLibraryRequest,
  downloadConvertedLibraryEpub,
  downloadLibraryFile,
  getLibraryBook,
  getLibraryPurgePreview,
  isApiResponseError,
  listLibraryRequests,
  purgeLibraryBook,
  removeLibraryBook,
  sendLibraryBookToKindle,
  deleteLibraryRelease,
  getLibraryReleaseReview,
  replaceLibraryRelease,
  getManualImportStatus,
  uploadManualLibraryFiles,
} from '../services/api';
import type { Book, RequestRecord } from '../types';
import { withBasePath } from '../utils/basePath';
import {
  formatFileSize,
  groupFilesByRelease,
  latestFilesByFormat,
  type BookDetailResponse,
  type LibraryBookAvailabilityEvent,
  type LibraryPurgePreview,
  type LibraryFile,
  type ManualImportStatus,
  type ReleaseReviewResponse,
} from './types';
import { useNeedsReviewBooks } from './useNeedsReviewBooks';

interface BookDetailPageProps {
  autoFindReleases: boolean;
  canFindReleases: boolean;
  canDeleteReleases: boolean;
  isRequestOnly: boolean;
  isAdmin: boolean;
  onFindReleases: (book: Book) => void;
  onOpenSettings: () => void;
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
  onLibraryChanged?: () => Promise<void> | void;
  kindleSender: string;
}

interface BookDetailLocationState {
  autoFindReleases?: boolean;
}

const hasAutoFindReleasesIntent = (state: unknown): state is BookDetailLocationState =>
  typeof state === 'object' &&
  state !== null &&
  Object.getOwnPropertyDescriptor(state, 'autoFindReleases')?.value === true;

const toReleaseBook = (book: BookDetailResponse): Book => ({
  id: book.provider_book_id ?? String(book.book_id),
  book_id: book.book_id,
  provider: book.metadata_provider ?? undefined,
  provider_id: book.provider_book_id ?? undefined,
  title: book.title ?? 'Untitled',
  author: book.author ?? '',
  year: book.publish_year?.toString(),
  preview: book.cover_url ?? undefined,
  subtitle: book.subtitle ?? undefined,
  series_name: book.series_name ?? undefined,
  series_position: book.series_position ?? undefined,
});

const dateLabel = (date: string | null): string =>
  date ? new Date(date).toLocaleDateString() : 'date unknown';

const convertedEpubLabel = (file: LibraryFile): string => {
  return file.derived_epub?.status === 'ready' ? 'Download converted EPUB' : '';
};

const DownloadIcon = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4m-5 6v3h18v-3" />
  </svg>
);

const SendIcon = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-7 20-4-9-9-4 20-7Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-11 11" />
  </svg>
);

const SendingSpinner = () => (
  <svg
    className="h-4 w-4 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    aria-label="Sending to Kindle"
    role="img"
  >
    <circle cx="12" cy="12" r="9" opacity="0.25" />
    <path strokeLinecap="round" d="M21 12a9 9 0 0 0-9-9" />
  </svg>
);

const ManualUploadDialog = ({
  bookId,
  capability,
  socket,
  onClose,
  onComplete,
}: {
  bookId: number;
  capability: NonNullable<BookDetailResponse['manual_upload']>;
  socket: ReturnType<typeof useSocket>['socket'];
  onClose: () => void;
  onComplete: (fileCount: number) => Promise<void>;
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<ManualImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addFiles = (next: FileList | File[]) => {
    const additions = Array.from(next);
    const all = [...files, ...additions];
    const names = new Set<string>();
    const invalid = all.find((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const duplicate = names.has(file.name.toLowerCase());
      names.add(file.name.toLowerCase());
      return duplicate || !capability.enabled_formats.includes(extension);
    });
    if (invalid || all.length > capability.max_file_count) {
      setError(
        invalid ? `${invalid.name} is not an enabled ebook format` : 'Too many files selected',
      );
      return;
    }
    const total = all.reduce((sum, file) => sum + file.size, 0);
    if (total > capability.max_total_bytes) {
      setError('Total upload size exceeds the configured limit');
      return;
    }
    setError(null);
    setFiles(all);
  };
  const submit = async () => {
    try {
      setError(null);
      setStatus({
        activity_id: 0,
        task_id: '',
        book_id: bookId,
        state: 'uploading',
        file_count: files.length,
      });
      const accepted = await uploadManualLibraryFiles(bookId, files);
      setStatus(accepted);
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : 'Upload failed');
    }
  };
  useDependencyEffect(() => {
    if (!status || status.activity_id < 1) return undefined;
    const update = (event: ManualImportStatus) => {
      if (event.activity_id !== status.activity_id) return;
      setStatus(event);
      if (event.state === 'completed') void onComplete(event.file_count);
    };
    socket?.on('manual_import_update', update);
    const recover = () =>
      void getManualImportStatus(status.activity_id)
        .then(update)
        .catch(() => undefined);
    socket?.on('connect', recover);
    recover();
    return () => {
      socket?.off('manual_import_update', update);
      socket?.off('connect', recover);
    };
  }, [onComplete, socket, status]);
  const uploading = status?.state === 'uploading';
  const importing = status?.state === 'importing';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-upload-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-(--border-muted) bg-(--bg-soft) p-7 shadow-2xl ring-1 ring-black/10">
        <h2 id="manual-upload-title" className="text-lg font-semibold text-(--text)">
          Upload files
        </h2>
        {!status && (
          <>
            <div
              className="mt-4 rounded-lg border border-dashed border-(--border-muted) p-5 text-center text-sm text-gray-600 dark:text-gray-300"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addFiles(event.dataTransfer.files);
              }}
            >
              <label className="cursor-pointer">
                Drop ebook files here or choose files
                <input
                  className="sr-only"
                  type="file"
                  multiple
                  onChange={(event) => addFiles(event.target.files ?? [])}
                />
              </label>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {files.map((file, index) => (
                <li key={file.name} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {file.name} ({formatFileSize(String(file.size))})
                  </span>
                  <button
                    type="button"
                    className="hover-action rounded px-1 text-rose-700"
                    onClick={() => setFiles(files.filter((_, current) => current !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {uploading && (
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
            Uploading {status.file_count} file{status.file_count === 1 ? '' : 's'}...
          </p>
        )}
        {importing && (
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
            Importing {status.file_count} file{status.file_count === 1 ? '' : 's'}...
          </p>
        )}
        {status?.state === 'completed' && (
          <p className="mt-4 text-sm text-emerald-700">
            Manual release added: {status.file_count} files
          </p>
        )}
        {status?.state === 'failed' && (
          <p className="mt-4 text-sm text-rose-700">{status.message ?? 'Manual import failed'}</p>
        )}
        {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="hover-action rounded-md px-3 py-2 text-sm"
            onClick={onClose}
          >
            {status ? 'Close' : 'Cancel'}
          </button>
          {!status && (
            <button
              type="button"
              disabled={!files.length}
              className="cursor-pointer rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void submit()}
            >
              Upload files
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const shouldAutoFindReleases = ({
  canFindReleases,
  autoFindReleases,
  firstAddIntent,
  hasFiles,
  hasInFlight,
  alreadyOpened,
}: {
  canFindReleases: boolean;
  autoFindReleases: boolean;
  firstAddIntent: boolean;
  hasFiles: boolean;
  hasInFlight: boolean;
  alreadyOpened: boolean;
}): boolean =>
  canFindReleases &&
  autoFindReleases &&
  firstAddIntent &&
  !hasFiles &&
  !hasInFlight &&
  !alreadyOpened;

export const bookMembershipLabel = (inMyLibrary: boolean): string =>
  inMyLibrary ? 'In your library' : 'Not in your library';

const RequestState = ({
  request,
  onRequest,
  onCancel,
}: {
  request: RequestRecord | undefined;
  onRequest: () => void;
  onCancel: () => void;
}) => {
  if (!request) {
    return (
      <div className="mt-4 rounded-lg bg-(--bg-soft) px-4 py-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          No files are available yet. Request this book and an administrator will find a release.
        </p>
        <button
          type="button"
          className="mt-3 cursor-pointer rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800"
          onClick={onRequest}
        >
          Request this book
        </button>
      </div>
    );
  }

  const labels = {
    pending: 'Request pending',
    cancelled: 'Request cancelled',
    fulfilled: 'Book available',
    rejected: 'Request declined',
  } as const;
  return (
    <div className="mt-4 rounded-lg bg-(--bg-soft) px-4 py-4">
      <p className="text-sm font-medium text-(--text)">{labels[request.status]}</p>
      {request.status === 'pending' && (
        <button
          type="button"
          className="hover-action mt-3 cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-rose-700 dark:text-rose-300"
          onClick={onCancel}
        >
          Cancel request
        </button>
      )}
    </div>
  );
};

const AvailableFiles = ({
  book,
  canFindReleases,
  canDeleteReleases,
  onDownload,
  onDownloadConverted,
  onFindReleases,
  onOpenSettings,
  onSendToKindle,
  onDeleteRelease,
  onReviewSource,
  advancedOpen,
  onAdvancedOpenChange,
  kindleSender,
}: {
  book: BookDetailResponse;
  canFindReleases: boolean;
  canDeleteReleases: boolean;
  onDownload: (file: LibraryFile) => void;
  onDownloadConverted: (file: LibraryFile) => void;
  onFindReleases: () => void;
  onOpenSettings: () => void;
  onSendToKindle: (selection: { format?: string; historyId?: number }) => Promise<void>;
  onDeleteRelease: (file: LibraryFile) => void;
  onReviewSource: (file: LibraryFile) => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  kindleSender: string;
}) => {
  const [kindleFormat, setKindleFormat] = useState('epub');
  const [sendingKindle, setSendingKindle] = useState<number | 'latest' | null>(null);
  const [convertedMenuHistoryId, setConvertedMenuHistoryId] = useState<number | null>(null);
  const convertedMenuRef = useRef<HTMLDivElement | null>(null);
  const releases = groupFilesByRelease(book.files);
  const latestFiles = latestFilesByFormat(book.files);
  const kindleFiles = latestFilesByFormat(
    book.files.filter(
      (file) =>
        file.downloadable_by_me &&
        (file.format?.toLowerCase() !== 'azw3' || file.derived_epub?.status === 'ready'),
    ),
  );
  const kindleFormats = [
    ...new Set(
      kindleFiles
        .map((file) => file.format?.toLowerCase())
        .filter((format): format is string => format === 'epub' || format === 'azw3'),
    ),
  ];
  const selectedKindleFormat = kindleFormats.includes(kindleFormat)
    ? kindleFormat
    : (kindleFormats[0] ?? null);
  const selectedAzw3 = selectedKindleFormat === 'azw3';
  const selectedAzw3File = kindleFiles
    .filter((file) => file.format?.toLowerCase() === 'azw3')
    .toSorted(
      (left, right) =>
        (right.downloaded_at ?? '').localeCompare(left.downloaded_at ?? '') ||
        right.history_id - left.history_id,
    )[0];
  const selectedAzw3Ready = selectedAzw3File?.derived_epub?.status === 'ready';
  const handleConvertedAction = (file: LibraryFile) => {
    onDownloadConverted(file);
  };
  let kindleButtonLabel = `Send ${selectedKindleFormat?.toUpperCase() ?? 'file'} to Kindle`;
  if (sendingKindle === 'latest') kindleButtonLabel = 'Sending to Kindle';
  const advancedKindleTitle = (file: LibraryFile): string => {
    if (file.format?.toLowerCase() === 'azw3') return 'A converted EPUB will be sent to Kindle';
    if (file.format?.toLowerCase() === 'epub') return `Email will come from ${kindleSender}`;
    return 'Send to Kindle is available for EPUB files only';
  };
  const sendToKindle = async (
    selection: { format?: string; historyId?: number },
    sender: number | 'latest',
  ) => {
    setSendingKindle(sender);
    try {
      await onSendToKindle(selection);
    } finally {
      setSendingKindle(null);
    }
  };

  useDependencyEffect(() => {
    if (convertedMenuHistoryId === null) return undefined;
    const dismissMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && convertedMenuRef.current?.contains(target)) return;
      setConvertedMenuHistoryId(null);
    };
    window.addEventListener('mousedown', dismissMenu);
    return () => window.removeEventListener('mousedown', dismissMenu);
  }, [convertedMenuHistoryId]);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-(--text)">Available files</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            The newest downloaded file for each format.
          </p>
        </div>
        {canFindReleases && (
          <button
            type="button"
            className="hover-action cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-300"
            onClick={onFindReleases}
          >
            Find another release
          </button>
        )}
      </div>
      {latestFiles.length > 0 ? (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="rounded-lg bg-(--bg-soft) px-4 py-2">
            {latestFiles.map((file) => (
              <div
                key={file.history_id}
                className="flex items-center gap-3 border-b border-(--border-muted) py-3 last:border-0"
              >
                <span className="w-16 text-sm font-semibold text-(--text)">
                  {file.format?.toUpperCase() || 'Unknown'}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {formatFileSize(file.size) || 'Size unknown'}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
                  {file.indexer_display_name || 'Unknown source'}
                </span>
                {file.downloadable_by_me && (
                  <button
                    type="button"
                    className="hover-action cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-sky-700 dark:text-sky-300"
                    onClick={() => onDownload(file)}
                  >
                    Download
                  </button>
                )}
                {file.downloadable_by_me &&
                  file.format?.toLowerCase() === 'azw3' &&
                  file.derived_epub?.status === 'ready' && (
                    <button
                      type="button"
                      className="hover-action cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-(--text) disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => handleConvertedAction(file)}
                    >
                      {convertedEpubLabel(file)}
                    </button>
                  )}
              </div>
            ))}
          </div>
          <aside className="rounded-lg border border-(--border-muted) px-4 py-4">
            <h3 className="text-sm font-semibold text-(--text)">Send to Kindle</h3>
            <select
              value={selectedKindleFormat ?? ''}
              disabled={!kindleFormats.length}
              onChange={(event) => setKindleFormat(event.target.value)}
              className="mt-4 w-full rounded-md border border-(--border-muted) bg-(--bg) px-2 py-2 text-sm text-(--text)"
            >
              {kindleFormats.map((format) => (
                <option key={format} value={format} className="bg-(--bg) text-(--text)">
                  {format.toUpperCase()}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={
                !selectedKindleFormat ||
                sendingKindle !== null ||
                (selectedAzw3 && !selectedAzw3Ready)
              }
              className={`mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-(--border-muted) px-3 py-2 text-sm font-medium text-(--text) disabled:cursor-not-allowed disabled:opacity-50 ${selectedKindleFormat && sendingKindle === null ? 'hover-action cursor-pointer' : ''}`}
              onClick={() =>
                selectedKindleFormat &&
                void sendToKindle({ format: selectedKindleFormat }, 'latest')
              }
            >
              {sendingKindle === 'latest' && <SendingSpinner />}
              {kindleButtonLabel}
            </button>
            {selectedAzw3 && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                A converted EPUB will be sent to Kindle.
              </p>
            )}
            {kindleSender && (
              <p className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                Emails come from {kindleSender}
              </p>
            )}
            <button
              type="button"
              className="hover-action mt-3 cursor-pointer rounded-md px-2 py-1 text-xs text-emerald-700 underline dark:text-emerald-300"
              onClick={onOpenSettings}
            >
              Configure Kindle email in Settings
            </button>
          </aside>
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-(--bg-soft) px-4 py-4 text-sm text-gray-600 dark:text-gray-300">
          {book.in_flight.length ? 'A release is downloading.' : 'No files are available yet.'}
        </div>
      )}
      <details
        open={advancedOpen}
        className="mt-6"
        onToggle={(event) => onAdvancedOpenChange(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-300">
          Advanced: show all releases{releases.length ? ` (${releases.length})` : ''}
        </summary>
        {releases.length > 0 && (
          <div className="mt-3 space-y-2 border-l border-(--border-muted) pl-4">
            {releases.map(([taskId, files]) => (
              <div key={taskId} className="rounded-lg bg-(--bg-soft) px-4 py-3">
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-sm font-medium text-(--text)">
                    {files[0].indexer_display_name || 'Unknown source'}
                  </p>
                  {canDeleteReleases && (
                    <div className="ml-auto flex gap-2">
                      {files[0].import_activity_id && !files[0].is_manual_upload && (
                        <button
                          type="button"
                          className="hover-action rounded-md px-2 py-1 text-xs font-medium text-violet-700 dark:text-violet-300"
                          onClick={() => onReviewSource(files[0])}
                        >
                          Review source files
                        </button>
                      )}
                      <button
                        type="button"
                        className="hover-action rounded-md px-2 py-1 text-xs font-medium text-rose-700 dark:text-rose-300"
                        onClick={() => onDeleteRelease(files[0])}
                      >
                        Delete release
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {files.length} file{files.length === 1 ? '' : 's'} in this release · Grabbed{' '}
                  {dateLabel(files[0].downloaded_at)}
                  {!files[0].is_manual_upload && files[0].protocol && ` · ${files[0].protocol}`}
                </p>
                {files.map((file) => (
                  <div key={file.history_id} className="flex items-center gap-3 pt-3 text-sm">
                    <span className="font-medium text-(--text)">
                      {file.format?.toUpperCase() || 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatFileSize(file.size) || 'Size unknown'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
                      {file.torrent_path || file.download_path || 'Path unknown'}
                    </span>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={!file.downloadable_by_me}
                        title={
                          file.downloadable_by_me
                            ? `Download ${file.download_path ?? 'file'}`
                            : 'Download is not available to you'
                        }
                        aria-label="Download"
                        className={`rounded-md p-2 text-sky-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-sky-300 ${file.downloadable_by_me ? 'hover-action cursor-pointer' : ''}`}
                        onClick={() => onDownload(file)}
                      >
                        <DownloadIcon />
                      </button>
                      <button
                        type="button"
                        disabled={
                          !['epub', 'azw3'].includes(file.format?.toLowerCase() ?? '') ||
                          sendingKindle !== null ||
                          (file.format?.toLowerCase() === 'azw3' &&
                            file.derived_epub?.status !== 'ready')
                        }
                        title={advancedKindleTitle(file)}
                        aria-label={
                          file.format?.toLowerCase() === 'azw3' &&
                          file.derived_epub?.status !== 'ready'
                            ? advancedKindleTitle(file)
                            : 'Send to Kindle'
                        }
                        className={`rounded-md p-2 text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300 ${(file.format?.toLowerCase() === 'epub' || (file.format?.toLowerCase() === 'azw3' && file.derived_epub?.status === 'ready')) && sendingKindle === null ? 'hover-action cursor-pointer' : ''}`}
                        onClick={() =>
                          void sendToKindle({ historyId: file.history_id }, file.history_id)
                        }
                      >
                        {sendingKindle === file.history_id ? <SendingSpinner /> : <SendIcon />}
                      </button>
                      {file.downloadable_by_me &&
                        file.format?.toLowerCase() === 'azw3' &&
                        file.derived_epub?.status === 'ready' && (
                          <div
                            ref={
                              convertedMenuHistoryId === file.history_id
                                ? convertedMenuRef
                                : undefined
                            }
                            className="relative"
                          >
                            <button
                              type="button"
                              title={convertedEpubLabel(file)}
                              aria-label="More AZW3 actions"
                              aria-expanded={convertedMenuHistoryId === file.history_id}
                              className="hover-action rounded-md px-2 py-1 text-xs font-medium text-(--text)"
                              onClick={() =>
                                setConvertedMenuHistoryId((current) =>
                                  current === file.history_id ? null : file.history_id,
                                )
                              }
                            >
                              ...
                            </button>
                            {convertedMenuHistoryId === file.history_id && (
                              <button
                                type="button"
                                className="hover-action absolute right-0 bottom-full z-30 mb-1 w-52 rounded-md border border-(--border-muted) bg-(--bg) px-3 py-2 text-left text-xs font-medium text-(--text) shadow-lg"
                                onClick={() => handleConvertedAction(file)}
                              >
                                Download converted EPUB
                              </button>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </details>
    </section>
  );
};

interface SourceMemberTree {
  directories: Map<string, SourceMemberTree>;
  members: ReleaseReviewResponse['members'];
}

const createSourceMemberTree = (members: ReleaseReviewResponse['members']): SourceMemberTree => {
  const root: SourceMemberTree = { directories: new Map(), members: [] };
  for (const member of members) {
    const path = member.relative_path.split('/').filter(Boolean);
    const filename = path.pop();
    if (!filename) continue;

    let directory = root;
    for (const segment of path) {
      let child = directory.directories.get(segment);
      if (!child) {
        child = { directories: new Map(), members: [] };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.members.push(member);
  }
  return root;
};

const sourceMembers = (tree: SourceMemberTree): ReleaseReviewResponse['members'] => [
  ...tree.members,
  ...[...tree.directories.values()].flatMap(sourceMembers),
];

const SourceMemberTreeView = ({
  tree,
  selected,
  onSelect,
}: {
  tree: SourceMemberTree;
  selected: number[];
  onSelect: (memberIds: number[], checked: boolean) => void;
}) => {
  const selectedIds = new Set(selected);
  const directories = [...tree.directories.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  const members = tree.members.toSorted((left, right) =>
    left.relative_path.localeCompare(right.relative_path),
  );

  return (
    <>
      {directories.map(([name, child]) => {
        const selectableIds = sourceMembers(child)
          .filter((member) => member.available)
          .map((member) => member.id);
        const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;

        return (
          <details key={name} className="border-b border-(--border-muted) last:border-0" open>
            <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-(--hover-row)">
              <input
                checked={selectableIds.length > 0 && selectedCount === selectableIds.length}
                disabled={!selectableIds.length}
                aria-label={`Select all files in ${name}`}
                className="h-4 w-4 accent-violet-700"
                type="checkbox"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onSelect(selectableIds, event.target.checked)}
              />
              <span className="text-sm font-medium text-(--text)">{name}</span>
              <span className="text-xs text-gray-500">
                {selectedCount ? `${selectedCount} of ` : ''}
                {selectableIds.length} selectable
              </span>
            </summary>
            <div className="border-l border-(--border-muted) pl-4">
              <SourceMemberTreeView tree={child} selected={selected} onSelect={onSelect} />
            </div>
          </details>
        );
      })}
      {members.map((member) => (
        <label
          key={member.id}
          className={`flex gap-3 border-b border-(--border-muted) px-4 py-3 last:border-0 ${member.available ? 'cursor-pointer hover:bg-(--hover-row)' : 'opacity-55'}`}
        >
          <input
            checked={selectedIds.has(member.id)}
            disabled={!member.available}
            aria-label={`Select ${member.relative_path}`}
            className="mt-0.5 h-4 w-4 accent-violet-700"
            type="checkbox"
            onChange={(event) => onSelect([member.id], event.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium break-all text-(--text)">
                {member.relative_path.split('/').pop()}
              </span>
              {!member.available && (
                <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                  Unavailable
                </span>
              )}
            </span>
            <span className="mt-1 block text-xs text-gray-500">
              {member.format?.toUpperCase() ?? 'Unknown'} ·{' '}
              {formatFileSize(member.size?.toString() ?? null) || 'Size unknown'}
            </span>
          </span>
        </label>
      ))}
    </>
  );
};

const SourceReview = ({
  book,
  activityId,
  onClose,
  onDelete,
  onComplete,
}: {
  book: BookDetailResponse;
  activityId: number;
  onClose: () => void;
  onDelete: () => void;
  onComplete: () => Promise<void>;
}) => {
  const [review, setReview] = useState<ReleaseReviewResponse | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useMountEffect(() => {
    void getLibraryReleaseReview(book.book_id, activityId)
      .then(setReview)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Failed to load retained source files'),
      );
  });

  const selectMembers = (memberIds: number[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const memberId of memberIds) {
        if (checked) next.add(memberId);
        else next.delete(memberId);
      }
      return [...next];
    });
  };

  const confirm = async () => {
    setSubmitting(true);
    try {
      await replaceLibraryRelease(book.book_id, activityId, selected);
      await onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to replace release');
      setSubmitting(false);
    }
  };

  if (!review && !error) return <BookDetailSkeleton />;
  if (!review) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-10">
        <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
        <button
          type="button"
          className="hover-action mt-4 rounded-md px-3 py-2 text-sm"
          onClick={onClose}
        >
          Back to book
        </button>
      </section>
    );
  }

  const tree = createSourceMemberTree(review.members);
  const availableMemberIds = review.members
    .filter((member) => member.available)
    .map((member) => member.id);
  const allAvailableSelected =
    availableMemberIds.length > 0 &&
    availableMemberIds.every((memberId) => selected.includes(memberId));

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10">
      <button type="button" className="hover-action rounded-md px-2 py-1 text-sm" onClick={onClose}>
        <span aria-hidden="true">&larr;</span> Back to {book.title ?? 'book'}
      </button>
      <header className="mt-6">
        <p className="text-xs font-bold tracking-[0.18em] text-violet-700 uppercase dark:text-violet-300">
          Manual review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-(--text)">
          Review source files
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {book.title} {book.author ? `· ${book.author}` : ''}
        </p>
      </header>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-(--bg-soft) p-4">
          <p className="text-xs font-bold text-gray-500 uppercase">Source</p>
          <p className="mt-2 text-sm break-all text-(--text)">{review.source_key}</p>
        </div>
        <div className="rounded-lg bg-(--bg-soft) p-4">
          <p className="text-xs font-bold text-gray-500 uppercase">Retention</p>
          <p className="mt-2 text-sm text-(--text)">Original files available for correction</p>
        </div>
      </div>
      <section className="mt-6 rounded-xl border border-(--border-muted) bg-(--bg-soft)">
        <div className="border-b border-(--border-muted) px-4 py-3">
          <p className="font-semibold text-(--text)">Choose files to import</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Nothing is selected automatically. Select at least one file to import into immutable
            storage.
          </p>
        </div>
        <div className="max-h-[min(60vh,36rem)] overflow-y-auto">
          <SourceMemberTreeView tree={tree} selected={selected} onSelect={selectMembers} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-muted) px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-(--text)">{selected.length} selected</span>
            <button
              type="button"
              className="hover-action rounded-md px-2 py-1 text-sm"
              onClick={() => selectMembers(availableMemberIds, !allAvailableSelected)}
            >
              {allAvailableSelected ? 'Clear selection' : 'Select all'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="hover-action rounded-md px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
              onClick={onDelete}
            >
              Delete release
            </button>
            <button
              disabled={!selected.length}
              type="button"
              className="rounded-md bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800"
              data-button-highlight="none"
              onClick={() => setConfirming(true)}
            >
              Review selection
            </button>
          </div>
        </div>
      </section>
      {error && <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {confirming && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-xl bg-(--bg) p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-(--text)">Import selected files?</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {selected.length} selected file{selected.length === 1 ? '' : 's'} will be imported
              into immutable storage under {review.destination}.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="hover-action rounded-md px-3 py-2 text-sm"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                disabled={submitting}
                type="button"
                className="rounded-md bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800"
                data-button-highlight="none"
                onClick={() => void confirm()}
              >
                Import {selected.length} file{selected.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const DeleteBookDialog = ({
  book,
  isAdmin,
  onClose,
  onDelete,
}: {
  book: BookDetailResponse;
  isAdmin: boolean;
  onClose: () => void;
  onDelete: (purge: boolean) => Promise<void>;
}) => {
  const [deleteForAll, setDeleteForAll] = useState(!book.in_my_library);
  const [preview, setPreview] = useState<LibraryPurgePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleDeleteForAll = async (checked: boolean) => {
    setDeleteForAll(checked);
    setError(null);
    if (!checked || preview) return;
    try {
      setPreview(await getLibraryPurgePreview(book.book_id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load affected users');
    }
  };

  useMountEffect(() => {
    if (book.in_my_library) return;
    void getLibraryPurgePreview(book.book_id)
      .then(setPreview)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Failed to load affected users');
      });
  });

  const confirm = async () => {
    setSubmitting(true);
    try {
      await onDelete(deleteForAll);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to delete book');
      setSubmitting(false);
    }
  };

  const canPurge = deleteForAll && preview !== null && !error;
  return (
    <div
      aria-labelledby="delete-book-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl bg-(--bg) p-6 shadow-xl">
        <h2 id="delete-book-title" className="text-lg font-semibold text-(--text)">
          Remove {book.title || 'book'}?
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {book.in_my_library
            ? 'This removes the book from your library.'
            : 'This permanently removes the book for every user.'}
        </p>
        {isAdmin && book.in_my_library && (
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-(--text)">
            <input
              checked={deleteForAll}
              type="checkbox"
              onChange={(event) => void toggleDeleteForAll(event.target.checked)}
            />
            <span>Delete for all users</span>
          </label>
        )}
        {deleteForAll && (
          <div className="mt-4 rounded-lg bg-(--bg-soft) p-3 text-sm">
            <p className="font-medium text-(--text)">Affected users</p>
            {preview && (
              <ul className="mt-2 list-disc pl-5 text-gray-600 dark:text-gray-300">
                {preview.users.map((user) => (
                  <li key={user.username}>{user.display_name || user.username}</li>
                ))}
              </ul>
            )}
            {!preview && !error && <p className="mt-2 text-gray-600">Loading users...</p>}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="hover-action rounded-md px-3 py-2 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-md bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              submitting || (isAdmin && !book.in_my_library ? !canPurge : deleteForAll && !canPurge)
            }
            onClick={() => void confirm()}
          >
            {deleteForAll || !book.in_my_library
              ? 'Delete for all users'
              : 'Remove from my library'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const BookDetailPage = ({
  autoFindReleases,
  canFindReleases,
  canDeleteReleases,
  isRequestOnly,
  isAdmin,
  onFindReleases,
  onOpenSettings,
  onShowToast,
  onLibraryChanged,
  kindleSender,
}: BookDetailPageProps) => {
  const { bookId: rawBookId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { socket } = useSocket();
  const bookId = Number(rawBookId);
  const [book, setBook] = useState<BookDetailResponse | null>(null);
  const [request, setRequest] = useState<RequestRecord>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoOpenedFor, setAutoOpenedFor] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reviewOpenedFromInbox, setReviewOpenedFromInbox] = useState(false);
  const [sourceReviewActivityId, setSourceReviewActivityId] = useState<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualUploadOpen, setManualUploadOpen] = useState(false);
  const needsReview = useNeedsReviewBooks(isAdmin);
  const firstAddIntent = hasAutoFindReleasesIntent(location.state);
  const libraryUrl = `/library${location.search}`;

  const load = useCallback(async () => {
    if (!Number.isInteger(bookId) || bookId < 1) {
      setError('Not in your library');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [detail, requests] = await Promise.all([
        getLibraryBook(bookId),
        isRequestOnly ? listLibraryRequests() : Promise.resolve([]),
      ]);
      setBook(detail);
      // Cancelled Requests are history; cancellation feedback is shown as a toast.
      setRequest(
        requests.find((entry) => Number(entry.book_id) === bookId && entry.status !== 'cancelled'),
      );
    } catch (caught) {
      if (isApiResponseError(caught) && (caught.status === 403 || caught.status === 404)) {
        setError('Not in your library');
      } else {
        setError(caught instanceof Error ? caught.message : 'Failed to load this book');
      }
    } finally {
      setLoading(false);
    }
  }, [bookId, isRequestOnly]);

  useDependencyEffect(() => {
    void load();
  }, [load]);

  useDependencyEffect(() => {
    const onAvailability = (event: LibraryBookAvailabilityEvent) => {
      if (event.book_id === bookId) void load();
    };
    socket?.on('library_book_availability', onAvailability);
    return () => {
      socket?.off('library_book_availability', onAvailability);
    };
  }, [bookId, load, socket]);

  useDependencyEffect(() => {
    if (reviewOpenedFromInbox) return;
    const rawReviewActivityId = searchParams.get('review');
    const activityId = Number(rawReviewActivityId);
    if (!rawReviewActivityId || !Number.isInteger(activityId) || activityId < 1) return;
    setReviewOpenedFromInbox(true);
    setSourceReviewActivityId(activityId);
    void navigate(location.pathname, { replace: true });
  }, [location.pathname, navigate, reviewOpenedFromInbox, searchParams]);

  useDependencyEffect(() => {
    if (
      book &&
      shouldAutoFindReleases({
        canFindReleases,
        autoFindReleases,
        firstAddIntent,
        hasFiles: book.files.length > 0,
        hasInFlight: book.in_flight.length > 0,
        alreadyOpened: autoOpenedFor === book.book_id,
      })
    ) {
      setAutoOpenedFor(book.book_id);
      void navigate(location.pathname, { replace: true, state: null });
      onFindReleases(toReleaseBook(book));
    }
  }, [
    autoFindReleases,
    autoOpenedFor,
    book,
    canFindReleases,
    firstAddIntent,
    location.pathname,
    navigate,
    onFindReleases,
  ]);

  const mutate = async (action: () => Promise<void>, success: string, reload = true) => {
    try {
      await action();
      onShowToast(success, 'success');
      if (reload) await load();
    } catch (caught) {
      onShowToast(caught instanceof Error ? caught.message : 'Action failed', 'error');
    }
  };

  if (loading) return <BookDetailSkeleton />;
  if (error) {
    const unavailable = error === 'Not in your library';
    return (
      <section className="mx-auto max-w-5xl px-4 py-10 text-center sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold text-(--text)">{error}</h1>
        <div className="mt-4 flex justify-center gap-3">
          {!unavailable && (
            <button
              type="button"
              className="hover-action cursor-pointer rounded-md border border-(--border-muted) px-3 py-2 text-sm"
              onClick={() => void load()}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="hover-action cursor-pointer rounded-md border border-(--border-muted) px-3 py-2 text-sm"
            onClick={() => void navigate(libraryUrl)}
          >
            Back to Library
          </button>
        </div>
      </section>
    );
  }
  if (!book) return null;

  if (sourceReviewActivityId !== null) {
    const reviewedFile = book.files.find(
      (file) => file.import_activity_id === sourceReviewActivityId,
    );
    return (
      <SourceReview
        book={book}
        activityId={sourceReviewActivityId}
        onClose={() => setSourceReviewActivityId(null)}
        onDelete={() => {
          if (reviewedFile) {
            void mutate(
              () => deleteLibraryRelease(book.book_id, reviewedFile.history_id),
              'Release deleted',
            ).then(() => setSourceReviewActivityId(null));
            return;
          }
          // No relevant files were imported — cancel the pending review.
          void mutate(
            () => cancelLibraryReview(book.book_id, sourceReviewActivityId),
            'Removed from review',
          ).then(() => setSourceReviewActivityId(null));
        }}
        onComplete={async () => {
          await load();
          setSourceReviewActivityId(null);
          onShowToast('Release imported', 'success');
        }}
      />
    );
  }

  const metadata = [
    book.publish_year,
    book.series_name &&
      `${book.series_name}${book.series_position ? ` #${book.series_position}` : ''}`,
    book.language?.toUpperCase(),
    book.isbn_13 && `ISBN ${book.isbn_13}`,
  ].filter(Boolean);

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
      <header className="border-b border-(--border-muted) pb-8">
        <button
          type="button"
          className="hover-action mb-5 cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-(--text)"
          onClick={() => void navigate(libraryUrl)}
        >
          <span aria-hidden="true">&larr;</span> Back to Library
        </button>
        <div className="flex gap-5">
          {book.cover_url ? (
            <img
              src={withBasePath(book.cover_url)}
              alt={`Cover of ${book.title ?? 'book'}`}
              className="h-52 w-36 rounded-lg object-cover shadow-lg"
            />
          ) : (
            <div className="flex h-52 w-36 items-center justify-center rounded-lg bg-(--bg-soft) text-xs text-gray-500">
              No cover
            </div>
          )}
          <div className="min-w-0 self-end">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold tracking-[0.16em] text-emerald-700 uppercase dark:text-emerald-300">
                {bookMembershipLabel(book.in_my_library)}
              </p>
              {needsReview.byBookId[book.book_id] !== undefined && (
                <Link
                  to={`/inbox/${book.book_id}`}
                  className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                >
                  Needs review
                </Link>
              )}
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-(--text)">
              {book.title}
            </h1>
            {book.subtitle && (
              <p className="mt-1 text-lg text-gray-600 dark:text-gray-300">{book.subtitle}</p>
            )}
            <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
              {book.author || 'Unknown author'}
            </p>
            {metadata.length > 0 && (
              <p className="mt-3 text-xs text-gray-500">{metadata.join(' · ')}</p>
            )}
          </div>
          {(book.in_my_library || isAdmin) && (
            <button
              type="button"
              className="hover-action ml-auto self-end rounded-md px-2 py-1 text-sm font-medium text-rose-700 dark:text-rose-300"
              onClick={() => setDeleteDialogOpen(true)}
            >
              Delete book
            </button>
          )}
          {book.manual_upload && (
            <button
              type="button"
              className="hover-action self-end rounded-md px-2 py-1 text-sm font-medium text-violet-700 dark:text-violet-300"
              onClick={() => setManualUploadOpen(true)}
            >
              Upload files
            </button>
          )}
        </div>
      </header>
      {book.metadata_json?.display_fields?.length ? (
        <dl className="mt-6 flex flex-wrap gap-3">
          {book.metadata_json.display_fields.slice(0, 3).map((field) => (
            <div key={field.label} className="rounded-lg bg-(--bg-soft) px-3 py-2">
              <dt className="text-xs text-gray-500">{field.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-(--text)">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {isRequestOnly && book.files.length === 0 ? (
        <section className="mt-10">
          <h2 className="font-semibold text-(--text)">Availability</h2>
          <RequestState
            request={request}
            onRequest={() =>
              void mutate(async () => {
                await createLibraryRequest(book.book_id);
              }, 'Book requested')
            }
            onCancel={() =>
              request &&
              void mutate(async () => {
                await cancelRequest(request.id);
              }, 'Request cancelled')
            }
          />
        </section>
      ) : (
        <AvailableFiles
          book={book}
          canFindReleases={canFindReleases}
          canDeleteReleases={canDeleteReleases}
          onDownload={(file) =>
            void mutate(
              () => downloadLibraryFile(book.book_id, { historyId: file.history_id }),
              'Download started',
              false,
            )
          }
          onDownloadConverted={(file) =>
            void mutate(
              () => downloadConvertedLibraryEpub(book.book_id, file.history_id),
              'Download started',
              false,
            )
          }
          onFindReleases={() => onFindReleases(toReleaseBook(book))}
          onOpenSettings={onOpenSettings}
          onSendToKindle={async (selection) => {
            await mutate(
              async () => {
                await sendLibraryBookToKindle(book.book_id, selection);
              },
              'Sent to Kindle',
              false,
            );
          }}
          onDeleteRelease={(file) =>
            void mutate(
              () => deleteLibraryRelease(book.book_id, file.history_id),
              'Release deleted',
            )
          }
          onReviewSource={(file) => {
            if (file.import_activity_id) setSourceReviewActivityId(file.import_activity_id);
          }}
          advancedOpen={advancedOpen}
          onAdvancedOpenChange={setAdvancedOpen}
          kindleSender={kindleSender}
        />
      )}
      <article className="mt-10 max-w-4xl border-t border-(--border-muted) pt-6">
        <h2 className="text-sm font-semibold text-(--text)">About this book</h2>
        <p className="mt-3 leading-7 whitespace-pre-line text-gray-700 dark:text-gray-200">
          {book.metadata_json?.description ||
            "No description is available from this book's metadata provider."}
        </p>
      </article>
      {deleteDialogOpen && (
        <DeleteBookDialog
          book={book}
          isAdmin={isAdmin}
          onClose={() => setDeleteDialogOpen(false)}
          onDelete={async (purge) => {
            if (purge || !book.in_my_library) {
              await purgeLibraryBook(book.book_id);
              onShowToast('Book deleted for all users', 'success');
            } else {
              await removeLibraryBook(book.book_id);
              onShowToast('Book removed from your library', 'success');
            }
            await onLibraryChanged?.();
            await navigate(libraryUrl);
          }}
        />
      )}
      {manualUploadOpen && book.manual_upload && (
        <ManualUploadDialog
          bookId={book.book_id}
          capability={book.manual_upload}
          socket={socket}
          onClose={() => setManualUploadOpen(false)}
          onComplete={async (fileCount) => {
            await load();
            onShowToast(`Manual release added: ${fileCount} files`, 'success');
            setManualUploadOpen(false);
          }}
        />
      )}
    </section>
  );
};

const BookDetailSkeleton = () => (
  <section className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6 lg:px-10">
    <div className="h-52 w-36 rounded bg-gray-200 dark:bg-gray-700" />
    <div className="mt-6 h-20 rounded-xl bg-gray-200 dark:bg-gray-700" />
  </section>
);
