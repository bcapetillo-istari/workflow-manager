#!/usr/bin/env node
/**
 * Live probe for src/gateway/rest/RestGateway.ts against https://api.demo.istari.app.
 *
 * Run (from ui/):   npx tsx scripts/probe-gateway.mjs
 *   tsx transpiles the .ts imports on the fly; no build step. Alternative without tsx:
 *   npx tsc -p tsconfig.app.json --noEmit false --outDir scripts/.build --module esnext \
 *     --moduleResolution bundler --allowImportingTsExtensions false && node scripts/.build/...
 *
 * Token: ISTARI_TOKEN env var, else ISTARI_TOKEN= line in ../rfi-manager-ui/.env. Never printed.
 * Writes happen ONLY in system `workflow-manager-runs` (names prefixed `_gateway-test-`).
 * Set PROBE_CREATE_JOB=1 (plus PROBE_FUNCTION / PROBE_TOOL / PROBE_TOOL_VERSION / PROBE_OS) to also
 * create a job against the resource this probe creates. 2026-10-23: the only json-input function the
 * user can see is denied with 403 and the user's own module only accepts .mdzip (404 "Function Not
 * Found ... for model with extension: json"), so createJob is request-shape-verified but not run.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RestGateway } from '../src/gateway/rest/index.ts';

const REGISTRY_URL = 'https://api.demo.istari.app';
const WEB_URL = 'https://demo.istari.app';
const RUNS_SYSTEM_ID = '487849ba-7716-4c9b-a99e-92749de25b82';
const RUNS_BASELINE_BRANCH_ID = 'b68fd213-1072-4ee6-bcd3-a31ca58ea9be';
const MODEL_WITH_ARTIFACTS = '49fbc78a-e08f-4879-8e70-cb7ec9383621';

function loadToken() {
  if (process.env.ISTARI_TOKEN) return process.env.ISTARI_TOKEN;
  const envPath = resolve(import.meta.dirname, '../../../rfi-manager-ui/.env');
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('ISTARI_TOKEN='));
  if (!line) throw new Error('ISTARI_TOKEN not found');
  return line
    .slice('ISTARI_TOKEN='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
}

const token = loadToken();
const gw = new RestGateway({ registryUrl: REGISTRY_URL, istariWebUrl: WEB_URL, getToken: () => token });

let failures = 0;
async function step(label, fn) {
  try {
    const out = await fn();
    console.log(`PASS ${label}${out === undefined ? '' : ` -> ${out}`}`);
    return out;
  } catch (err) {
    failures++;
    const detail =
      err && typeof err === 'object' && 'status' in err
        ? ` [HTTP ${err.status}] ${JSON.stringify(err.body)}`
        : '';
    console.log(`FAIL ${label}: ${err?.message ?? err}${detail}`);
    return undefined;
  }
}
const short = (id) => (typeof id === 'string' ? id.slice(0, 8) : String(id));

const me = await step('currentUser', async () => {
  const u = await gw.currentUser();
  return `${short(u.id)} displayName=${u.displayName} email=${u.email ? u.email.slice(0, 3) + '...' : '-'}`;
});

await step('listSystems', async () => {
  const s = await gw.listSystems({ name: 'workflow-manager', size: 10 });
  return s.map((x) => x.name).join(', ');
});
await step('getSystem', async () => (await gw.getSystem(RUNS_SYSTEM_ID)).name);
await step('listBranches', async () => {
  const b = await gw.listBranches(RUNS_SYSTEM_ID);
  return b.map((x) => `${x.tag}${x.isBaseline ? '(baseline)' : ''}:${short(x.branchId)}`).join(', ');
});
const before = await step('listTrackedResources(before)', async () => {
  const t = await gw.listTrackedResources(RUNS_SYSTEM_ID);
  return `${t.length} tracked`;
});

await step('searchResources(name)', async () => {
  const r = await gw.searchResources({ name: 'requirements', extensions: ['json'], size: 5 });
  return `${r.length} hits; first=${r[0]?.name} type=${r[0]?.resourceType}`;
});
await step('searchResources(systemId)', async () => {
  const r = await gw.searchResources({ systemId: RUNS_SYSTEM_ID, extensions: ['json'] });
  return `${r.length} hits in runs system`;
});
await step('getResource', async () => {
  const r = await gw.getResource(MODEL_WITH_ARTIFACTS);
  return `${r.name} rev=${short(r.revisionId)} type=${r.resourceType}`;
});
await step('listRevisions', async () => {
  const r = await gw.listRevisions(MODEL_WITH_ARTIFACTS);
  return `${r.length} revisions; newest=${r[0]?.versionName}`;
});
await step('listArtifacts', async () => {
  const a = await gw.listArtifacts(MODEL_WITH_ARTIFACTS);
  return `${a.length} artifacts; e.g. ${a
    .slice(0, 3)
    .map((x) => x.name)
    .join(', ')}`;
});
await step('readText(existing artifact)', async () => {
  const a = await gw.listArtifacts(MODEL_WITH_ARTIFACTS);
  const json = a.find((x) => x.extension === 'json');
  const text = await gw.readText(json.resourceId);
  return `${json.name}: ${text.length} chars, starts ${JSON.stringify(text.slice(0, 30))}`;
});

await step('listAuthSecrets', async () => {
  const s = await gw.listAuthSecrets();
  return s.map((x) => `${x.name}[${x.functionAuthType}${x.provider ? ',' + x.provider : ''}]`).join(' ');
});
await step(
  'listAuthSecrets(token)',
  async () => `${(await gw.listAuthSecrets({ secretType: 'token' })).length} token secrets`,
);
const fns = await step('listFunctions(json)', async () => {
  const f = await gw.listFunctions({ inputExtension: 'json' });
  return `${f.length} functions; e.g. ${f
    .slice(0, 3)
    .map((x) => `${x.name}@${x.moduleName}`)
    .join(', ')}`;
});
await step('listFunctions(name)', async () => {
  const f = await gw.listFunctions({ name: '@istari:extract' });
  const t = f.find((x) => x.moduleName === '@istari:open_text');
  return `${f.length} modules publish @istari:extract; open_text versions=${t?.versions} os=${t?.operatingSystems?.length}`;
});
await step('listJobs', async () => {
  const j = await gw.listJobs({ size: 3 });
  return j.map((x) => `${x.functionName}:${x.status}`).join(', ');
});
await step('getJob', async () => {
  const [first] = await gw.listJobs({ size: 1 });
  const j = await gw.getJob(first.jobId);
  return `${short(j.jobId)} ${j.status} updated=${j.updated}`;
});

// ---- writes (runs system only) ----------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const name = `_gateway-test-${stamp}.json`;
const created = await step('createJsonResource', async () => {
  const r = await gw.createJsonResource({
    systemId: RUNS_SYSTEM_ID,
    branchId: RUNS_BASELINE_BRANCH_ID,
    name,
    data: { kind: 'gateway-test', n: 1, createdBy: me ? 'probe' : 'unknown' },
    description: 'RestGateway probe (safe to archive)',
  });
  return `resource=${short(r.resourceId)} rev=${short(r.revisionId)}`;
});
let tracked;
await step('listTrackedResources(after create)', async () => {
  const t = await gw.listTrackedResources(RUNS_SYSTEM_ID);
  tracked = t.find((x) => x.name === name);
  if (!tracked) throw new Error(`${name} not in tracked resources (${t.length} tracked)`);
  return `${t.length} tracked; ${name} path=${tracked.path} trackedFileId=${short(tracked.trackedFileId)}`;
});
if (tracked) {
  await step('readJson(v1)', async () => {
    const r = await gw.readJson(tracked.resourceId);
    return `n=${r.data.n} rev=${short(r.revisionId)} (matches create: ${r.revisionId === tracked.revisionId})`;
  });
  const rev2 = await step('createJsonRevision', async () => {
    const r = await gw.createJsonRevision(
      tracked.resourceId,
      { kind: 'gateway-test', n: 2 },
      { description: 'v2' },
    );
    return r.revisionId;
  });
  await step('readJson(current after revision)', async () => {
    const r = await gw.readJson(tracked.resourceId);
    if (r.data.n !== 2) throw new Error(`expected n=2 got ${r.data.n}`);
    return `n=${r.data.n} rev=${short(r.revisionId)} (is new revision: ${r.revisionId === rev2})`;
  });
  await step('readJson(explicit v1)', async () => {
    const r = await gw.readJson(tracked.resourceId, tracked.revisionId);
    return `n=${r.data.n} rev=${short(r.revisionId)}`;
  });
  await step(
    'listRevisions(test resource)',
    async () => `${(await gw.listRevisions(tracked.resourceId)).length} revisions`,
  );
  await step('listTrackedResources(revisionId follows Latest)', async () => {
    const t = (await gw.listTrackedResources(RUNS_SYSTEM_ID)).find(
      (x) => x.resourceId === tracked.resourceId,
    );
    return `rev=${short(t?.revisionId)} isNew=${t?.revisionId === rev2}`;
  });
  await step(
    'listArtifacts(test resource, expect 0)',
    async () => `${(await gw.listArtifacts(tracked.resourceId)).length}`,
  );
  await step(
    'listJobs(test resource, expect 0)',
    async () => `${(await gw.listJobs({ resourceId: tracked.resourceId })).length}`,
  );
  console.log(`     resourceUrl=${gw.resourceUrl(tracked.resourceId)} jobUrl=${gw.jobUrl('<jobId>')}`);

  if (process.env.PROBE_CREATE_JOB === '1' && fns) {
    await step(`createJob(${process.env.PROBE_FUNCTION} on test resource)`, async () => {
      const j = await gw.createJob({
        resourceId: tracked.resourceId,
        functionName: process.env.PROBE_FUNCTION ?? '@istari:extract',
        toolName: process.env.PROBE_TOOL,
        toolVersion: process.env.PROBE_TOOL_VERSION,
        operatingSystem: process.env.PROBE_OS,
        parameters: {},
      });
      const again = await gw.getJob(j.jobId);
      if (!['Completed', 'Failed', 'Canceled'].includes(again.status)) await gw.cancelJob(j.jobId);
      return `job=${short(j.jobId)} status=${j.status} -> ${(await gw.getJob(j.jobId)).status}`;
    });
  } else {
    console.log('SKIP createJob (set PROBE_CREATE_JOB=1 to run it against the probe resource)');
  }
}

await step('GatewayError on 404', async () => {
  try {
    await gw.getResource('00000000-0000-0000-0000-000000000000');
  } catch (err) {
    if (err?.name === 'GatewayError' && err.status)
      return `status=${err.status} body=${JSON.stringify(err.body).slice(0, 60)}`;
    throw err;
  }
  throw new Error('expected a GatewayError');
});

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
void before;
void created;
process.exit(failures === 0 ? 0 : 1);
