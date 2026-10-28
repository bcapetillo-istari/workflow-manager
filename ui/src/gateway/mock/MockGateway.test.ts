import { describe, expect, it } from 'vitest';
import type { RunDocument } from '../../run/types';
import { makeMockGateway, testConfig } from '../../test/renderWithProviders';

describe('MockGateway', () => {
  it('advances jobs through Pending -> Running -> Completed and writes outputs into the run document', async () => {
    const gw = makeMockGateway();
    const manifests = await gw.listTrackedResources(testConfig.workflowManagerSystemId);
    const smartDiff = manifests.find((m) => m.name === 'smart-diff.json')!;
    const [doc] = await gw.searchResources({ extensions: ['pdf'] });
    const run: RunDocument = {
      schema_version: '1',
      run_id: 'r1',
      workflow_key: 'smart-diff',
      workflow_version: '1.1.0',
      workflow_name: 'Smart Diff',
      manifest_resource_id: smartDiff.resourceId,
      manifest_revision_id: smartDiff.revisionId,
      initiator_user_id: 'u',
      status: 'running_job',
      current_stage: 'configure',
      stage_order: ['configure', 'results'],
      stages: {
        configure: { key: 'configure', status: 'running' },
        results: { key: 'results', status: 'pending' },
      },
      created: 'now',
      updated: 'now',
    };
    const job = await gw.createJob({ resourceId: doc!.resourceId, functionName: 'f', parameters: {} });
    run.stages.configure!.job_id = job.jobId;
    const { resourceId, revisionId } = await gw.createJsonResource({
      systemId: testConfig.workflowManagerRunsSystemId,
      name: 'r1.json',
      data: run,
    });

    expect((await gw.getJob(job.jobId)).status).toBe('Running');
    expect((await gw.getJob(job.jobId)).status).toBe('Completed');
    expect((await gw.getJob(job.jobId)).status).toBe('Completed');

    const latest = await gw.readJson<RunDocument>(resourceId);
    expect(latest.revisionId).not.toBe(revisionId);
    const outputs = latest.data.stages.configure!.outputs!;
    expect(outputs.report).toMatchObject({
      resource_id: expect.any(String),
      name: expect.stringMatching(/report/),
    });
    expect(outputs.summary).toMatchObject({ conflicts: 3 });
    expect(latest.data.stages.configure!.progress?.at(-1)?.percent).toBe(100);
    expect(await gw.listArtifacts(doc!.resourceId)).toHaveLength(2);
  });

  it('filters searches by extension and system and bumps revisions on JSON writes', async () => {
    const gw = makeMockGateway();
    const pdfs = await gw.searchResources({ extensions: ['pdf'] });
    expect(pdfs.length).toBeGreaterThan(0);
    expect(pdfs.every((r) => r.extension === 'pdf')).toBe(true);
    expect(await gw.searchResources({ systemId: 'nope' })).toEqual([]);
    const created = await gw.createJsonResource({
      systemId: testConfig.workflowManagerRunsSystemId,
      name: 'x.json',
      data: { a: 1 },
    });
    const rev = await gw.createJsonRevision(created.resourceId, { a: 2 });
    expect(rev.revisionId).not.toBe(created.revisionId);
    expect((await gw.readJson(created.resourceId)).data).toEqual({ a: 2 });
    expect((await gw.readJson(created.resourceId, created.revisionId)).data).toEqual({ a: 1 });
    expect(await gw.listRevisions(created.resourceId)).toHaveLength(2);
    expect((await gw.listAuthSecrets({ secretType: '@token:llm' })).map((s) => s.name)).toEqual(['OpenAI (team key)', 'Anthropic (personal)']);
  });
});
