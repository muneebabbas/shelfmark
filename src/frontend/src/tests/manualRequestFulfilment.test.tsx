// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityCard } from '../components/activity/ActivityCard';
import { ActivitySidebar } from '../components/activity/ActivitySidebar';
import type { ActivityItem } from '../components/activity/activityTypes';
import { RequestBookGroups } from '../components/activity/RequestBookGroups';
import type { RequestRecord } from '../types';

const requestRecord: RequestRecord = {
  id: 1,
  user_id: 1,
  username: 'Reader',
  book_id: 1,
  status: 'pending',
  source_hint: null,
  content_type: 'ebook',
  request_level: 'book',
  book_data: { title: 'Requested Book', author: 'Reader' },
  release_data: null,
  note: null,
  admin_note: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-02-13T10:00:00Z',
  updated_at: '2026-02-13T10:00:00Z',
};

const requestItem: ActivityItem = {
  id: 'request-1',
  kind: 'request',
  visualStatus: 'pending',
  title: 'Requested Book',
  author: 'Reader',
  metaLine: 'Book request',
  statusLabel: 'Pending',
  timestamp: 1,
  requestId: requestRecord.id,
  requestLevel: 'book',
  requestRecord,
};

describe('manual request fulfilment controls', () => {
  afterEach(cleanup);

  it('does not render Mark available in a Book request group', () => {
    render(<RequestBookGroups items={[requestItem]} onFindRelease={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Find a release' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark available' })).toBeNull();
  });

  it('opens the release picker from the book-level action', async () => {
    const onFindRelease = vi.fn();
    const user = userEvent.setup();
    render(
      <RequestBookGroups items={[requestItem]} onFindRelease={onFindRelease} onReject={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Find a release' }));

    expect(onFindRelease).toHaveBeenCalledWith(requestRecord.id, requestRecord);
  });

  it('shows the requester that an optional decline note is visible to them', async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(<RequestBookGroups items={[requestItem]} onFindRelease={vi.fn()} onReject={onReject} />);

    await user.click(screen.getByRole('button', { name: 'Decline request from Reader' }));
    expect(screen.getByText('The optional note is shown to Reader.')).not.toBeNull();
    await user.type(
      screen.getByPlaceholderText('Optional note for the requester'),
      'Not available',
    );
    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    expect(onReject).toHaveBeenCalledWith(requestRecord.id, 'Not available');
  });

  it('does not carry a decline note to another requester', async () => {
    const user = userEvent.setup();
    const anotherRequest: ActivityItem = {
      ...requestItem,
      id: 'request-2',
      requestId: 2,
      requestRecord: { ...requestRecord, id: 2, user_id: 2, username: 'Another Reader' },
    };
    render(
      <RequestBookGroups
        items={[requestItem, anotherRequest]}
        onFindRelease={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Decline request from Reader' }));
    await user.type(screen.getByPlaceholderText('Optional note for the requester'), 'First note');
    await user.click(screen.getByRole('button', { name: 'Decline request from Another Reader' }));

    const noteField = screen.getByPlaceholderText('Optional note for the requester');
    if (!(noteField instanceof HTMLTextAreaElement)) throw new Error('Expected a note textarea');
    expect(noteField.value).toBe('');
  });

  it('keeps the decline form open when the rejection fails', async () => {
    const onReject = vi.fn().mockRejectedValue(new Error('Request failed'));
    const user = userEvent.setup();
    render(<RequestBookGroups items={[requestItem]} onFindRelease={vi.fn()} onReject={onReject} />);

    await user.click(screen.getByRole('button', { name: 'Decline request from Reader' }));
    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    expect(screen.getByText('Decline this requester?')).not.toBeNull();
  });

  it('opens the rejection confirmation when an administrator rejects a single request', async () => {
    const user = userEvent.setup();
    const onRequestReject = vi.fn();
    render(
      <ActivitySidebar
        isOpen
        onClose={vi.fn()}
        status={{}}
        isAdmin
        libraryCapability="download-capable"
        onClearCompleted={vi.fn()}
        onCancel={vi.fn()}
        requestItems={[requestItem]}
        pendingRequestCount={1}
        showRequestsTab
        onRequestReject={onRequestReject}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Decline request from Reader' }));

    expect(await screen.findByText('The optional note is shown to Reader.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(onRequestReject).toHaveBeenCalledWith(requestRecord.id, undefined);
  });

  it('does not render manual approval without an attached release', () => {
    render(
      <ActivityCard item={requestItem} isAdmin isRequestDetailsOpen onRequestApprove={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Browse Releases To Approve' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Manually Mark as Approved' })).toBeNull();
  });
});
