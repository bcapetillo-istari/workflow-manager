// Live Smart Diff run through the real engine. Run from ui/: npx tsx scripts/smoke-smart-diff.mts
// Env: SMOKE_FILE1, SMOKE_FILE2 (resource ids), SMOKE_CREDENTIAL (name substring, default anthropic), SMOKE_SECONDS
import { readFileSync } from 'node:fs';
import { RestGateway } from '../src/gateway/rest/index.ts';
import { loadCatalog } from '../src/catalog/loadCatalog.ts';
import { createRun, submitStage, writeRun, observeJobWithArtifacts, runningJob } from '../src/run/effects.ts';
import { startJobPolling } from '../src/run/polling.ts';
import type { LoadedManifest } from '../src/manifest/types.ts';
import type { RunDocument } from '../src/run/types.ts';

const env = readFileSync('/Users/benjamincapetillo/Projects/rfi-manager-ui/.env', 'utf8');
const token = env.match(/^ISTARI_TOKEN=(.*)$/m)?.[1]?.trim() ?? '';
const config = JSON.parse(readFileSync('public/config.json', 'utf8')) as {
  registryUrl: string; istariWebUrl: string; workflowManagerSystemId: string; workflowManagerRunsSystemId: string;
};
const gw = new RestGateway({ registryUrl: config.registryUrl, istariWebUrl: config.istariWebUrl, getToken: () => token });
const now = () => new Date().toISOString();
const deps = { gateway: gw };

const user = await gw.currentUser();
const catalog = await loadCatalog(gw, config.workflowManagerSystemId);
const entry = catalog.find((c): c is LoadedManifest => c.ok && c.manifest.key === 'smart-diff');
if (!entry) throw new Error('smart-diff manifest not found: ' + JSON.stringify(catalog.map((c) => (c.ok ? c.manifest.key : c.errors))));
console.log('manifest smart-diff v' + entry.manifest.version, 'rev', entry.revisionId);

const file1Id = process.env.SMOKE_FILE1 ?? '01183340-4ffa-4201-a86e-d3070c446cc5';
let file2Id = process.env.SMOKE_FILE2;
if (!file2Id) {
  const docs = await gw.searchResources({ extensions: ['pdf', 'docx', 'txt'], size: 50 });
  const mine = docs.filter((d) => d.createdById === user.id && d.resourceId !== file1Id && (d.extension ?? '') !== 'txt');
  file2Id = (mine[0] ?? docs.find((d) => d.resourceId !== file1Id))?.resourceId;
}
if (!file2Id) throw new Error('no second document found');
const [file1, file2] = await Promise.all([gw.getResource(file1Id), gw.getResource(file2Id)]);
console.log('file1', file1.name, '| file2', file2.name);

const secrets = await gw.listAuthSecrets();
const wanted = (process.env.SMOKE_CREDENTIAL ?? 'anthropic').toLowerCase();
const cred = secrets.find((s) => s.name.toLowerCase().includes(wanted));
if (!cred) throw new Error('credential not found; have: ' + secrets.map((s) => s.name).join(', '));
console.log('credential', cred.name, 'provider', cred.provider);
const group = cred.provider ?? 'claude';
const modelFn = entry.manifest.stages[0].inputs?.find((i) => i.key === 'model')?.filter?.options_by?.groups[group]?.[0]?.value;
if (!modelFn) throw new Error('no model option for provider ' + group);

const created = await createRun(deps, config, entry, user.id, now());
console.log('run created', created.resourceId);
let doc: RunDocument = await submitStage(deps, entry.manifest, created.doc, 'configure', {
  file1: { resource_id: file1.resourceId, revision_id: file1.revisionId, name: file1.name },
  file2: { resource_id: file2.resourceId, revision_id: file2.revisionId, name: file2.name },
  llm_credential: { secret_id: cred.secretId, name: cred.name, provider: cred.provider },
  model: modelFn,
  prompt: 'Diff these two files. Focus on scope, deliverables, and any conflicting requirements.',
}, now());
await writeRun(gw, created.resourceId, doc);
const job = runningJob(doc, entry.manifest);
console.log('job', job?.jobId, 'function', modelFn, '->', job ? gw.jobUrl(job.jobId) : '-');

const seconds = Number(process.env.SMOKE_SECONDS ?? 150);
if (job) {
  await new Promise<void>((resolve) => {
    const stop = startJobPolling({
      gateway: gw, runResourceId: created.resourceId, jobId: job.jobId, visibility: null,
      backoff: { initialMs: 5000, maxMs: 15000 },
      onCycle: async (j, latest) => {
        const res = await observeJobWithArtifacts(deps, entry.manifest, doc, { stageKey: 'configure', job: j, latest, at: now() });
        console.log(`${new Date().toLocaleTimeString()} job=${j.status} run=${res.doc.status} stage=${res.doc.current_stage}`);
        if (res.doc !== doc) { doc = res.doc; await writeRun(gw, created.resourceId, doc); }
        if (res.terminal) resolve();
      },
      onError: (e) => console.log('poll error', (e as Error).message),
    });
    setTimeout(() => { stop(); resolve(); }, seconds * 1000);
  });
}
const final = await gw.readJson<RunDocument>(created.resourceId);
console.log('final status', final.data.status, '| stages', JSON.stringify(Object.fromEntries(Object.entries(final.data.stages).map(([k, s]) => [k, s.status]))));
console.log('outputs', JSON.stringify(final.data.stages.configure?.outputs ?? null).slice(0, 600));
console.log(`open in app: http://localhost:5173/apps/workflows/runs/${created.resourceId}`);
