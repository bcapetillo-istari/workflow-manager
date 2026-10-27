// Live walking skeleton: catalog -> create run -> submit stage (creates job) -> poll -> write transitions.
// Run from ui/: npx tsx scripts/smoke-run.mts   (optional: SMOKE_SECONDS=60 SMOKE_RESOURCE=<pdf resource id>)
import { readFileSync } from 'node:fs';
import { RestGateway } from '../src/gateway/rest/index.ts';
import { loadCatalog } from '../src/catalog/loadCatalog.ts';
import { createRun, submitStage, writeRun, observeJob, runningJob } from '../src/run/effects.ts';
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

const user = await gw.currentUser();
const catalog = await loadCatalog(gw, config.workflowManagerSystemId);
console.log('catalog:', catalog.map((c) => (c.ok ? `${c.manifest.key}@${c.manifest.version}` : `INVALID ${c.fileName}`)).join(', '));
const entry = catalog.find((c): c is LoadedManifest => c.ok && c.manifest.key === 'pdf-extract-test');
if (!entry) throw new Error('pdf-extract-test manifest not found');

const created = await createRun({ gateway: gw }, config, entry, user.id, now());
console.log('run created:', created.resourceId, 'status', created.doc.status, 'stage', created.doc.current_stage);

const pdfId = process.env.SMOKE_RESOURCE ?? '01183340-4ffa-4201-a86e-d3070c446cc5';
const pdf = await gw.getResource(pdfId);
let doc: RunDocument = await submitStage({ gateway: gw }, entry.manifest, created.doc, 'select', {
  document: { resource_id: pdf.resourceId, revision_id: pdf.revisionId, name: pdf.name },
  note: 'smoke-run.mts',
}, now());
await writeRun(gw, created.resourceId, doc);
const job = runningJob(doc, entry.manifest);
console.log('stage submitted; run status', doc.status, 'job', job?.jobId ?? '(none)');

const seconds = Number(process.env.SMOKE_SECONDS ?? 45);
if (job) {
  await new Promise<void>((resolve) => {
    const stop = startJobPolling({
      gateway: gw,
      runResourceId: created.resourceId,
      jobId: job.jobId,
      visibility: null,
      backoff: { initialMs: 3000, maxMs: 10000 },
      onCycle: async (j, latest) => {
        const res = observeJob(entry.manifest, doc, { stageKey: 'select', job: j, latest, at: now() });
        console.log(`poll: job=${j.status} run=${res.doc.status} stage=${res.doc.current_stage}`);
        if (res.doc !== doc) { doc = res.doc; await writeRun(gw, created.resourceId, doc); }
        if (res.terminal) resolve();
      },
      onError: (e) => console.log('poll error', (e as Error).message),
    });
    setTimeout(() => { stop(); resolve(); }, seconds * 1000);
  });
}
const final = await gw.readJson<RunDocument>(created.resourceId);
console.log('final run doc rev', final.revisionId, 'status', final.data.status, 'stages', JSON.stringify(Object.fromEntries(Object.entries(final.data.stages).map(([k, s]) => [k, s.status]))));
console.log(`open in app: http://localhost:5173/apps/workflows/runs/${created.resourceId}`);
console.log(`job in Istari: ${job ? gw.jobUrl(job.jobId) : '-'}`);
