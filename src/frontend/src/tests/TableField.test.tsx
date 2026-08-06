// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { TableField } from '../components/settings/fields/TableField';
import type { TableFieldConfig } from '../types/settings';

const notificationTargetsField: TableFieldConfig = {
  type: 'TableField',
  key: 'ADMIN_NOTIFICATION_TARGETS',
  label: '',
  value: [],
  columns: [
    { key: 'destination', label: 'Destination', type: 'text' },
    {
      key: 'events',
      label: 'Events',
      type: 'multiselect',
      options: [
        { value: 'download-completed', label: 'Download completed' },
        { value: 'import-failed', label: 'Import failed' },
      ],
    },
  ],
};

const NotificationTargetsTable = () => {
  const [value, setValue] = useState<Record<string, unknown>[]>([{ destination: '', events: [] }]);

  return <TableField field={notificationTargetsField} value={value} onChange={setValue} />;
};

describe('notification targets table', () => {
  afterEach(cleanup);

  it('preserves text input focus while updating a target', async () => {
    const user = userEvent.setup();
    render(<NotificationTargetsTable />);

    const destination = screen.getByRole('textbox', { name: 'Destination row 1' });
    await user.click(destination);
    await user.type(destination, 'admin@example.com');

    expect(document.activeElement).toBe(destination);
    expect(destination).toHaveProperty('value', 'admin@example.com');
  });

  it('keeps the event selector open while selecting events', async () => {
    const user = userEvent.setup();
    render(<NotificationTargetsTable />);

    await user.click(screen.getByRole('button', { name: 'Select...' }));
    await user.click(screen.getByRole('button', { name: /Download completed/ }));

    expect(screen.getByRole('listbox')).not.toBeNull();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Download completed' }).checked,
    ).toBe(true);
  });
});
