/** Runtime configuration, loaded from /config.json at startup (mounted from a ConfigMap in deployment). */
export interface AppConfig {
  registryUrl: string;
  istariWebUrl: string;
  workflowManagerSystemId: string;
  workflowManagerRunsSystemId: string;
  /** When true the development credential box is shown. Must be false in production builds. */
  devAuth: boolean;
  /** OIDC issuer (Zitadel) and client id for PKCE sign-in (Phase 6). Unset means OIDC is not configured. */
  oidcAuthority?: string;
  oidcClientId?: string;
}

let cached: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`config.json failed to load: HTTP ${res.status}`);
  const cfg = (await res.json()) as AppConfig;
  for (const k of [
    'registryUrl',
    'istariWebUrl',
    'workflowManagerSystemId',
    'workflowManagerRunsSystemId',
  ] as const) {
    if (!cfg[k]) throw new Error(`config.json missing ${k}`);
  }
  cached = cfg;
  return cfg;
}
