import { describe, expect, it, vi } from 'vitest';
import {
  artifactFallbackOutputs,
  buildJobRequest,
  cancelRun,
  createRun,
  observeJob,
  observeJobWithArtifacts,
  runningJob,
  submitStage,
  writeRun,
} from './effects';
import { SECRET_PLACEHOLDER } from './reducer';
import type { RunDocument } from './types';
import { createFakeGateway } from './testing/fakeGateway';
import {
  boundFunctionManifest,
  file2Value,
  fileValue,
  jobChainManifest,
  loaded,
  secretValue,
  threeStageManifest,
} from './testing/fixtures';

const T0 = '2026-10-23T10:00:00.000Z';
const T1 = '2026-10-23T10:01:00.000Z';
const T2 = '2026-10-23T10:02:00.000Z';
const config = { workflowManagerRunsSystemId: 'sys-runs' };
const M = threeStageManifest;
const configureInputs = { file1: fileValue, prompt: 'compare', api_key: 'hunter2', llm: secretValue };

async function started() {
  const gateway = createFakeGateway();
  const created = await createRun({ gateway }, config, loaded(M), 'user-1', T0);
  return { gateway, ...created };
}

describe('createRun', () => {
  it('writes <run_id>.json into the runs system and returns its location', async () => {
    const { gateway, resourceId, revisionId, doc } = await started();
    const call = gateway.calls.find((c) => c.method === 'createJsonResource');
    expect(call?.args[0]).toMatchObject({
      systemId: 'sys-runs',
      name: `${doc.run_id}.json`,
      description: 'Smart Diff run',
    });
    expect(gateway.peekJson<RunDocument>(resourceId)).toEqual(doc);
    expect(revisionId).toBeTruthy();
    expect(doc.stages.configure.status).toBe('collecting');
  });
});

describe('submitStage', () => {
  it('creates the job with resolved parameters and moves the run to running_job', async () => {
    const { gateway, doc } = await started();
    const next = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    const req = gateway.calls.find((c) => c.method === 'createJob')?.args[0];
    expect(req).toEqual({
      resourceId: 'res-file1',
      functionName: '@istari_utils:smart_diff',
      functionVersion: '1.0.2',
      parameters: { prompt: 'compare', auth_token: 'sec-1', mode: 'full', depth: 3 },
      toolName: 'smart_diff',
      toolVersion: '2',
      operatingSystem: 'linux',
      agentPoolId: 'pool-1',
    });
    expect(next.status).toBe('running_job');
    expect(next.stages.configure).toMatchObject({ status: 'running', job_id: 'job-1', started: T1 });
    expect(next.stages.configure.inputs?.api_key).toBe(SECRET_PLACEHOLDER);
    expect(runningJob(next, M)).toEqual({ stageKey: 'configure', jobId: 'job-1' });
  });

  it('does not write the document (callers write via writeRun)', async () => {
    const { gateway, resourceId, doc } = await started();
    const next = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    expect(gateway.revisionCount(resourceId)).toBe(1);
    await writeRun(gateway, resourceId, next);
    expect(gateway.revisionCount(resourceId)).toBe(2);
    expect(gateway.peekJson<RunDocument>(resourceId).status).toBe('running_job');
  });

  it('on a review stage does not create a job and advances', async () => {
    const { gateway, doc } = await started();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    gateway.setJobStatus('job-1', 'Completed');
    const job = await gateway.getJob('job-1');
    const { doc: reviewing } = observeJob(M, running, { stageKey: 'configure', job, latest: null, at: T1 });
    const jobCalls = gateway.calls.filter((c) => c.method === 'createJob').length;
    const done = await submitStage({ gateway }, M, reviewing, 'review', { decision: 'accept' }, T1);
    expect(gateway.calls.filter((c) => c.method === 'createJob').length).toBe(jobCalls);
    expect(done.status).toBe('succeeded');
  });

  it('binds later job parameters from earlier stage inputs and outputs', async () => {
    const gateway = createFakeGateway();
    const { doc } = await createRun({ gateway }, config, loaded(jobChainManifest), 'u', T0);
    const first = await submitStage({ gateway }, jobChainManifest, doc, 'diff', { model: fileValue }, T1);
    gateway.setJobStatus('job-1', 'Completed');
    const latest: RunDocument = {
      ...first,
      stages: { ...first.stages, diff: { ...first.stages.diff, outputs: { conflicts: ['c1', 'c2'] } } },
    };
    const job = await gateway.getJob('job-1');
    const { doc: second } = observeJob(jobChainManifest, first, { stageKey: 'diff', job, latest, at: T1 });
    expect(second.current_stage).toBe('resolve');
    const other = { resource_id: 'res-other', revision_id: 'r', name: 'b.step' };
    await submitStage({ gateway }, jobChainManifest, second, 'resolve', { model: other }, T1);
    const req = gateway.calls.filter((c) => c.method === 'createJob').at(-1)?.args[0];
    expect(req).toMatchObject({
      resourceId: 'res-other',
      parameters: { conflicts: ['c1', 'c2'], source: 'res-file1' },
    });
  });

  it('rejects when the target input is not a resource or the stage is not collecting', async () => {
    const { gateway, doc } = await started();
    await expect(
      submitStage({ gateway }, M, doc, 'configure', { ...configureInputs, file1: 'x' }, T1),
    ).rejects.toThrow(/target input "file1"/);
    await expect(submitStage({ gateway }, M, doc, 'review', {}, T1)).rejects.toThrow(/not collecting/);
    await expect(submitStage({ gateway }, M, doc, 'missing', {}, T1)).rejects.toThrow(/not in the manifest/);
  });

  it('propagates createJob failures without changing the stored document', async () => {
    const { gateway, resourceId, doc } = await started();
    gateway.failNext('createJob', new Error('agent pool unavailable'));
    await expect(submitStage({ gateway }, M, doc, 'configure', configureInputs, T1)).rejects.toThrow(
      'agent pool',
    );
    expect(gateway.peekJson<RunDocument>(resourceId).stages.configure.status).toBe('collecting');
  });
});

describe('observeJob', () => {
  it('merges module-written outputs and progress from the latest document', async () => {
    const { gateway, resourceId, doc } = await started();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    await writeRun(gateway, resourceId, running);
    const progress = [{ at: T1, message: 'parsing', percent: 10 }];
    gateway.writeModuleUpdate(resourceId, 'configure', { progress });
    const latest = gateway.peekJson<RunDocument>(resourceId);
    const job = await gateway.getJob('job-1');
    const result = observeJob(M, running, { stageKey: 'configure', job, latest, at: T1 });
    expect(result.terminal).toBe(false);
    expect(result.doc.stages.configure.progress).toEqual(progress);
    expect(result.doc.status).toBe('running_job');
  });

  it('on Completed keeps module outputs and advances', async () => {
    const { gateway, resourceId, doc } = await started();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    await writeRun(gateway, resourceId, running);
    gateway.writeModuleUpdate(resourceId, 'configure', { outputs: { report: 'art-9' } });
    gateway.setJobStatus('job-1', 'Completed');
    const result = observeJob(M, running, {
      stageKey: 'configure',
      job: await gateway.getJob('job-1'),
      latest: gateway.peekJson<RunDocument>(resourceId),
      at: T1,
    });
    expect(result.terminal).toBe(true);
    expect(result.doc.stages.configure).toMatchObject({ status: 'succeeded', outputs: { report: 'art-9' } });
    expect(result.doc.current_stage).toBe('review');
    expect(runningJob(result.doc, M)).toBeNull();
  });

  it('on Failed carries the status message', async () => {
    const { gateway, doc } = await started();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    gateway.setJobStatus('job-1', 'Failed', 'out of memory');
    const result = observeJob(M, running, {
      stageKey: 'configure',
      job: await gateway.getJob('job-1'),
      latest: null,
      at: T1,
    });
    expect(result.terminal).toBe(true);
    expect(result.doc.status).toBe('failed');
    expect(result.doc.stages.configure.error).toBe('out of memory');
  });
});

describe('cancelRun', () => {
  it('cancels the in-flight job and the run', async () => {
    const { gateway, doc } = await started();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    const cancelled = await cancelRun({ gateway }, M, running, T1);
    expect(gateway.calls.some((c) => c.method === 'cancelJob' && c.args[0] === 'job-1')).toBe(true);
    expect((await gateway.getJob('job-1')).status).toBe('Canceled');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.stages.configure.status).toBe('cancelled');
  });

  it('ignores cancelJob errors and skips the call when no job is running', async () => {
    const { gateway, doc } = await started();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    gateway.failNext('cancelJob', new Error('already finished'));
    expect((await cancelRun({ gateway }, M, running, T1)).status).toBe('cancelled');
    const before = gateway.calls.length;
    expect((await cancelRun({ gateway }, M, doc, T1)).status).toBe('cancelled');
    expect(gateway.calls.length).toBe(before);
  });
});

describe('buildJobRequest bindings', () => {
  const stage = boundFunctionManifest.stages[0];
  const fn = stage.function!;
  const inputs = { fn: '@acme:compare', file1: fileValue, file2: file2Value, llm: secretValue };

  it('resolves the function name, sources and auth bindings from inputs', async () => {
    const gateway = createFakeGateway();
    const { doc } = await createRun({ gateway }, config, loaded(boundFunctionManifest), 'u', T0);
    const next = await submitStage({ gateway }, boundFunctionManifest, doc, 'run', inputs, T1);
    expect(gateway.jobRequest(next.stages.run.job_id!)).toMatchObject({
      resourceId: 'res-file1',
      functionName: '@acme:compare',
      sources: [{ revisionId: 'rev-file2', relationshipIdentifier: 'file2' }],
      authBindings: [{ inputName: 'auth_token', credentialId: 'sec-1' }],
    });
  });

  it('omits sources/authBindings when the manifest declares none', async () => {
    const { gateway, doc } = await started();
    const next = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    const req = gateway.jobRequest(next.stages.configure.job_id!);
    expect(req.sources).toBeUndefined();
    expect(req.authBindings).toBeUndefined();
  });

  it('throws clear errors when bindings do not resolve', async () => {
    const { doc } = await started();
    expect(() => buildJobRequest(stage, fn, { ...inputs, fn: '' }, doc)).toThrow(/function name binding/);
    expect(() => buildJobRequest(stage, fn, { ...inputs, fn: 7 }, doc)).toThrow(/function name binding/);
    expect(() => buildJobRequest(stage, fn, { ...inputs, file2: 'x' }, doc)).toThrow(/source "file2"/);
    expect(() => buildJobRequest(stage, fn, { ...inputs, llm: { name: 'no id' } }, doc)).toThrow(
      /auth binding "auth_token"/,
    );
  });
});

describe('artifact fallback', () => {
  async function runningThree() {
    const { gateway, resourceId, doc } = await started();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T1);
    await writeRun(gateway, resourceId, running);
    gateway.setJobStatus('job-1', 'Completed');
    const job = await gateway.getJob('job-1');
    return { gateway, resourceId, running, job };
  }

  it('fills declared artifact outputs from artifacts created since the stage started', async () => {
    const { gateway, running, job } = await runningThree();
    gateway.seedArtifact('res-file1', { name: 'old.pdf', created: '2026-10-23T09:00:00.000Z' });
    const fresh = gateway.seedArtifact('res-file1', {
      name: 'report.pdf',
      created: '2026-10-23T10:05:00.000Z',
    });
    const result = await observeJobWithArtifacts({ gateway }, M, running, {
      stageKey: 'configure',
      job,
      latest: null,
      at: T2,
    });
    expect(result.terminal).toBe(true);
    expect(result.doc.stages.configure.status).toBe('succeeded');
    expect(result.doc.stages.configure.outputs).toEqual({
      report: [{ resource_id: fresh.resourceId, revision_id: fresh.revisionId, name: 'report.pdf' }],
    });
    expect(result.doc.current_stage).toBe('review');
  });

  it('keeps module-written outputs and only fills the missing artifact keys', async () => {
    const { gateway, resourceId, running, job } = await runningThree();
    gateway.writeModuleUpdate(resourceId, 'configure', { outputs: { conflicts: [1, 2] } });
    gateway.seedArtifact('res-file1', { name: 'r.pdf', created: '2026-10-23T10:05:00.000Z' });
    const latest = gateway.peekJson<RunDocument>(resourceId);
    const { doc } = await observeJobWithArtifacts({ gateway }, M, running, {
      stageKey: 'configure',
      job,
      latest,
      at: T2,
    });
    expect(doc.stages.configure.outputs?.conflicts).toEqual([1, 2]);
    expect(doc.stages.configure.outputs?.report).toHaveLength(1);
  });

  it('skips when the module wrote the artifact output or the job is not Completed', async () => {
    const { gateway, resourceId, running, job } = await runningThree();
    gateway.writeModuleUpdate(resourceId, 'configure', { outputs: { report: 'art-1' } });
    const latest = gateway.peekJson<RunDocument>(resourceId);
    expect(await artifactFallbackOutputs({ gateway }, M, running, 'configure', latest)).toBeNull();
    const pending = { ...job, status: 'Running' as const };
    await observeJobWithArtifacts({ gateway }, M, running, {
      stageKey: 'configure',
      job: pending,
      latest: null,
      at: T2,
    });
    expect(gateway.calls.some((c) => c.method === 'listArtifacts')).toBe(false);
  });

  it('logs and continues without outputs when listArtifacts fails', async () => {
    const { gateway, running, job } = await runningThree();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gateway.failNext('listArtifacts', new Error('503'));
    const { doc } = await observeJobWithArtifacts({ gateway }, M, running, {
      stageKey: 'configure',
      job,
      latest: null,
      at: T2,
    });
    expect(warn).toHaveBeenCalled();
    expect(doc.stages.configure.outputs).toBeUndefined();
    expect(doc.stages.configure.status).toBe('succeeded');
    warn.mockRestore();
  });
});
