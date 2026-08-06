// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { INITIAL_CREATE_FORM } from '../components/settings/users/types';
import { UserCreateCard } from '../components/settings/users/UserCard';

describe('local user creation capability', () => {
  it('defaults new local users to request only', () => {
    expect(INITIAL_CREATE_FORM.library_capability).toBe('request-only');
  });

  it('lets an administrator select download capable for a new local user', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <UserCreateCard
        form={INITIAL_CREATE_FORM}
        onChange={onChange}
        creating={false}
        isFirstUser={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Request only' }));
    await user.click(screen.getByRole('button', { name: 'Download capable' }));

    expect(onChange).toHaveBeenCalledWith({
      ...INITIAL_CREATE_FORM,
      library_capability: 'download-capable',
    });
  });
});
