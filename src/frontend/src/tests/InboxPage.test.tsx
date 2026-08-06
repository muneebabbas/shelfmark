// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InboxPage } from '../library/InboxPage';

const inboxResponse = {
  items: [
    {
      activity_id: 22,
      book_id: 5,
      book_title: 'Dune',
      book_author: 'Frank Herbert',
      source: 'prowlarr',
      source_key: 'prowlarr:source',
      state: 'needs review',
      updated_at: '2026-01-01T00:00:00+00:00',
      evidence: [
        {
          relative_path: 'Dune.epub',
          format: 'epub',
          available: true,
          decision_reason: 'no match: title does not match',
          auto_select: false,
        },
      ],
    },
  ],
};

describe('InboxPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists needs-review items and links each into the book review flow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(inboxResponse)))),
    );

    render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Inbox' })).not.toBeNull();
    expect(await screen.findByText('Dune')).not.toBeNull();
    expect(screen.getByText('by Frank Herbert')).not.toBeNull();
    const link = screen.getByRole('link', { name: /Dune/ });
    expect(link.getAttribute('href')).toBe('/library/5?review=22');
  });

  it('shows an empty state when nothing needs review', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [] })))),
    );

    render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Nothing needs review right now.')).not.toBeNull();
  });

  it('highlights the item for the book selected via the :bookId route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(inboxResponse)))),
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { container } = render(
      <MemoryRouter initialEntries={['/inbox/5']}>
        <Routes>
          <Route path="/inbox/:bookId" element={<InboxPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Dune');
    const selected = container.querySelector<HTMLElement>('[data-book-id="5"]');
    expect(selected).not.toBeNull();
    expect(selected?.className).toContain('ring-2');
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
