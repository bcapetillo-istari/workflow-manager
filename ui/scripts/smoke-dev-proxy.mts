// Verifies the dev object-store forwarder end to end: upload (PUT) + download (GET) via http://localhost:5173.
import { readFileSync } from 'node:fs';
import { RestGateway } from '../src/gateway/rest/index.ts';
import { devObjectStoreRewrite } from '../src/gateway/rest/devObjectStoreProxy.ts';

const env = readFileSync('/Users/benjamincapetillo/Projects/rfi-manager-ui/.env', 'utf8');
const token = env.match(/^ISTARI_TOKEN=(.*)$/m)?.[1]?.trim() ?? '';
const config = JSON.parse(readFileSync('public/config.json', 'utf8')) as { registryUrl: string; istariWebUrl: string; workflowManagerRunsSystemId: string };
const gw = new RestGateway({
  registryUrl: config.registryUrl, istariWebUrl: config.istariWebUrl, getToken: () => token,
  rewriteObjectStoreUrl: devObjectStoreRewrite('http://localhost:5173/apps/workflows/'),
});
const name = `_gateway-test-proxy-${Date.now()}.json`;
const created = await gw.createJsonResource({ systemId: config.workflowManagerRunsSystemId, name, data: { via: 'dev-proxy', n: 1 } });
console.log('uploaded via proxy:', created.resourceId);
const rev = await gw.createJsonRevision(created.resourceId, { via: 'dev-proxy', n: 2 });
const back = await gw.readJson<{ n: number }>(created.resourceId);
console.log('revision', rev.revisionId === back.revisionId, 'content n =', back.data.n, '(expect 2)');
