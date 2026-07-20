// Stub for `/library` — the bookshelf grid is ticket #10's prototype. This
// placeholder lets the nested route exist and lets a reviewer navigate into
// #08's book detail page against the live API. #10 replaces this file wholesale.

export const LibraryPage = () => {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-4 text-xl font-semibold text-(--text)">Your library</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Prototype — bookshelf grid lands in #10. Run the seed script (
        <code className="rounded bg-(--bg-soft) px-1 py-0.5">
          uv run scripts/seed_library_prototype.py
        </code>
        ) to populate books, then visit a book detail page directly, e.g.{' '}
        <a href="/library/1" className="text-emerald-700 underline dark:text-emerald-400">
          /library/1
        </a>
        .
      </p>
    </div>
  );
};
