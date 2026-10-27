/**
 * Run document: one JSON resource per run in the workflow-manager-runs system.
 * The SPA owns stage transitions; a module writes only inside stages[<its key>]
 * (outputs and progress). See docs/PRD.md section 5.4.
 */
import type { InputValues } from '../manifest/types';

export type RunStatus =
  | 'in_progress' // collecting input for the current stage
  | 'running_job' // a job stage is executing
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type StageStatus =
  'pending' | 'collecting' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProgressEntry {
  at: string; // ISO timestamp
  message: string;
  percent?: number;
}

export interface StageRecord {
  key: string;
  status: StageStatus;
  inputs?: InputValues;
  job_id?: string;
  /** Written by the module for job stages; declared by manifest outputs. */
  outputs?: Record<string, unknown>;
  progress?: ProgressEntry[];
  error?: string;
  started?: string;
  finished?: string;
}

export interface RunDocument {
  schema_version: '1';
  run_id: string;
  workflow_key: string;
  workflow_version: string;
  workflow_name: string;
  manifest_resource_id: string;
  manifest_revision_id: string;
  initiator_user_id: string;
  status: RunStatus;
  /** Stage key currently active; null once terminal. */
  current_stage: string | null;
  /** Ordered stage keys, copied from the manifest at run creation. */
  stage_order: string[];
  stages: Record<string, StageRecord>;
  created: string;
  updated: string;
  /** Set when the run reaches a terminal status. */
  finished?: string;
  /** Run-level failure or cancellation reason. */
  error?: string;
  result_summary?: string;
}

/** Where a run document lives in Istari. */
export interface RunLocation {
  resourceId: string;
  revisionId: string;
}
