import { useState, type CSSProperties } from 'react';

import type { Book } from '../types';

type ButtonSize = 'sm' | 'md';
type ButtonVariant = 'default' | 'icon';

interface BookGetButtonProps {
  book: Book;
  onAddToLibrary: (book: Book) => Promise<void>;
  size?: ButtonSize;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
  style?: CSSProperties;
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
};

const iconSizeClasses: Record<ButtonSize, string> = {
  sm: 'p-1.5',
  md: 'p-1.5 sm:p-2',
};

const iconSizes: Record<ButtonSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
};

const iconOnlySizes: Record<ButtonSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-4 h-4 sm:w-5 sm:h-5',
};

export const BookGetButton = ({
  book,
  onAddToLibrary,
  size = 'md',
  variant = 'default',
  fullWidth = false,
  className = '',
  style,
}: BookGetButtonProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const isIconVariant = variant === 'icon';
  const widthClasses = fullWidth ? 'w-full' : '';
  const sizeClass = isIconVariant ? iconSizeClasses[size] : sizeClasses[size];
  const iconSize = isIconVariant ? iconOnlySizes[size] : iconSizes[size];

  const isInLibrary = book.in_my_library === true;
  const isDisabled = isAdding;
  const buttonClasses = isAdding
    ? 'bg-emerald-600/70 cursor-wait'
    : 'bg-emerald-600 hover:bg-emerald-700';

  const handleClick = async () => {
    if (isDisabled) return;
    setIsAdding(true);
    try {
      await onAddToLibrary(book);
    } catch {
      // The callback reports the error; restore the action so it can be retried.
    } finally {
      setIsAdding(false);
    }
  };

  let displayText = 'Add +';
  if (isAdding) {
    displayText = 'Adding...';
  } else if (isInLibrary) {
    displayText = 'In Library';
  }

  // Render appropriate icon based on state
  const renderIcon = () => {
    if (isAdding) {
      return (
        <div
          className={`${iconSize} animate-spin rounded-full border-2 border-current border-t-transparent`}
        />
      );
    }

    if (isInLibrary) {
      return (
        <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }

    return (
      <svg
        className={iconSize}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    );
  };

  // Icon variant renders as a circular button without text
  if (isIconVariant) {
    return (
      <button
        type="button"
        className={`flex items-center justify-center rounded-full text-white transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-hidden ${sizeClass} ${buttonClasses} ${className}`.trim()}
        onClick={() => void handleClick()}
        disabled={isDisabled}
        style={style}
        aria-label={`${displayText} ${book.title}`}
      >
        {renderIcon()}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-sm text-white transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-hidden ${sizeClass} ${widthClasses} ${buttonClasses} ${className}`.trim()}
      onClick={() => void handleClick()}
      disabled={isDisabled}
      style={style}
      aria-label={`${displayText} ${book.title}`}
    >
      {renderIcon()}
      <span>{displayText}</span>
    </button>
  );
};
