/**
 * Framework-free job poller. Each cycle reads the job and re-reads the run document (to pick up
 * module-written outputs/progress), then backs off 2s -> 4s -> 8s, capped at 15s. Pauses while the
 * tab is hidden and resumes (with a fresh backoff) on visibilitychange. Stops on a terminal status.
 */
import type { IstariGateway, JobSummary } from '../gateway/types';
import { TERMINAL_JOB_STATUSES } from '../gateway/types';
import type { RunDocument } from './types';

export interface Backoff {
  initialMs: number;
  factor: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: Backoff = { initialMs: 2000, factor: 2, maxMs: 15000 };

export function nextDelay(current: number, backoff: Backoff = DEFAULT_BACKOFF): number {
  return Math.min(current * backoff.factor, backoff.maxMs);
}

export interface JobPollingOptions {
  gateway: Pick<IstariGateway, 'getJob' | 'readJson'>;
  runResourceId: string;
  jobId: string;
  /** Every cycle, including the terminal one. `doc` is null when the document read failed. */
  onCycle: (job: JobSummary, doc: RunDocument | null) => void | Promise<void>;
  /** After onCycle, once the job reaches a terminal status. Polling has already stopped. */
  onTerminal?: (job: JobSummary, doc: RunDocument | null) => void | Promise<void>;
  onError?: (error: unknown) => void;
  backoff?: Partial<Backoff>;
  /** Defaults to the global document; pass null to disable visibility handling. */
  visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
}

/** Start polling; returns a stop function. Safe to call stop() more than once. */
export function startJobPolling(opts: JobPollingOptions): () => void {
  const backoff: Backoff = { ...DEFAULT_BACKOFF, ...opts.backoff };
  const vis =
    opts.visibility === undefined ? (typeof document === 'undefined' ? null : document) : opts.visibility;
  let delay = backoff.initialMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const stop = () => {
    stopped = true;
    clearTimer();
    vis?.removeEventListener('visibilitychange', onVisibility);
  };

  const schedule = () => {
    if (stopped || timer !== null || vis?.hidden) return;
    timer = setTimeout(() => {
      timer = null;
      void cycle();
    }, delay);
    delay = nextDelay(delay, backoff);
  };

  const cycle = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const [jobRes, docRes] = await Promise.allSettled([
        opts.gateway.getJob(opts.jobId),
        opts.gateway.readJson<RunDocument>(opts.runResourceId),
      ]);
      if (stopped) return;
      if (docRes.status === 'rejected') opts.onError?.(docRes.reason);
      if (jobRes.status === 'rejected') throw jobRes.reason;
      const job = jobRes.value;
      const doc = docRes.status === 'fulfilled' ? docRes.value.data : null;
      await opts.onCycle(job, doc);
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        stop();
        await opts.onTerminal?.(job, doc);
        return;
      }
    } catch (error) {
      if (stopped) return;
      opts.onError?.(error);
    } finally {
      inFlight = false;
    }
    schedule();
  };

  function onVisibility() {
    if (stopped) return;
    if (vis?.hidden) {
      clearTimer();
      return;
    }
    delay = backoff.initialMs;
    clearTimer();
    void cycle();
  }

  vis?.addEventListener('visibilitychange', onVisibility);
  if (vis?.hidden) return stop;
  void cycle();
  return stop;
}
