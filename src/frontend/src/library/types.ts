export interface LibraryFile {
  history_id: number;
  task_id: string;
  format: string | null;
  size: number | null;
  indexer_display_name: string | null;
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
  files: LibraryFile[];
  in_flight: InFlightDownload[];
}

export const latestFilesByFormat = (files: LibraryFile[]): LibraryFile[] => {
  const latest = new Map<string, LibraryFile>();
  for (const file of files) {
    if (!file.format) continue;
    const current = latest.get(file.format);
    if (
      !current ||
      (file.downloaded_at ?? '') > (current.downloaded_at ?? '') ||
      (file.downloaded_at === current.downloaded_at && file.history_id > current.history_id)
    ) {
      latest.set(file.format, file);
    }
  }
  return [...latest.values()].toSorted((a, b) => (a.format ?? '').localeCompare(b.format ?? ''));
};

const latestTimestamp = (entries: LibraryFile[]): number =>
  Math.max(...entries.map((entry) => Date.parse(entry.downloaded_at ?? '') || 0));

export const groupFilesByRelease = (files: LibraryFile[]): Array<[string, LibraryFile[]]> => {
  const groups = new Map<string, LibraryFile[]>();
  for (const file of files) {
    groups.set(file.task_id, [...(groups.get(file.task_id) ?? []), file]);
  }
  return [...groups.entries()].toSorted(
    ([, left], [, right]) => latestTimestamp(right) - latestTimestamp(left),
  );
};

export const formatFileSize = (size: number | null): string => {
  if (size === null) return '';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};
