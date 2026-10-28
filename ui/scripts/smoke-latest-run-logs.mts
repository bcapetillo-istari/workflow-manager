// Print the newest run document's status and the text of its stderr/stdout artifacts.
import { readFileSync } from 'node:fs';
import { RestGateway } from '../src/gateway/rest/index.ts';
import type { RunDocument } from '../src/run/types.ts';
const env = readFileSync('/Users/benjamincapetillo/Projects/rfi-manager-ui/.env', 'utf8');
const token = env.match(/^ISTARI_TOKEN=(.*)$/m)?.[1]?.trim() ?? '';
const cfg = JSON.parse(readFileSync('public/config.json', 'utf8')) as { registryUrl: string; istariWebUrl: string; workflowManagerRunsSystemId: string };
const gw = new RestGateway({ registryUrl: cfg.registryUrl, istariWebUrl: cfg.istariWebUrl, getToken: () => token });
const tracked = (await gw.listTrackedResources(cfg.workflowManagerRunsSystemId)).filter((t) => t.name.endsWith('.json') && !t.name.startsWith('_'));
tracked.sort((a, b) => (a.updated < b.updated ? 1 : -1));
const n = Number(process.env.N ?? 1);
for (const t of tracked.slice(0, n)) {
  const { data: run } = await gw.readJson<RunDocument>(t.resourceId);
  const stage = run.stages[run.stage_order[0]];
  console.log(`\n=== run ${run.run_id} ${run.workflow_key} v${run.workflow_version} status=${run.status} updated=${run.updated}`);
  console.log('job', stage?.job_id, '| inputs', JSON.stringify(stage?.inputs ?? {}).slice(0, 300));
  const arts = (stage?.outputs?.artifacts ?? []) as Array<{ resource_id: string; revision_id: string; name: string }>;
  console.log('artifacts:', arts.map((a) => a.name).join(', '));
  for (const a of arts) {
    if (/stderr|stdout|exit-status/i.test(a.name)) {
      const text = await gw.readText(a.resource_id, a.revision_id).catch((e) => `(read failed: ${(e as Error).message})`);
      console.log(`--- ${a.name} (${text.length} chars) ---\n${text.trim().split('\n').slice(-12).join('\n')}`);
    }
  }
}
