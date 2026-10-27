// Cancel a run (writes the cancelled run document) and/or raw jobs. Run: npx tsx scripts/smoke-cancel.mts <runResourceId|-> [jobId...]
import { readFileSync } from 'node:fs';
import { RestGateway } from '../src/gateway/rest/index.ts';
import { cancelRun, writeRun } from '../src/run/effects.ts';
import { validateManifest } from '../src/manifest/validate.ts';
import type { RunDocument } from '../src/run/types.ts';

const env = readFileSync('/Users/benjamincapetillo/Projects/rfi-manager-ui/.env', 'utf8');
const token = env.match(/^ISTARI_TOKEN=(.*)$/m)?.[1]?.trim() ?? '';
const config = JSON.parse(readFileSync('public/config.json', 'utf8')) as { registryUrl: string; istariWebUrl: string };
const gw = new RestGateway({ registryUrl: config.registryUrl, istariWebUrl: config.istariWebUrl, getToken: () => token });

const [runId, ...jobIds] = process.argv.slice(2);
if (runId && runId !== '-') {
  const { data: doc } = await gw.readJson<RunDocument>(runId);
  const m = await gw.readJson(doc.manifest_resource_id, doc.manifest_revision_id);
  const v = validateManifest(m.data);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  const next = await cancelRun({ gateway: gw }, v.manifest, doc, new Date().toISOString());
  await writeRun(gw, runId, next);
  console.log('run', runId, '->', next.status, 'error:', next.error);
}
for (const id of jobIds) {
  await gw.cancelJob(id);
  const j = await gw.getJob(id);
  console.log('job', id, '->', j.status);
}
