/** Manifest fixtures covering every stage kind and ordering used by the run engine tests. */
import type { LoadedManifest, WorkflowManifest } from '../../manifest/types';

/** job -> review -> display (Smart Diff with a review gate). */
export const threeStageManifest: WorkflowManifest = {
  schema_version: '1',
  key: 'smart-diff',
  name: 'Smart Diff',
  version: '1.0.0',
  stages: [
    {
      key: 'configure',
      name: 'Configure',
      inputs: [
        { key: 'file1', label: 'First document', type: 'resource', required: true },
        { key: 'prompt', label: 'Focus', type: 'text' },
        { key: 'api_key', label: 'API key', type: 'text', secret: true },
        { key: 'llm', label: 'LLM credential', type: 'auth_secret', required: true },
      ],
      function: {
        name: '@istari_utils:smart_diff',
        version: '1.0.2',
        target: 'file1',
        tool_name: 'smart_diff',
        tool_version: '2',
        operating_system: 'linux',
        agent_pool_id: 'pool-1',
        parameters: { prompt: '$inputs.prompt', auth_token: '$inputs.llm.secret_id', mode: 'full', depth: 3 },
      },
      outputs: [
        { key: 'report', label: 'Report', type: 'artifact' },
        { key: 'conflicts', label: 'Conflicts', type: 'json' },
      ],
    },
    {
      key: 'review',
      name: 'Review',
      inputs: [
        {
          key: 'decision',
          label: 'Decision',
          type: 'enum',
          required: true,
          filter: {
            options: [
              { value: 'accept', label: 'Accept' },
              { value: 'reject', label: 'Reject' },
            ],
          },
        },
      ],
    },
    {
      key: 'results',
      name: 'Results',
      view: { type: 'summary', source: '$stages.configure.outputs.report' },
    },
  ],
};

/**
 * display -> review -> display: exercises skipping a leading display stage (reducer tests only; a
 * leading display stage has nothing to bind its view to, so this does not pass validateManifest).
 */
export const displayFirstManifest: WorkflowManifest = {
  schema_version: '1',
  key: 'display-first',
  name: 'Display First',
  version: '0.1.0',
  stages: [
    { key: 'intro', name: 'Intro', view: { type: 'markdown', source: 'Welcome' } },
    { key: 'confirm', name: 'Confirm', inputs: [{ key: 'ok', label: 'OK', type: 'boolean' }] },
    { key: 'done', name: 'Done', view: { type: 'summary', source: '$stages.confirm.inputs.ok' } },
  ],
};

/** job -> job: second job binds to the first stage's inputs and outputs. */
export const jobChainManifest: WorkflowManifest = {
  schema_version: '1',
  key: 'job-chain',
  name: 'Job Chain',
  version: '2.0.0',
  stages: [
    {
      key: 'diff',
      name: 'Diff',
      inputs: [{ key: 'model', label: 'Model', type: 'resource', required: true }],
      function: { name: '@acme:diff', target: 'model' },
      outputs: [{ key: 'conflicts', label: 'Conflicts', type: 'json' }],
    },
    {
      key: 'resolve',
      name: 'Resolve',
      inputs: [{ key: 'model', label: 'Model', type: 'resource', required: true }],
      function: {
        name: '@acme:resolve',
        target: 'model',
        parameters: {
          conflicts: '$stages.diff.outputs.conflicts',
          source: '$stages.diff.inputs.model.resource_id',
        },
      },
    },
  ],
};

/** Job stage whose function name, sources and auth bindings are all resolved from inputs (effects tests). */
export const boundFunctionManifest: WorkflowManifest = {
  schema_version: '1',
  key: 'bound-fn',
  name: 'Bound Function',
  version: '1.0.0',
  stages: [
    {
      key: 'run',
      name: 'Run',
      inputs: [
        { key: 'fn', label: 'Function', type: 'text', required: true },
        { key: 'file1', label: 'First', type: 'resource', required: true },
        { key: 'file2', label: 'Second', type: 'resource', required: true },
        { key: 'llm', label: 'LLM', type: 'auth_secret', required: true },
      ],
      function: {
        name: '$inputs.fn',
        target: 'file1',
        sources: { file2: '$inputs.file2' },
        auth_bindings: { auth_token: '$inputs.llm' },
      },
      outputs: [{ key: 'artifacts', label: 'Artifacts', type: 'artifact' }],
    },
    {
      key: 'results',
      name: 'Results',
      view: { type: 'artifact_list', source: '$stages.run.outputs.artifacts' },
    },
  ],
};

export const file2Value = { resource_id: 'res-file2', revision_id: 'rev-file2', name: 'b.pdf' };

export function loaded(manifest: WorkflowManifest): LoadedManifest {
  return {
    ok: true,
    resourceId: `manifest-${manifest.key}`,
    revisionId: `manifest-${manifest.key}-rev1`,
    fileName: `${manifest.key}.json`,
    manifest,
  };
}

export const fileValue = { resource_id: 'res-file1', revision_id: 'rev-file1', name: 'a.pdf' };
export const secretValue = { secret_id: 'sec-1', name: 'OpenAI' };
