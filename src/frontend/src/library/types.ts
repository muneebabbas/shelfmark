// Type contract + display helpers for the library prototype (#08).
//
// Shapes mirror the #04 / #06 contract in
// `shelfmark/core/library_routes.py:_serialize_book_detail` exactly — the
// live `GET /api/library/books/:book_id` response is the source of truth.
// Field names and nesting match the live API; no prototype-only fictions.

export interface LibraryFile {
  history_id: number;
  task_id: string;
  format: string | null;
  size: number | null;
  indexer_display_name: string | null;
  protocol: string | null;
  downloaded_at: string | null;
  downloadable_by_me: boolean;
}

export interface InFlightDownload {
  history_id: number;
  task_id: string;
  format: string | null;
  source_display_name: string | null;
}

export interface BookDetailResponse {
  book_id: number;
  metadata_provider: string | null;
  provider_book_id: string | null;
  title: string | null;
  author: string | null;
  subtitle: string | null;
  publish_year: number | null;
  isbn_13: string | null;
  cover_url: string | null;
  series_name: string | null;
  series_position: number | null;
  language: string | null;
  metadata_json: Record<string, unknown>;
  files: LibraryFile[];
  in_flight: InFlightDownload[];
  in_my_library: boolean;
}

// Per #05: default Send-to-Kindle priority is `["epub"]` only. The override
// picker lists formats actually on disk for this book; "Send <FORMAT> to Kindle"
// label reflects the resolved format. azw3/mobi remain blacklisted for Kindle
// delivery (Amazon deprecated them 2022).
export const KINDLE_FORMAT_PRIORITY = ['epub'] as const;

// Per #02 sub-decision 5: when `files_exist_globally == false` and
// `LIBRARY_AUTO_FIND_RELEASES=true`, Find Releases auto-opens on page load.
// The env-var read happens server-side; the frontend derives the auto-open
// behaviour from the resolved response (no files → empty state with the
// persistent Find Releases button) plus a config flag the backend surfaces via
// `/api/config` (wired in a follow-up; defaults to true for the prototype).
export const DEFAULT_LIBRARY_AUTO_FIND_RELEASES = true;

// Union of distinct formats across all *complete* files for the Book — the
// high-level "Formats on disk" view per #04. Deduped across releases.
export function unionFormats(files: LibraryFile[]): string[] {
  const seen = new Set<string>();
  for (const f of files) {
    if (f.format) seen.add(f.format);
  }
  return Array.from(seen);
}

// The default format view picks one concrete File per format: the newest file
// wins, with history_id making otherwise-equal timestamps deterministic.
export function latestFilesByFormat(files: LibraryFile[]): LibraryFile[] {
  const latestByFormat = new Map<string, LibraryFile>();
  for (const file of files) {
    if (!file.format) continue;
    const current = latestByFormat.get(file.format);
    if (
      !current ||
      (file.downloaded_at ?? '') > (current.downloaded_at ?? '') ||
      (file.downloaded_at === current.downloaded_at && file.history_id > current.history_id)
    ) {
      latestByFormat.set(file.format, file);
    }
  }
  return Array.from(latestByFormat.values()).sort((a, b) =>
    (a.format ?? '').localeCompare(b.format ?? ''),
  );
}

export interface ReleaseGroup {
  taskId: string;
  files: LibraryFile[];
}

export function groupFilesByRelease(files: LibraryFile[]): ReleaseGroup[] {
  const groups = new Map<string, LibraryFile[]>();
  for (const file of files) {
    const group = groups.get(file.task_id) ?? [];
    group.push(file);
    groups.set(file.task_id, group);
  }
  return Array.from(groups, ([taskId, group]) => ({
    taskId,
    files: group.sort((a, b) => (a.format ?? '').localeCompare(b.format ?? '')),
  })).sort((a, b) => {
    const latestA = Math.max(...a.files.map((file) => Date.parse(file.downloaded_at ?? '') || 0));
    const latestB = Math.max(...b.files.map((file) => Date.parse(file.downloaded_at ?? '') || 0));
    return latestB - latestA;
  });
}

// Per #05: resolve the format Send-to-Kindle will use. Default priority is
// ["epub"] only; first on-disk format in that priority wins. If no
// Kindle-compatible format is on disk, returns null (button greyed).
export function resolveKindleFormat(formatsOnDisk: string[]): string | null {
  for (const f of KINDLE_FORMAT_PRIORITY) {
    if (formatsOnDisk.includes(f)) return f;
  }
  return null;
}

export function formatSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
