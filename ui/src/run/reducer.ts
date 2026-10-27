/**
 * Pure run state machine: (RunDocument, manifest, RunEvent) -> RunDocument.
 * No clocks, no I/O. Unknown or out-of-order events return the document unchanged, which
 * makes repeated observations idempotent. See docs/PRD.md section 5.4.
 */
import type { InputValues, LoadedManifest, ManifestStage, WorkflowManifest } from '../manifest/types';
import { stageKind } from '../manifest/types';
import type {
  RunEvent,
  StageInputsSubmitted,
  JobCreated,
  JobStatusObserved,
  ModuleUpdateObserved,
} from './events';
import type { Cancel, Fail } from './events';
import type { RunDocument, RunStatus, StageRecord } from './types';

export const SECRET_PLACEHOLDER = '[secret]';

const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set<RunStatus>(['succeeded', 'failed', 'cancelled']);

export function isRunTerminal(doc: RunDocument): boolean {
  return TERMINAL_RUN.has(doc.status);
}

export function findStage(manifest: WorkflowManifest, key: string | null): ManifestStage | null {
  return manifest.stages.find((s) => s.key === key) ?? null;
}

export function currentStage(doc: RunDocument, manifest: WorkflowManifest): ManifestStage | null {
  return findStage(manifest, doc.current_stage);
}

export function nextStageKey(doc: RunDocument): string | null {
  if (doc.current_stage === null) return null;
  const idx = doc.stage_order.indexOf(doc.current_stage);
  return idx < 0 ? null : (doc.stage_order[idx + 1] ?? null);
}

export function createRunDocument(entry: LoadedManifest, initiatorUserId: string, now: string): RunDocument {
  const m = entry.manifest;
  const stage_order = m.stages.map((s) => s.key);
  const stages: Record<string, StageRecord> = {};
  for (const key of stage_order) stages[key] = { key, status: 'pending' };
  const doc: RunDocument = {
    schema_version: '1',
    run_id: crypto.randomUUID(),
    workflow_key: m.key,
    workflow_version: m.version,
    workflow_name: m.name,
    manifest_resource_id: entry.resourceId,
    manifest_revision_id: entry.revisionId,
    initiator_user_id: initiatorUserId,
    status: 'in_progress',
    current_stage: null,
    stage_order,
    stages,
    created: now,
    updated: now,
  };
  return enterStage(doc, m, stage_order[0] ?? null, now);
}

export function reduceRun(doc: RunDocument, manifest: WorkflowManifest, event: RunEvent): RunDocument {
  if (isRunTerminal(doc)) return doc;
  switch (event.type) {
    case 'StageInputsSubmitted':
      return onInputsSubmitted(doc, manifest, event);
    case 'JobCreated':
      return onJobCreated(doc, event);
    case 'JobStatusObserved':
      return onJobStatusObserved(doc, manifest, event);
    case 'ModuleUpdateObserved':
      return onModuleUpdate(doc, event);
    case 'Advance':
      return doc.stages[doc.current_stage ?? '']?.status === 'succeeded'
        ? advance(doc, manifest, event.at)
        : doc;
    case 'Cancel':
      return onCancel(doc, event);
    case 'Fail':
      return onFail(doc, event);
  }
}

/* ---------- transitions ---------- */

function onInputsSubmitted(
  doc: RunDocument,
  manifest: WorkflowManifest,
  e: StageInputsSubmitted,
): RunDocument {
  const stage = findStage(manifest, e.stageKey);
  if (!stage || doc.current_stage !== e.stageKey || doc.stages[e.stageKey]?.status !== 'collecting')
    return doc;
  const inputs = redactSecrets(stage, e.inputs);
  if (stageKind(stage) === 'job') return patchStage(doc, e.stageKey, { status: 'submitted', inputs }, e.at);
  const done = patchStage(
    doc,
    e.stageKey,
    { status: 'succeeded', inputs, started: e.at, finished: e.at },
    e.at,
  );
  return advance(done, manifest, e.at);
}

function onJobCreated(doc: RunDocument, e: JobCreated): RunDocument {
  const stage = doc.stages[e.stageKey];
  if (!stage || stage.job_id === e.jobId || stage.status !== 'submitted') return doc;
  const next = patchStage(doc, e.stageKey, { status: 'running', job_id: e.jobId, started: e.at }, e.at);
  return { ...next, status: 'running_job' };
}

function onJobStatusObserved(
  doc: RunDocument,
  manifest: WorkflowManifest,
  e: JobStatusObserved,
): RunDocument {
  if (doc.stages[e.stageKey]?.status !== 'running') return doc;
  switch (e.status) {
    case 'Completed':
      return advance(
        patchStage(doc, e.stageKey, { status: 'succeeded', finished: e.at }, e.at),
        manifest,
        e.at,
      );
    case 'Failed':
      return finishRun(doc, 'failed', e.stageKey, { error: e.message ?? 'Job failed' }, e.at);
    case 'Canceled':
      return finishRun(doc, 'cancelled', e.stageKey, { error: e.message }, e.at);
    default:
      return doc;
  }
}

function onModuleUpdate(doc: RunDocument, e: ModuleUpdateObserved): RunDocument {
  const stage = doc.stages[e.stageKey];
  if (!stage || stage.job_id === undefined) return doc;
  const patch: Partial<StageRecord> = {};
  if (e.outputs !== undefined && !sameJson(stage.outputs, e.outputs)) patch.outputs = e.outputs;
  if (e.progress !== undefined && !sameJson(stage.progress, e.progress)) patch.progress = e.progress;
  if (Object.keys(patch).length === 0) return doc;
  return { ...doc, stages: { ...doc.stages, [e.stageKey]: { ...stage, ...patch } } };
}

function onCancel(doc: RunDocument, e: Cancel): RunDocument {
  return finishRun(doc, 'cancelled', doc.current_stage, {}, e.at);
}

function onFail(doc: RunDocument, e: Fail): RunDocument {
  return finishRun(doc, 'failed', e.stageKey ?? doc.current_stage, { error: e.error }, e.at);
}

/* ---------- helpers ---------- */

/** Make `key` the current stage: collecting for job/review, succeeded-and-skip for display. */
function enterStage(
  doc: RunDocument,
  manifest: WorkflowManifest,
  key: string | null,
  at: string,
): RunDocument {
  if (key === null) return { ...doc, status: 'succeeded', current_stage: null, updated: at, finished: at };
  const stage = findStage(manifest, key);
  const entered: RunDocument = { ...doc, status: 'in_progress', current_stage: key, updated: at };
  if (!stage)
    return finishRun(entered, 'failed', key, { error: `Stage "${key}" is not in the manifest` }, at);
  if (stageKind(stage) !== 'display') return patchStage(entered, key, { status: 'collecting' }, at);
  const shown = patchStage(entered, key, { status: 'succeeded', started: at, finished: at }, at);
  return advance(shown, manifest, at);
}

function advance(doc: RunDocument, manifest: WorkflowManifest, at: string): RunDocument {
  return enterStage(doc, manifest, nextStageKey(doc), at);
}

function finishRun(
  doc: RunDocument,
  status: 'failed' | 'cancelled',
  stageKey: string | null,
  extra: { error?: string },
  at: string,
): RunDocument {
  const error = extra.error ?? (status === 'failed' ? 'Run failed' : 'Run cancelled');
  let next = doc;
  const stage = stageKey ? doc.stages[stageKey] : undefined;
  if (stageKey && stage && stage.status !== 'succeeded') {
    const stageStatus = status === 'failed' ? 'failed' : 'cancelled';
    next = patchStage(doc, stageKey, { status: stageStatus, finished: at, error }, at);
  }
  const where = stageKey ? ` at "${stageKey}"` : '';
  const result_summary = `${status === 'failed' ? 'Failed' : 'Cancelled'}${where}: ${error}`;
  return { ...next, status, current_stage: null, updated: at, finished: at, error, result_summary };
}

function patchStage(doc: RunDocument, key: string, patch: Partial<StageRecord>, at: string): RunDocument {
  const stage = doc.stages[key] ?? { key, status: 'pending' };
  return { ...doc, updated: at, stages: { ...doc.stages, [key]: { ...stage, ...patch } } };
}

export function redactSecrets(stage: ManifestStage, inputs: InputValues): InputValues {
  const out: InputValues = { ...inputs };
  for (const input of stage.inputs ?? []) {
    if (input.secret && input.key in out) out[input.key] = SECRET_PLACEHOLDER;
  }
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
