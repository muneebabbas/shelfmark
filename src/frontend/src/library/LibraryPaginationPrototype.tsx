import { useEffectEvent } from 'react';

import { useDependencyEffect } from '../hooks/useMountEffect';

// PROTOTYPE: three library pagination controls, switchable with ?variant=.
type Variant = 'segmented' | 'compact' | 'steps';

interface PaginationProps {
  currentPage: number;
  pageCount: number;
  pages: Array<number | 'ellipsis'>;
  setPage: (page: number) => void;
}

const baseButton =
  'inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg px-3 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:pointer-events-none disabled:opacity-35';

const PageButtons = ({ currentPage, pages, setPage }: Omit<PaginationProps, 'pageCount'>) => (
  <>
    {pages.map((item, index) =>
      item === 'ellipsis' ? (
        <span key={`ellipsis-${pages[index + 1]}`} className="px-1 text-sm opacity-50">
          ...
        </span>
      ) : (
        <button
          key={item}
          type="button"
          aria-current={item === currentPage ? 'page' : undefined}
          className={`${baseButton} ${
            item === currentPage
              ? 'bg-violet-600 text-white shadow-sm'
              : 'text-(--text) hover:bg-violet-100 hover:text-violet-950 dark:hover:bg-violet-950'
          }`}
          onClick={() => setPage(item)}
        >
          {item}
        </button>
      ),
    )}
  </>
);

export const SegmentedPaginationVariant = (props: PaginationProps) => (
  <nav
    className="mt-10 flex flex-wrap items-center justify-center gap-1 rounded-xl border border-(--border-muted) bg-(--surface) p-1.5 shadow-sm"
    aria-label="Library pages"
  >
    <button
      type="button"
      disabled={props.currentPage === 1}
      className={`${baseButton} text-(--text) hover:bg-violet-100 hover:text-violet-950 dark:hover:bg-violet-950`}
      onClick={() => props.setPage(props.currentPage - 1)}
    >
      Previous
    </button>
    <PageButtons {...props} />
    <button
      type="button"
      disabled={props.currentPage === props.pageCount}
      className={`${baseButton} text-(--text) hover:bg-violet-100 hover:text-violet-950 dark:hover:bg-violet-950`}
      onClick={() => props.setPage(props.currentPage + 1)}
    >
      Next
    </button>
  </nav>
);

export const CompactPaginationVariant = (props: PaginationProps) => (
  <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Library pages">
    <button
      type="button"
      aria-label="Previous page"
      disabled={props.currentPage === 1}
      className={`${baseButton} border border-(--border-muted) bg-(--surface) text-lg shadow-sm hover:border-violet-400 hover:bg-violet-100 dark:hover:bg-violet-950`}
      onClick={() => props.setPage(props.currentPage - 1)}
    >
      &#8249;
    </button>
    <div className="flex items-center gap-1 rounded-xl bg-(--hover-surface) p-1.5 shadow-inner">
      <PageButtons {...props} />
    </div>
    <button
      type="button"
      aria-label="Next page"
      disabled={props.currentPage === props.pageCount}
      className={`${baseButton} border border-(--border-muted) bg-(--surface) text-lg shadow-sm hover:border-violet-400 hover:bg-violet-100 dark:hover:bg-violet-950`}
      onClick={() => props.setPage(props.currentPage + 1)}
    >
      &#8250;
    </button>
  </nav>
);

export const StepsPaginationVariant = (props: PaginationProps) => (
  <nav
    className="mt-10 flex flex-wrap items-center justify-center gap-2"
    aria-label="Library pages"
  >
    <button
      type="button"
      disabled={props.currentPage === 1}
      className={`${baseButton} border border-(--border-muted) bg-(--surface) text-(--text) shadow-sm hover:-translate-y-0.5 hover:border-violet-400 hover:shadow-md`}
      onClick={() => props.setPage(props.currentPage - 1)}
    >
      Previous
    </button>
    <div className="flex items-center gap-1 px-1">
      <PageButtons {...props} />
    </div>
    <button
      type="button"
      disabled={props.currentPage === props.pageCount}
      className={`${baseButton} border border-violet-600 bg-violet-600 text-white shadow-sm hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md`}
      onClick={() => props.setPage(props.currentPage + 1)}
    >
      Next
    </button>
  </nav>
);

const variants: Array<{ key: Variant; label: string }> = [
  { key: 'segmented', label: 'Segmented control' },
  { key: 'compact', label: 'Compact arrows' },
  { key: 'steps', label: 'Stepped actions' },
];

export const getPaginationPrototypeVariant = (value: string | null): Variant =>
  value === 'segmented' || value === 'compact' || value === 'steps' ? value : 'segmented';

export const PaginationPrototype = (props: PaginationProps & { variant: Variant }) => {
  if (props.variant === 'compact') return <CompactPaginationVariant {...props} />;
  if (props.variant === 'steps') return <StepsPaginationVariant {...props} />;
  return <SegmentedPaginationVariant {...props} />;
};

export const PaginationPrototypeSwitcher = ({
  variant,
  setVariant,
}: {
  variant: Variant;
  setVariant: (variant: Variant) => void;
}) => {
  const currentIndex = variants.findIndex((item) => item.key === variant);
  const cycle = useEffectEvent((direction: -1 | 1) => {
    setVariant(variants[(currentIndex + direction + variants.length) % variants.length].key);
  });

  useDependencyEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') cycle(-1);
      if (event.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="fixed right-1/2 bottom-5 z-50 flex translate-x-1/2 items-center gap-2 rounded-full bg-slate-950 px-2 py-2 text-xs text-white shadow-xl ring-1 ring-white/20">
      <button
        type="button"
        aria-label="Previous pagination variant"
        className="rounded-full px-2 py-1 hover:bg-white/15"
        onClick={() => cycle(-1)}
      >
        &#8592;
      </button>
      <span className="min-w-32 text-center font-semibold">{variants[currentIndex].label}</span>
      <button
        type="button"
        aria-label="Next pagination variant"
        className="rounded-full px-2 py-1 hover:bg-white/15"
        onClick={() => cycle(1)}
      >
        &#8594;
      </button>
    </div>
  );
};
