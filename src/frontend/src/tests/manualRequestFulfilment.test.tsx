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

    expect(screen.getByRole('button', { name: 'Find release' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark available' })).toBeNull();
  });

  it('lets an administrator reject a single request without selecting it first', async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(<RequestBookGroups items={[requestItem]} onFindRelease={vi.fn()} onReject={onReject} />);

    await user.click(screen.getByRole('button', { name: 'Reject request' }));

    expect(onReject).toHaveBeenCalledWith(requestRecord.id);
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

    await user.click(await screen.findByRole('button', { name: 'Reject request' }));

    expect(await screen.findByText('Reject request for')).not.toBeNull();
    const confirmButton = screen
      .getAllByRole('button', { name: 'Reject' })
      .find((button) => button.textContent === 'Reject');
    if (!confirmButton) throw new Error('Reject confirmation button not found');
    await user.click(confirmButton);
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
