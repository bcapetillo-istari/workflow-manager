/**
 * Thin effect layer around the reducer: creates jobs, writes run revisions, cancels jobs.
 * No React. Every function takes the gateway explicitly so it is testable with a fake.
 * All document writes go through writeRun so optimistic concurrency can be added in one place.
 */
import type { AppConfig } from '../config';
import type {
  CreateJobRequest,
  IstariGateway,
  JobAuthBinding,
  JobSource,
  JobSummary,
} from '../gateway/types';
import { TERMINAL_JOB_STATUSES } from '../gateway/types';
import type {
  InputValues,
  LoadedManifest,
  ManifestFunction,
  ManifestStage,
  WorkflowManifest,
} from '../manifest/types';
import { stageKind } from '../manifest/types';
import { isBinding, resolveBinding, resolveParameters, type BindingContext } from './external';
import { createRunDocument, currentStage, findStage, reduceRun } from './reducer';
import type { RunDocument } from './types';

export interface EffectDeps {
  gateway: IstariGateway;
}

export type RunsConfig = Pick<AppConfig, 'workflowManagerRunsSystemId'>;

export function writeRun(
  gateway: IstariGateway,
  resourceId: string,
  doc: RunDocument,
): Promise<{ revisionId: string }> {
  return gateway.createJsonRevision(resourceId, doc, {
    description: `${doc.workflow_name} run: ${doc.status}`,
  });
}

export async function createRun(
  deps: EffectDeps,
  config: RunsConfig,
  entry: LoadedManifest,
  userId: string,
  now: string,
): Promise<{ resourceId: string; revisionId: string; doc: RunDocument }> {
  const doc = createRunDocument(entry, userId, now);
  const { resourceId, revisionId } = await deps.gateway.createJsonResource({
    systemId: config.workflowManagerRunsSystemId,
    name: `${doc.run_id}.json`,
    data: doc,
    description: `${doc.workflow_name} run`,
  });
  return { resourceId, revisionId, doc };
}

/** Record inputs for the current stage; for a job stage also create the job. Does not write. */
export async function submitStage(
  deps: EffectDeps,
  manifest: WorkflowManifest,
  doc: RunDocument,
  stageKey: string,
  inputs: InputValues,
  now: string,
): Promise<RunDocument> {
  const stage = findStage(manifest, stageKey);
  if (!stage) throw new Error(`Stage "${stageKey}" is not in the manifest`);
  if (doc.current_stage !== stageKey || doc.stages[stageKey]?.status !== 'collecting') {
    throw new Error(`Stage "${stageKey}" is not collecting inputs`);
  }
  const submitted = reduceRun(doc, manifest, { type: 'StageInputsSubmitted', stageKey, inputs, at: now });
  if (stageKind(stage) !== 'job' || !stage.function) return submitted;
  const job = await deps.gateway.createJob(buildJobRequest(stage, stage.function, inputs, doc));
  return reduceRun(submitted, manifest, { type: 'JobCreated', stageKey, jobId: job.jobId, at: now });
}

export function buildJobRequest(
  stage: ManifestStage,
  fn: ManifestFunction,
  inputs: InputValues,
  doc: RunDocument,
): CreateJobRequest {
  const target = inputs[fn.target];
  const resourceId = isResourceValue(target) ? target.resource_id : null;
  if (!resourceId) throw new Error(`Stage "${stage.key}": target input "${fn.target}" is not a resource`);
  const ctx: BindingContext = { inputs, stages: completedStages(doc) };
  const where = `Stage "${stage.key}"`;
  return {
    resourceId,
    functionName: resolveFunctionName(fn.name, ctx, where),
    functionVersion: fn.version,
    parameters: resolveParameters(fn.parameters, ctx),
    toolName: fn.tool_name,
    toolVersion: fn.tool_version,
    operatingSystem: fn.operating_system,
    agentPoolId: fn.agent_pool_id,
    ...(fn.sources ? { sources: resolveSources(fn.sources, ctx, where) } : {}),
    ...(fn.auth_bindings ? { authBindings: resolveAuthBindings(fn.auth_bindings, ctx, where) } : {}),
  };
}

function resolveFunctionName(name: string, ctx: BindingContext, where: string): string {
  if (!isBinding(name)) return name;
  const resolved = resolveBinding(name, ctx);
  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error(`${where}: function name binding "${name}" did not resolve to a non-empty string`);
  }
  return resolved;
}

function resolveSources(sources: Record<string, string>, ctx: BindingContext, where: string): JobSource[] {
  return Object.entries(sources).map(([inputKey, binding]) => {
    const value = resolveBinding(binding, ctx);
    if (!hasStringField(value, 'revision_id')) {
      throw new Error(`${where}: source "${inputKey}" binding "${binding}" did not resolve to a revision`);
    }
    return { revisionId: value.revision_id, relationshipIdentifier: inputKey };
  });
}

function resolveAuthBindings(
  bindings: Record<string, string>,
  ctx: BindingContext,
  where: string,
): JobAuthBinding[] {
  return Object.entries(bindings).map(([inputName, binding]) => {
    const value = resolveBinding(binding, ctx);
    if (!hasStringField(value, 'secret_id')) {
      throw new Error(
        `${where}: auth binding "${inputName}" binding "${binding}" did not resolve to a secret`,
      );
    }
    return { inputName, credentialId: value.secret_id };
  });
}

function hasStringField<K extends string>(v: unknown, field: K): v is Record<K, string> {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)[field] === 'string';
}

function completedStages(doc: RunDocument): BindingContext['stages'] {
  const out: BindingContext['stages'] = {};
  for (const s of Object.values(doc.stages)) {
    if (s.status === 'succeeded') out[s.key] = { inputs: s.inputs, outputs: s.outputs };
  }
  return out;
}

function isResourceValue(v: unknown): v is { resource_id: string } {
  return (
    typeof v === 'object' && v !== null && typeof (v as { resource_id?: unknown }).resource_id === 'string'
  );
}

/** Cancel the in-flight job (errors ignored) and mark the run cancelled. Does not write. */
export async function cancelRun(
  deps: EffectDeps,
  manifest: WorkflowManifest,
  doc: RunDocument,
  now: string,
): Promise<RunDocument> {
  const stage = doc.current_stage ? doc.stages[doc.current_stage] : undefined;
  if (stage?.status === 'running' && stage.job_id) {
    try {
      await deps.gateway.cancelJob(stage.job_id);
    } catch {
      // The run is cancelled regardless; the job may already be terminal.
    }
  }
  return reduceRun(doc, manifest, { type: 'Cancel', at: now });
}

export interface JobObservation {
  stageKey: string;
  job: JobSummary;
  /** Latest run document as read from Istari; module-owned fields are merged from it. */
  latest: RunDocument | null;
  at: string;
}

/** Fold one poll cycle into the document: module outputs/progress first, then job status. */
export function observeJob(
  manifest: WorkflowManifest,
  doc: RunDocument,
  obs: JobObservation,
): { doc: RunDocument; terminal: boolean } {
  let next = doc;
  const remote = obs.latest?.stages[obs.stageKey];
  if (remote && (remote.outputs !== undefined || remote.progress !== undefined)) {
    const { outputs, progress } = remote;
    next = reduceRun(next, manifest, {
      type: 'ModuleUpdateObserved',
      stageKey: obs.stageKey,
      outputs,
      progress,
    });
  }
  next = reduceRun(next, manifest, {
    type: 'JobStatusObserved',
    stageKey: obs.stageKey,
    status: obs.job.status,
    message: obs.job.statusMessage,
    at: obs.at,
  });
  return { doc: next, terminal: TERMINAL_JOB_STATUSES.has(obs.job.status) };
}

export interface ArtifactRef {
  resource_id: string;
  revision_id: string;
  name: string;
}

/**
 * Fallback for modules that do not write run documents: for each declared `artifact` output the module
 * left unset, list artifacts on the stage's target resource created since the stage started. Returns the
 * outputs to add, or null when nothing is missing or the listing failed (logged, not thrown).
 */
export async function artifactFallbackOutputs(
  deps: EffectDeps,
  manifest: WorkflowManifest,
  doc: RunDocument,
  stageKey: string,
  latest: RunDocument | null,
): Promise<Record<string, ArtifactRef[]> | null> {
  const stage = findStage(manifest, stageKey);
  const record = latest?.stages[stageKey] ?? doc.stages[stageKey];
  if (!stage?.function || !record) return null;
  const existing = { ...doc.stages[stageKey]?.outputs, ...record.outputs };
  const missing = (stage.outputs ?? []).filter((o) => o.type === 'artifact' && existing[o.key] === undefined);
  if (missing.length === 0) return null;
  const target = record.inputs?.[stage.function.target];
  if (!isResourceValue(target)) return null;
  try {
    const artifacts = await deps.gateway.listArtifacts(target.resource_id);
    const since = record.started;
    const refs: ArtifactRef[] = artifacts
      .filter((a) => since === undefined || a.created >= since)
      .map((a) => ({ resource_id: a.resourceId, revision_id: a.revisionId, name: a.name }));
    return Object.fromEntries(missing.map((o) => [o.key, refs]));
  } catch (error) {
    console.warn(`Run ${doc.run_id}: could not list artifacts for stage "${stageKey}"`, error);
    return null;
  }
}

/** observeJob plus, on Completed, the artifact fallback merged into the module-owned outputs. */
export async function observeJobWithArtifacts(
  deps: EffectDeps,
  manifest: WorkflowManifest,
  doc: RunDocument,
  obs: JobObservation,
): Promise<{ doc: RunDocument; terminal: boolean }> {
  if (obs.job.status !== 'Completed') return observeJob(manifest, doc, obs);
  const fallback = await artifactFallbackOutputs(deps, manifest, doc, obs.stageKey, obs.latest);
  if (!fallback) return observeJob(manifest, doc, obs);
  const base = obs.latest ?? doc;
  const stage = base.stages[obs.stageKey];
  const latest: RunDocument = {
    ...base,
    stages: { ...base.stages, [obs.stageKey]: { ...stage, outputs: { ...stage.outputs, ...fallback } } },
  };
  return observeJob(manifest, doc, { ...obs, latest });
}

/** The job stage to poll, if the run is currently executing one. */
export function runningJob(
  doc: RunDocument,
  manifest: WorkflowManifest,
): { stageKey: string; jobId: string } | null {
  const stage = currentStage(doc, manifest);
  const record = stage ? doc.stages[stage.key] : undefined;
  if (!stage || !record || record.status !== 'running' || !record.job_id) return null;
  return { stageKey: stage.key, jobId: record.job_id };
}
