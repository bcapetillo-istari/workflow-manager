/**
 * Matching of a manifest `filter.secret_type` against a stored credential's auth type.
 *
 * Istari credentials carry an `auth_type` such as "token", "basic", or "oauth2". Manifests may name either that
 * auth type directly or an Istari validation type such as "@token:llm" (the module-manifest spelling). With no
 * filter, every linked credential is listed; the user chooses, and the job's auth binding sends only its id.
 */
export function normalizeSecretType(wanted: string | undefined): string | undefined {
  if (!wanted) return undefined;
  const w = wanted.trim().toLowerCase().replace(/^@/, '');
  const head = w.split(':')[0] ?? w;
  if (head === 'token' || head === 'api_key' || head === 'apikey') return 'token';
  if (head === 'basic' || head === 'password') return 'basic';
  if (head.startsWith('oauth')) return 'oauth';
  return head;
}

export function matchesSecretType(authType: string | undefined, wanted: string | undefined): boolean {
  const want = normalizeSecretType(wanted);
  if (!want) return true;
  const have = normalizeSecretType(authType) ?? '';
  return have === want || have.startsWith(want);
}
