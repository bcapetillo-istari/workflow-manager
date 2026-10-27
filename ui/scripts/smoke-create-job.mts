// Smoke test: create one real job with RestGateway and poll it a few times. Run: npx tsx scripts/smoke-create-job.mts
import { readFileSync } from 'node:fs';
import { RestGateway } from '../src/gateway/rest/index.ts';

const env = readFileSync('/Users/benjamincapetillo/Projects/rfi-manager-ui/.env', 'utf8');
const token = env.match(/^ISTARI_TOKEN=(.*)$/m)?.[1]?.trim() ?? '';
const gw = new RestGateway({ registryUrl: 'https://api.demo.istari.app', istariWebUrl: 'https://demo.istari.app', getToken: () => token });

const resourceId = process.env.SMOKE_RESOURCE ?? '01183340-4ffa-4201-a86e-d3070c446cc5'; // Graywing ... RFI_Response.pdf (owned by user)
const osCandidates = (process.env.SMOKE_OS ?? 'Ubuntu 22.04,Ubuntu 24.04,RHEL 9').split(',');

const res = await gw.getResource(resourceId);
console.log('resource', res.name, res.extension, res.resourceType);
let job = null as Awaited<ReturnType<typeof gw.createJob>> | null;
for (const os of osCandidates) {
  try {
    job = await gw.createJob({
      resourceId,
      functionName: '@istari:extract',
      functionVersion: '1.8.0',
      toolName: 'open_pdf',
      toolVersion: '1.0.0',
      operatingSystem: os,
      parameters: {},
    });
    console.log('CREATED job', job.jobId, 'status', job.status, 'os', os);
    break;
  } catch (e) {
    const err = e as { status?: number; body?: unknown; message: string };
    console.log(`os=${os} -> ${err.status ?? ''} ${err.message.slice(0, 200)} ${JSON.stringify(err.body ?? '').slice(0, 300)}`);
  }
}
if (job) {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const j = await gw.getJob(job.jobId);
    console.log(`poll ${i + 1}: ${j.status} ${j.statusMessage ?? ''}`);
    if (['Completed', 'Failed', 'Canceled'].includes(j.status)) break;
  }
  console.log('job url', gw.jobUrl(job.jobId));
}
