import type { Book } from '../types';
import { withBasePath } from '../utils/basePath';
import {
  formatFileSize,
  groupFilesByRelease,
  latestFilesByFormat,
  type BookDetailResponse,
  type LibraryFile,
} from './types';

interface BookDetailPrototypeProps {
  book: BookDetailResponse;
  metadataBook: Book | null;
  onFindReleases: () => void;
  onDownload: (file: LibraryFile) => void;
  onUnlinkRelease: (file: LibraryFile) => void;
  onSendToKindle: () => void;
  kindleFormats: string[];
  selectedKindleFormat: string | null;
  onKindleFormatChange: (format: string) => void;
}

// PROTOTYPE: editorial-first library detail, enabled only with ?prototype=detail.
export const BookDetailPrototype = ({
  book,
  metadataBook,
  onFindReleases,
  onDownload,
  onUnlinkRelease,
  onSendToKindle,
  kindleFormats,
  selectedKindleFormat,
  onKindleFormatChange,
}: BookDetailPrototypeProps) => {
  const metadata = [
    book.publish_year,
    book.series_name &&
      `${book.series_name}${book.series_position ? ` #${book.series_position}` : ''}`,
    book.language?.toUpperCase(),
    book.isbn_13 && `ISBN ${book.isbn_13}`,
  ].filter(Boolean);
  const displayFields = metadataBook?.display_fields?.slice(0, 3) ?? [];
  const releases = groupFilesByRelease(book.files);
  const latestFiles = latestFilesByFormat(book.files);
  const availabilityLabel =
    book.in_flight.length > 0 ? 'A release is downloading' : 'No files available yet';

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
      <header className="flex gap-5 border-b border-(--border-muted) pb-8">
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
          <p className="text-xs font-semibold tracking-[0.16em] text-emerald-700 uppercase dark:text-emerald-300">
            In your library
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-(--text)">{book.title}</h1>
          {book.subtitle && (
            <p className="mt-1 text-lg text-gray-600 dark:text-gray-300">{book.subtitle}</p>
          )}
          <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
            {book.author || 'Unknown author'}
          </p>
          {metadata.length > 0 && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{metadata.join(' · ')}</p>
          )}
        </div>
      </header>

      {displayFields.length > 0 && (
        <dl className="mt-6 flex flex-wrap gap-3">
          {displayFields.map((field) => (
            <div key={field.label} className="rounded-lg bg-(--bg-soft) px-3 py-2">
              <dt className="text-xs text-gray-500">{field.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-(--text)">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <article className="mt-8 max-w-4xl">
        <h2 className="text-sm font-semibold text-(--text)">About this book</h2>
        {metadataBook?.description ? (
          <p className="mt-3 leading-7 whitespace-pre-line text-gray-700 dark:text-gray-200">
            {metadataBook.description}
          </p>
        ) : (
          <p className="mt-3 leading-7 text-gray-500 dark:text-gray-400">
            No description is available from this book's metadata provider.
          </p>
        )}
      </article>

      <section className="mt-10 border-t border-(--border-muted) pt-6">
        <div>
          <h2 className="font-semibold text-(--text)">Available files</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            The newest downloaded file for each format.
          </p>
        </div>

        {releases.length > 0 ? (
          <>
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
                        className="text-sm font-medium text-sky-700 dark:text-sky-300"
                        onClick={() => onDownload(file)}
                      >
                        Download
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <aside className="rounded-lg border border-(--border-muted) px-4 py-4">
                <h3 className="text-sm font-semibold text-(--text)">Send to Kindle</h3>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {selectedKindleFormat
                    ? `Selected format: ${selectedKindleFormat.toUpperCase()}. EPUB is selected by default.`
                    : 'No Kindle-compatible EPUB file is available.'}
                </p>
                <select
                  value={selectedKindleFormat ?? 'auto'}
                  disabled={!kindleFormats.length}
                  onChange={(event) => onKindleFormatChange(event.target.value)}
                  className="mt-4 w-full rounded-md border border-(--border-muted) bg-transparent px-2 py-2 text-sm text-(--text)"
                >
                  <option value="auto">Auto (EPUB)</option>
                  {kindleFormats.map((format) => (
                    <option key={format} value={format}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedKindleFormat}
                  className="mt-2 w-full rounded-md border border-(--border-muted) px-3 py-2 text-sm font-medium text-(--text) disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onSendToKindle}
                >
                  Send {selectedKindleFormat?.toUpperCase() ?? 'file'} to Kindle
                </button>
              </aside>
            </div>

            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-300">
                Advanced: show all releases ({releases.length})
              </summary>
              <div className="mt-3 space-y-2 border-l border-(--border-muted) pl-4">
                {releases.map(([taskId, files]) => (
                  <div key={taskId} className="rounded-lg bg-(--bg-soft) px-4 py-3">
                    <div className="flex items-center gap-3">
                      <p className="min-w-0 flex-1 text-sm font-medium text-(--text)">
                        {files[0].indexer_display_name || 'Unknown source'}
                      </p>
                      {files.some((file) => file.downloadable_by_me) && (
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-700 dark:text-rose-300"
                          onClick={() => onUnlinkRelease(files[0])}
                        >
                          Unlink release
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {files.length} file{files.length === 1 ? '' : 's'} in this release
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Grabbed{' '}
                      {files[0].downloaded_at
                        ? new Date(files[0].downloaded_at).toLocaleDateString()
                        : 'date unknown'}
                      {files[0].protocol && ` · ${files[0].protocol}`}
                    </p>
                    {files.map((file) => (
                      <div key={file.history_id} className="flex items-center gap-3 pt-3 text-sm">
                        <span className="font-medium text-(--text)">
                          {file.format?.toUpperCase() || 'Unknown'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatFileSize(file.size) || 'Size unknown'}
                        </span>
                        {file.downloadable_by_me && (
                          <button
                            type="button"
                            className="ml-auto text-sm font-medium text-sky-700 dark:text-sky-300"
                            onClick={() => onDownload(file)}
                          >
                            Download
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
            <button
              type="button"
              className="mt-5 text-sm font-medium text-emerald-700 dark:text-emerald-300"
              onClick={onFindReleases}
            >
              Find another release
            </button>
          </>
        ) : (
          <div className="mt-4 rounded-lg bg-(--bg-soft) px-4 py-4">
            <button
              type="button"
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
              onClick={onFindReleases}
            >
              Find releases
            </button>
            <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {availabilityLabel}. First-add navigation may open release search once automatically.
            </p>
          </div>
        )}
      </section>
    </section>
  );
};
