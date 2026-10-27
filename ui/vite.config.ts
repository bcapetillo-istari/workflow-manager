/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const BASE = '/apps/workflows/';
const OBJSTORE_PREFIX = `${BASE}__objstore/`;

/**
 * Dev-only forwarder for presigned object-store URLs. The gateway (in dev builds only) rewrites
 * `https://<host>/<path>?<query>` to `${BASE}__objstore/<host>/<path>?<query>`; this middleware performs the
 * real request server-side and streams the response back, so the browser sees a same-origin request and the
 * bucket's CORS allowlist (which covers the Istari web origin, not localhost) is not involved. The SigV4
 * signature covers host, path and query only, all preserved here. See src/gateway/rest/devObjectStoreProxy.ts.
 */
function devObjectStoreForwarder(): Plugin {
  return {
    name: 'workflow-manager-dev-objstore-forwarder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith(OBJSTORE_PREFIX)) return next();
        const rest = url.slice(OBJSTORE_PREFIX.length);
        const slash = rest.indexOf('/');
        if (slash <= 0) {
          res.statusCode = 400;
          res.end('objstore proxy: missing host');
          return;
        }
        const target = `https://${rest.slice(0, slash)}${rest.slice(slash)}`;
        const method = req.method ?? 'GET';
        const headers: Record<string, string> = {};
        const ct = req.headers['content-type'];
        if (typeof ct === 'string') headers['content-type'] = ct;
        const cl = req.headers['content-length'];
        if (typeof cl === 'string') headers['content-length'] = cl;
        try {
          const hasBody = method !== 'GET' && method !== 'HEAD';
          const body = hasBody ? await readAll(req) : undefined;
          const upstream = await fetch(target, { method, headers, body });
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, name) => {
            if (!['content-encoding', 'transfer-encoding', 'connection'].includes(name)) res.setHeader(name, value);
          });
          const bytes = new Uint8Array(await upstream.arrayBuffer());
          res.setHeader('content-length', String(bytes.byteLength));
          res.end(bytes);
        } catch (err) {
          res.statusCode = 502;
          res.end(`objstore proxy error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    },
  };
}

function readAll(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    stream.on('error', reject);
  });
}

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss(), devObjectStoreForwarder()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
