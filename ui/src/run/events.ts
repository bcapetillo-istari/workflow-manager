/**
 * Events the run reducer understands. Timestamps (`at`) are supplied by the caller so the
 * reducer stays pure; ModuleUpdateObserved carries none because the SPA did not transition.
 */
import type { JobStatus } from '../gateway/types';
import type { InputValues } from '../manifest/types';
import type { ProgressEntry } from './types';

export interface StageInputsSubmitted {
  type: 'StageInputsSubmitted';
  stageKey: string;
  inputs: InputValues;
  at: string;
}

export interface JobCreated {
  type: 'JobCreated';
  stageKey: string;
  jobId: string;
  at: string;
}

export interface JobStatusObserved {
  type: 'JobStatusObserved';
  stageKey: string;
  status: JobStatus;
  message?: string;
  at: string;
}

/** Module-owned fields read back from the run document for the running job stage. */
export interface ModuleUpdateObserved {
  type: 'ModuleUpdateObserved';
  stageKey: string;
  outputs?: Record<string, unknown>;
  progress?: ProgressEntry[];
}

export interface Advance {
  type: 'Advance';
  at: string;
}

export interface Cancel {
  type: 'Cancel';
  at: string;
}

export interface Fail {
  type: 'Fail';
  /** Defaults to the current stage. */
  stageKey?: string;
  error: string;
  at: string;
}

export type RunEvent =
  StageInputsSubmitted | JobCreated | JobStatusObserved | ModuleUpdateObserved | Advance | Cancel | Fail;
