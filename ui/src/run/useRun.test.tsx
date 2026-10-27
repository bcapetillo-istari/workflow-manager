import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../gateway/types';
import { createRun, submitStage, writeRun } from './effects';
import { createFakeGateway, type FakeGateway } from './testing/fakeGateway';
import { fileValue, loaded, secretValue, threeStageManifest } from './testing/fixtures';
import type { RunDocument } from './types';
import { useCreateRun, useRun, useRunHistory } from './useRun';

const config = {
  registryUrl: 'https://istari.test',
  istariWebUrl: 'https://istari.test',
  workflowManagerSystemId: 'sys-manifests',
  workflowManagerRunsSystemId: 'sys-runs',
  devAuth: true,
};
const T0 = '2026-10-23T10:00:00.000Z';
const M = threeStageManifest;
const configureInputs = { file1: fileValue, prompt: 'compare', api_key: 'hunter2', llm: secretValue };

let gateway: FakeGateway;
let authUser: CurrentUser | null = { id: 'user-1' };

vi.mock('./external', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./external')>();
  return {
    ...actual,
    useGateway: () => gateway,
    useAuth: () => ({ provider: { kind: 'dev-token' }, user: authUser }),
    useConfig: () => config,
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function seedRun() {
  const entry = loaded(M);
  gateway.seedJsonResource({ systemId: 'sys-manifests', name: entry.fileName, data: M });
  const seeded = { ...entry, resourceId: 'res-1', revisionId: 'rev-1' };
  const { resourceId, doc } = await createRun({ gateway }, config, seeded, 'user-1', T0);
  return { resourceId, doc, entry: seeded };
}

beforeEach(() => {
  gateway = createFakeGateway();
  authUser = { id: 'user-1' };
});
afterEach(() => vi.useRealTimers());

describe('useCreateRun', () => {
  it('creates a run document in the runs system for the current user', async () => {
    const { result } = renderHook(() => useCreateRun(), { wrapper });
    let created: { resourceId: string } | undefined;
    await act(async () => {
      created = await result.current.createRun(loaded(M));
    });
    expect(created?.resourceId).toBeTruthy();
    const doc = gateway.peekJson<RunDocument>(created!.resourceId);
    expect(doc.initiator_user_id).toBe('user-1');
    expect(doc.current_stage).toBe('configure');
    expect(result.current.creating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('falls back to gateway.currentUser() when auth has no user and surfaces errors', async () => {
    authUser = null;
    gateway.user = { id: 'user-9' };
    const { result } = renderHook(() => useCreateRun(), { wrapper });
    let created: { resourceId: string } | undefined;
    await act(async () => {
      created = await result.current.createRun(loaded(M));
    });
    expect(gateway.peekJson<RunDocument>(created!.resourceId).initiator_user_id).toBe('user-9');
    gateway.failNext('createJsonResource', new Error('forbidden'));
    await act(async () => {
      await expect(result.current.createRun(loaded(M))).rejects.toThrow('forbidden');
    });
    expect(result.current.error?.message).toBe('forbidden');
  });
});

describe('useRun', () => {
  it('loads the run and its manifest and exposes the current stage', async () => {
    const { resourceId } = await seedRun();
    const { result } = renderHook(() => useRun(resourceId), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.run?.run_id).toBeTruthy();
    expect(result.current.manifest?.key).toBe('smart-diff');
    expect(result.current.currentStage?.key).toBe('configure');
    expect(result.current.error).toBeNull();
    const manifestRead = gateway.calls.find((c) => c.method === 'readJson' && c.args[0] === 'res-1');
    expect(manifestRead?.args[1]).toBe('rev-1');
  });

  it('surfaces an invalid manifest as an error but still shows the run', async () => {
    gateway.seedJsonResource({ systemId: 'sys-manifests', name: 'bad.json', data: { schema_version: '1' } });
    const entry = { ...loaded(M), resourceId: 'res-1', revisionId: 'rev-1' };
    const { resourceId } = await createRun({ gateway }, config, entry, 'user-1', T0);
    const { result } = renderHook(() => useRun(resourceId), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.run?.workflow_key).toBe('smart-diff');
    expect(result.current.manifest).toBeNull();
    expect(result.current.error?.message).toMatch(/Manifest is invalid/);
    expect(result.current.currentStage).toBeNull();
  });

  it('submits inputs, writes a revision, polls to completion and advances to the review gate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { resourceId } = await seedRun();
    const { result } = renderHook(() => useRun(resourceId), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.submitStageInputs(configureInputs);
    });
    expect(result.current.run?.status).toBe('running_job');
    const stored = gateway.peekJson<RunDocument>(resourceId);
    expect(stored.stages.configure).toMatchObject({
      status: 'running',
      job_id: 'job-1',
      inputs: { api_key: '[secret]' },
    });
    expect(gateway.revisionCount(resourceId)).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(gateway.calls.filter((c) => c.method === 'getJob').length).toBe(1);

    gateway.writeModuleUpdate(resourceId, 'configure', {
      progress: [{ at: T0, message: 'working', percent: 40 }],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.run?.stages.configure.progress?.[0]?.message).toBe('working');
    expect(gateway.revisionCount(resourceId)).toBe(3); // module write only; SPA did not transition

    gateway.writeModuleUpdate(resourceId, 'configure', { outputs: { report: 'art-1' } });
    gateway.setJobStatus('job-1', 'Completed');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await waitFor(() => expect(result.current.currentStage?.key).toBe('review'));
    expect(result.current.run?.stages.configure).toMatchObject({
      status: 'succeeded',
      outputs: { report: 'art-1' },
    });
    const final = gateway.peekJson<RunDocument>(resourceId);
    expect(final.current_stage).toBe('review');
    expect(final.stages.configure.outputs).toEqual({ report: 'art-1' });
    expect(final.stages.configure.progress?.length).toBe(1);

    const polls = gateway.calls.filter((c) => c.method === 'getJob').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(gateway.calls.filter((c) => c.method === 'getJob').length).toBe(polls);

    await act(async () => {
      await result.current.submitStageInputs({ decision: 'accept' });
    });
    expect(result.current.run?.status).toBe('succeeded');
    expect(gateway.peekJson<RunDocument>(resourceId).status).toBe('succeeded');
  });

  it('resumes polling for a run that is already running when opened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { resourceId, doc } = await seedRun();
    const running = await submitStage({ gateway }, M, doc, 'configure', configureInputs, T0);
    await writeRun(gateway, resourceId, running);
    gateway.setJobStatus('job-1', 'Failed', 'disk full');
    const { result } = renderHook(() => useRun(resourceId), { wrapper });
    await waitFor(() => expect(result.current.run?.status).toBe('failed'));
    expect(result.current.run?.stages.configure.error).toBe('disk full');
    expect(gateway.peekJson<RunDocument>(resourceId).status).toBe('failed');
  });

  it('cancel cancels the job and writes the cancelled run', async () => {
    const { resourceId } = await seedRun();
    const { result } = renderHook(() => useRun(resourceId), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.submitStageInputs(configureInputs);
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.run?.status).toBe('cancelled');
    expect((await gateway.getJob('job-1')).status).toBe('Canceled');
    expect(gateway.peekJson<RunDocument>(resourceId).status).toBe('cancelled');
  });

  it('advance is a no-op write-wise when the current stage has not succeeded; refresh reloads', async () => {
    const { resourceId } = await seedRun();
    const { result } = renderHook(() => useRun(resourceId), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const revisions = gateway.revisionCount(resourceId);
    await act(async () => {
      await result.current.advance();
    });
    expect(gateway.revisionCount(resourceId)).toBe(revisions);
    gateway.writeModuleUpdate(resourceId, 'configure', { progress: [{ at: T0, message: 'external' }] });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.run?.stages.configure.progress?.[0]?.message).toBe('external');
  });

  it('reports a failed submission and keeps the stage collecting', async () => {
    const { resourceId } = await seedRun();
    const { result } = renderHook(() => useRun(resourceId), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    gateway.failNext('createJob', new Error('no agents'));
    await act(async () => {
      await expect(result.current.submitStageInputs(configureInputs)).rejects.toThrow('no agents');
    });
    expect(result.current.error?.message).toBe('no agents');
    expect(result.current.run?.stages.configure.status).toBe('collecting');
  });
});

describe('useRunHistory', () => {
  it('lists the current user runs newest first, capped at 50, ignoring other files and users', async () => {
    const mk = (i: number, user: string, updated: string) =>
      gateway.seedJsonResource({
        systemId: 'sys-runs',
        name: `run-${i}.json`,
        data: { schema_version: '1', run_id: `r${i}`, initiator_user_id: user, status: 'succeeded' },
        updated,
      });
    for (let i = 0; i < 60; i++) mk(i, 'user-1', `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`);
    mk(99, 'user-2', '2026-12-31T00:00:00.000Z');
    gateway.seedJsonResource({
      systemId: 'sys-runs',
      name: 'notes.txt',
      data: 'x',
      updated: '2027-01-01T00:00:00.000Z',
    });
    gateway.seedJsonResource({
      systemId: 'sys-runs',
      name: 'junk.json',
      data: { foo: 1 },
      updated: '2027-01-01T00:00:00.000Z',
    });
    const { result } = renderHook(() => useRunHistory(), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    const ids = result.current.runs.map((r) => r.run.run_id);
    expect(ids.length).toBe(48); // 50 newest .json: junk + user-2 + r59..r12
    expect(ids[0]).toBe('r59');
    expect(ids.at(-1)).toBe('r12');
    expect(result.current.runs[0].resourceId).toBeTruthy();
  });

  it('exposes listing errors', async () => {
    gateway.failNext('listTrackedResources', new Error('system unreadable'));
    const { result } = renderHook(() => useRunHistory(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('system unreadable');
    expect(result.current.runs).toEqual([]);
  });
});
