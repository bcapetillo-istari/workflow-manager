/**
 * Development-only object-store proxy support.
 *
 * Presigned object-store URLs (S3, MinIO, Azure) are cross-origin, and the bucket's CORS allowlist
 * covers the Istari web origin, not http://localhost. In `npm run dev`, presigned URLs are rewritten to
 * `<base>__objstore/<host>/<path>?<query>` and vite.config.ts proxies that prefix to `https://<host>`,
 * so the browser sees a same-origin request. The SigV4 signature covers only the `host` header and the
 * path/query, both preserved by the proxy. Never enabled in production builds.
 */
export const OBJECT_STORE_PROXY_SEGMENT = '__objstore';

export function devObjectStoreRewrite(baseUrl: string): (url: string) => string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return (url: string): string => {
    const u = new URL(url);
    return `${base}${OBJECT_STORE_PROXY_SEGMENT}/${u.host}${u.pathname}${u.search}`;
  };
}
