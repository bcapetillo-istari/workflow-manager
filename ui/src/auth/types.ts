/** AuthProvider: supplies the bearer token used for every Istari call. DevTokenAuth now, PkceAuth later. */
export interface AuthProvider {
  /** Current access token or null when signed out. */
  getToken(): string | null;
  /** Subscribe to sign-in / sign-out changes. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
  signOut(): void;
  readonly kind: 'dev-token' | 'pkce';
}
