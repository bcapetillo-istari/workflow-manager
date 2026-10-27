import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { DevTokenAuth, DEV_TOKEN_STORAGE_KEY } from './DevTokenAuth';
import { AuthGate } from '../layout/AuthGate';
import { renderWithProviders } from '../test/renderWithProviders';

describe('SignIn flow', () => {
  it('shows the dev banner, sets the token on submit and persists it when asked', () => {
    sessionStorage.clear();
    const auth = new DevTokenAuth({ persist: true });
    renderWithProviders(
      <AuthGate>
        <p>app content</p>
      </AuthGate>,
      { auth },
    );
    expect(screen.getByText(/Development authentication/)).toBeInTheDocument();
    expect(screen.queryByText('app content')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Use token' });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/bearer token/i), { target: { value: 'Bearer abc.def ' } });
    fireEvent.click(button);

    expect(auth.getToken()).toBe('abc.def');
    expect(sessionStorage.getItem(DEV_TOKEN_STORAGE_KEY)).toBe('abc.def');
    expect(screen.getByText('app content')).toBeInTheDocument();

    act(() => auth.signOut());
    expect(sessionStorage.getItem(DEV_TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/Development authentication/)).toBeInTheDocument();
  });

  it('does not touch sessionStorage when persistence is off', () => {
    sessionStorage.clear();
    const auth = new DevTokenAuth();
    auth.signIn('tok');
    expect(auth.getToken()).toBe('tok');
    expect(sessionStorage.getItem(DEV_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
