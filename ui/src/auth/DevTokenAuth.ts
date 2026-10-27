import type { AuthProvider } from './types';

/** sessionStorage key used ONLY when devAuth is enabled, so a page reload keeps the pasted token. */
export const DEV_TOKEN_STORAGE_KEY = 'workflow-manager.dev-auth.bearer-token';

export interface DevTokenAuthOptions {
  /** Persist the token to sessionStorage (development only). */
  persist?: boolean;
  storage?: Storage | null;
}

/**
 * Development AuthProvider: the user pastes an Istari bearer token into a credential box.
 * Not for production. The PKCE provider will replace it behind the same interface.
 */
export class DevTokenAuth implements AuthProvider {
  readonly kind = 'dev-token' as const;
  private token: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly storage: Storage | null;

  constructor(opts: DevTokenAuthOptions = {}) {
    this.storage = opts.persist ? (opts.storage ?? defaultStorage()) : null;
    this.token = this.storage?.getItem(DEV_TOKEN_STORAGE_KEY) ?? null;
  }

  getToken(): string | null {
    return this.token;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  signIn(token: string): void {
    const trimmed = token.trim().replace(/^Bearer\s+/i, '');
    if (!trimmed) return;
    this.token = trimmed;
    this.storage?.setItem(DEV_TOKEN_STORAGE_KEY, trimmed);
    this.emit();
  }

  signOut(): void {
    this.token = null;
    this.storage?.removeItem(DEV_TOKEN_STORAGE_KEY);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
