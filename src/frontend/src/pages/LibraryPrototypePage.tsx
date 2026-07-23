import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

type LibraryBook = {
  id: number;
  title: string;
  author: string;
  formats: string[];
  coverUrl?: string;
};

const BOOKS: LibraryBook[] = [
  { id: 1, title: 'A Memory Called Empire', author: 'Arkady Martine', formats: ['EPUB'] },
  {
    id: 2,
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    formats: ['EPUB', 'MOBI'],
  },
  { id: 3, title: 'Piranesi', author: 'Susanna Clarke', formats: [] },
  { id: 4, title: 'Kindred', author: 'Octavia E. Butler', formats: ['EPUB', 'AZW3'] },
  { id: 5, title: 'Babel', author: 'R. F. Kuang', formats: [] },
  { id: 6, title: 'The Dispossessed', author: 'Ursula K. Le Guin', formats: ['EPUB'] },
];

const VARIANTS = [
  ['A', 'Cover shelf'],
  ['B', 'Reading queue'],
  ['C', 'Library index'],
] as const;

const BookCover = ({ book, compact = false }: { book: LibraryBook; compact?: boolean }) => (
  <div
    className={`flex shrink-0 items-center justify-center bg-linear-to-br from-indigo-950 via-violet-800 to-fuchsia-700 text-4xl font-semibold text-white shadow-inner ${
      compact ? 'h-20 w-14 rounded-md text-xl' : 'aspect-[2/3] w-full rounded-lg'
    }`}
  >
    {book.title[0]}
  </div>
);

const FormatBadges = ({ formats }: { formats: string[] }) =>
  formats.length ? (
    <div className="flex flex-wrap gap-1">
      {formats.map((format) => (
        <span
          key={format}
          className="rounded bg-(--hover-surface) px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
        >
          {format}
        </span>
      ))}
    </div>
  ) : null;

const FindBookButton = () => (
  <button
    type="button"
    className="rounded-md border border-violet-500 px-2.5 py-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300"
    onClick={() => window.alert('Prototype: opens Find Releases on the book detail page.')}
  >
    Find this book
  </button>
);

const CoverShelf = ({ books }: { books: LibraryBook[] }) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
    {books.map((book) => (
      <article key={book.id} className="group min-w-0">
        <a
          href={`/library/${book.id}`}
          className="block transition-transform group-hover:-translate-y-1"
        >
          <BookCover book={book} />
          <h2 className="mt-3 truncate font-semibold">{book.title}</h2>
          <p className="truncate text-sm opacity-65">{book.author}</p>
        </a>
        <div className="mt-2">
          {book.formats.length ? <FormatBadges formats={book.formats} /> : <FindBookButton />}
        </div>
      </article>
    ))}
  </div>
);

const ReadingQueue = ({ books }: { books: LibraryBook[] }) => (
  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <section className="space-y-2">
      <p className="text-xs font-semibold tracking-widest uppercase opacity-55">Your collection</p>
      {books.map((book, index) => (
        <article
          key={book.id}
          className="flex items-center gap-4 border-b py-3"
          style={{ borderColor: 'var(--border-muted)' }}
        >
          <span className="w-5 text-xs opacity-45">{String(index + 1).padStart(2, '0')}</span>
          <BookCover book={book} compact />
          <a href={`/library/${book.id}`} className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{book.title}</h2>
            <p className="truncate text-sm opacity-65">{book.author}</p>
          </a>
          <div className="hidden sm:block">
            {book.formats.length ? <FormatBadges formats={book.formats} /> : <FindBookButton />}
          </div>
        </article>
      ))}
    </section>
    <aside className="rounded-xl bg-violet-950 p-6 text-violet-50">
      <p className="text-xs font-bold tracking-widest text-violet-300 uppercase">Next to find</p>
      <p className="mt-6 text-4xl font-semibold">
        {books.filter((book) => !book.formats.length).length}
      </p>
      <p className="mt-1 text-sm text-violet-200">Books are waiting for their first release.</p>
    </aside>
  </div>
);

const LibraryIndex = ({ books }: { books: LibraryBook[] }) => (
  <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-muted)' }}>
    <div
      className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-3 text-xs font-semibold tracking-widest uppercase opacity-55"
      style={{ borderColor: 'var(--border-muted)' }}
    >
      <span>Book</span>
      <span>Title / author</span>
      <span>Files</span>
    </div>
    {books.map((book) => (
      <article
        key={book.id}
        className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-3 last:border-0"
        style={{ borderColor: 'var(--border-muted)' }}
      >
        <BookCover book={book} compact />
        <a href={`/library/${book.id}`} className="min-w-0">
          <h2 className="truncate font-semibold">{book.title}</h2>
          <p className="truncate text-sm opacity-65">{book.author}</p>
        </a>
        <div className="text-right">
          {book.formats.length ? <FormatBadges formats={book.formats} /> : <FindBookButton />}
        </div>
      </article>
    ))}
  </div>
);

export const LibraryPrototypePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const variant = VARIANTS.some(([key]) => key === searchParams.get('variant'))
    ? (searchParams.get('variant') as (typeof VARIANTS)[number][0])
    : 'A';
  const query = searchParams.get('q') ?? '';
  const fileState = searchParams.get('files') ?? 'all';
  const visibleBooks = BOOKS.filter((book) => {
    const queryMatches = `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase());
    const filesMatch =
      fileState === 'all' ||
      (fileState === 'with' ? book.formats.length > 0 : !book.formats.length);
    return queryMatches && filesMatch;
  });
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    value ? next.set(key, value) : next.delete(key);
    setSearchParams(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const index = VARIANTS.findIndex(([key]) => key === variant);
      const nextIndex =
        (index + (event.key === 'ArrowRight' ? 1 : VARIANTS.length - 1)) % VARIANTS.length;
      setParam('variant', VARIANTS[nextIndex][0]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <section className="pb-24">
      {/* PROTOTYPE: three bookshelf directions, switchable with ?variant=. */}
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold tracking-widest text-violet-600 uppercase dark:text-violet-300">
            Library
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Your books</h1>
          <p className="mt-2 text-sm opacity-65">
            {BOOKS.length} saved works, {BOOKS.filter((book) => !book.formats.length).length}{' '}
            waiting to be found.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Search library"
            value={query}
            onChange={(event) => setParam('q', event.target.value)}
            placeholder="Search title or author"
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border-muted)' }}
          />
          <select
            aria-label="Filter files"
            value={fileState}
            onChange={(event) => setParam('files', event.target.value)}
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border-muted)' }}
          >
            <option value="all">All books</option>
            <option value="with">Has files</option>
            <option value="without">Needs files</option>
          </select>
        </div>
      </div>
      {variant === 'A' && <CoverShelf books={visibleBooks} />}
      {variant === 'B' && <ReadingQueue books={visibleBooks} />}
      {variant === 'C' && <LibraryIndex books={visibleBooks} />}
      <nav
        className="fixed right-4 bottom-4 left-4 z-50 mx-auto flex w-fit items-center gap-3 rounded-full bg-slate-950 px-3 py-2 text-sm text-white shadow-xl"
        aria-label="Prototype variants"
      >
        <button
          type="button"
          aria-label="Previous variant"
          onClick={() =>
            setParam(
              'variant',
              VARIANTS[
                (VARIANTS.findIndex(([key]) => key === variant) + VARIANTS.length - 1) %
                  VARIANTS.length
              ][0],
            )
          }
        >
          ←
        </button>
        <span className="min-w-36 text-center">
          {variant} - {VARIANTS.find(([key]) => key === variant)?.[1]}
        </span>
        <button
          type="button"
          aria-label="Next variant"
          onClick={() =>
            setParam(
              'variant',
              VARIANTS[(VARIANTS.findIndex(([key]) => key === variant) + 1) % VARIANTS.length][0],
            )
          }
        >
          →
        </button>
      </nav>
    </section>
  );
};
