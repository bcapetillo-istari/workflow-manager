import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IstariGateway, JobStatus, JobSummary } from '../gateway/types';
import { DEFAULT_BACKOFF, nextDelay, startJobPolling } from './polling';
import type { RunDocument } from './types';

interface FakeVisibility {
  hidden: boolean;
  addEventListener: Document['addEventListener'];
  removeEventListener: Document['removeEventListener'];
  change(hidden: boolean): void;
  listeners(): number;
}

function fakeVisibility(): FakeVisibility {
  const handlers = new Set<() => void>();
  const vis: FakeVisibility = {
    hidden: false,
    addEventListener: ((_: string, h: EventListener) =>
      void handlers.add(h as () => void)) as Document['addEventListener'],
    removeEventListener: ((_: string, h: EventListener) =>
      void handlers.delete(h as () => void)) as Document['removeEventListener'],
    change(hidden) {
      vis.hidden = hidden;
      for (const h of handlers) h();
    },
    listeners: () => handlers.size,
  };
  return vis;
}

function harness(statuses: JobStatus[]) {
  let i = 0;
  const doc = { run_id: 'r', stages: {} } as unknown as RunDocument;
  const getJob = vi.fn(async (jobId: string): Promise<JobSummary> => {
    const status = statuses[Math.min(i++, statuses.length - 1)];
    return { jobId, resourceId: 'res', functionName: 'f', status, createdById: 'u', created: 't' };
  });
  const readJson = vi.fn(async () => ({ data: doc, revisionId: 'rev' }));
  const gateway = { getJob, readJson } as unknown as Pick<IstariGateway, 'getJob' | 'readJson'>;
  return { gateway, getJob, readJson, doc };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('nextDelay', () => {
  it('doubles and caps at 15s', () => {
    expect(nextDelay(2000)).toBe(4000);
    expect(nextDelay(4000)).toBe(8000);
    expect(nextDelay(8000)).toBe(15000);
    expect(nextDelay(15000)).toBe(15000);
    expect(DEFAULT_BACKOFF.initialMs).toBe(2000);
  });
});

describe('startJobPolling', () => {
  it('polls immediately, backs off 2s/4s/8s/15s and stops on a terminal status', async () => {
    const h = harness(['Pending', 'Running', 'Running', 'Running', 'Uploading', 'Completed']);
    const onCycle = vi.fn();
    const onTerminal = vi.fn();
    startJobPolling({
      ...h,
      runResourceId: 'run-res',
      jobId: 'job-1',
      onCycle,
      onTerminal,
      visibility: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getJob).toHaveBeenCalledTimes(1);
    expect(h.readJson).toHaveBeenCalledWith('run-res');
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.getJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.getJob).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.getJob).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.getJob).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.getJob).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.getJob).toHaveBeenCalledTimes(6);
    expect(onCycle).toHaveBeenCalledTimes(6);
    expect(onCycle.mock.lastCall?.[0].status).toBe('Completed');
    expect(onCycle.mock.lastCall?.[1]).toBe(h.doc);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.getJob).toHaveBeenCalledTimes(6);
  });

  it('stop() cancels future cycles and ignores in-flight results', async () => {
    const h = harness(['Running']);
    const onCycle = vi.fn();
    const stop = startJobPolling({ ...h, runResourceId: 'r', jobId: 'j', onCycle, visibility: null });
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getJob).toHaveBeenCalledTimes(1);
    expect(onCycle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.getJob).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reports errors and keeps polling; a failed document read yields a null doc', async () => {
    const h = harness(['Running', 'Running', 'Completed']);
    h.getJob.mockRejectedValueOnce(new Error('network'));
    h.readJson.mockRejectedValueOnce(new Error('doc 404'));
    const onCycle = vi.fn();
    const onError = vi.fn();
    startJobPolling({ ...h, runResourceId: 'r', jobId: 'j', onCycle, onError, visibility: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onCycle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onCycle).toHaveBeenCalledTimes(1);
    expect(onCycle.mock.calls[0][1]).toBe(h.doc);
  });

  it('pauses while hidden and resumes immediately with a fresh backoff when visible', async () => {
    const h = harness(['Running']);
    const vis = fakeVisibility();
    const stop = startJobPolling({ ...h, runResourceId: 'r', jobId: 'j', onCycle: vi.fn(), visibility: vis });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.getJob).toHaveBeenCalledTimes(2);
    vis.change(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.getJob).toHaveBeenCalledTimes(2);
    vis.change(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getJob).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.getJob).toHaveBeenCalledTimes(4);
    expect(vis.listeners()).toBe(1);
    stop();
    expect(vis.listeners()).toBe(0);
  });

  it('does not start while hidden; first cycle runs when the tab becomes visible', async () => {
    const h = harness(['Running']);
    const vis = fakeVisibility();
    vis.hidden = true;
    const stop = startJobPolling({ ...h, runResourceId: 'r', jobId: 'j', onCycle: vi.fn(), visibility: vis });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.getJob).not.toHaveBeenCalled();
    vis.change(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getJob).toHaveBeenCalledTimes(1);
    stop();
  });

  it('uses the global document by default and removes its listener on stop', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const h = harness(['Completed']);
    const stop = startJobPolling({ ...h, runResourceId: 'r', jobId: 'j', onCycle: vi.fn() });
    expect(add).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    stop();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
