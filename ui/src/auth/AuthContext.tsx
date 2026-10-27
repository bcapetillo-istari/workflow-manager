import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthProvider } from './types';
import { DevTokenAuth } from './DevTokenAuth';

export interface AuthState {
  provider: AuthProvider;
  token: string | null;
  signedIn: boolean;
  /** Present only for the development token provider. */
  signIn: ((token: string) => void) | null;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthContextProvider({ provider, children }: { provider: AuthProvider; children: ReactNode }) {
  const subscribe = useCallback((listener: () => void) => provider.subscribe(listener), [provider]);
  const getSnapshot = useCallback(() => provider.getToken(), [provider]);
  const token = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const value = useMemo<AuthState>(
    () => ({
      provider,
      token,
      signedIn: token !== null,
      signIn: provider instanceof DevTokenAuth ? (t: string) => provider.signIn(t) : null,
      signOut: () => provider.signOut(),
    }),
    [provider, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthContextProvider>');
  return ctx;
}
