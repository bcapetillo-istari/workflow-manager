/**
 * Seed manifests for the MockGateway. `smartDiffManifest` mirrors
 * docs/examples/smart_diff_workflow_manifest.json (inlined: resolveJsonModule is not enabled and the
 * file lives outside src/). `docReviewManifest` exercises a review gate with stage_output.
 */
import type { WorkflowManifest } from '../../manifest/types';

export const smartDiffManifest: WorkflowManifest = {
  schema_version: '1',
  key: 'smart-diff',
  name: 'Smart Diff',
  description:
    'LLM-assisted comparison of two documents. Surfaces matches, conflicts, and missing items with a ' +
    'traceable HTML report.',
  version: '1.1.0',
  tags: ['documents', 'llm', 'icd'],
  icon: 'git-compare',
  stages: [
    {
      key: 'configure',
      name: 'Select documents and model',
      description:
        'Pick the two documents to compare, the credential to use, and the model. The report is attached ' +
        'to the first document.',
      inputs: [
        {
          key: 'file1',
          label: 'First document',
          type: 'resource',
          required: true,
          help: 'The report will be attached to this document as an artifact.',
          filter: { extensions: ['pdf', 'docx', 'xlsx', 'txt'] },
        },
        {
          key: 'file2',
          label: 'Second document',
          type: 'resource',
          required: true,
          filter: { extensions: ['pdf', 'docx', 'xlsx', 'txt'] },
        },
        {
          key: 'llm_credential',
          label: 'LLM credential',
          type: 'auth_secret',
          required: true,
          help:
            'One of your linked accounts. The model list below follows the credential you choose.',
          filter: { secret_type: '@token:llm' },
        },
        {
          key: 'model',
          label: 'Model',
          type: 'enum',
          required: true,
          filter: {
            options_by: {
              source: '$inputs.llm_credential.name',
              match: 'contains',
              groups: {
                openai: [
                  { value: 'gpt-4o', label: 'OpenAI / GPT-4o' },
                  { value: 'gpt-4o-mini', label: 'OpenAI / GPT-4o mini' },
                  { value: 'gpt-4.1', label: 'OpenAI / GPT-4.1' },
                  { value: 'o3', label: 'OpenAI / o3' },
                ],
                anthropic: [
                  { value: 'claude-opus-5', label: 'Anthropic / Claude Opus 5' },
                  { value: 'claude-sonnet-5', label: 'Anthropic / Claude Sonnet 5' },
                  { value: 'claude-haiku-4-5', label: 'Anthropic / Claude Haiku 4.5' },
                ],
                gemini: [
                  { value: 'gemini-2.5-pro', label: 'Google / Gemini 2.5 Pro' },
                  { value: 'gemini-2.5-flash', label: 'Google / Gemini 2.5 Flash' },
                ],
              },
            },
          },
        },
        {
          key: 'prompt',
          label: 'Focus',
          type: 'text',
          required: false,
          help: 'Optional. Tell the model what matters most, for example signal timing or voltage tolerances.',
          filter: { multiline: true, max_length: 2000 },
        },
      ],
      function: {
        name: '@istari_utils:smart_diff',
        version: '1.0.2',
        target: 'file1',
        parameters: {
          file1_revision_id: '$inputs.file1.revision_id',
          file2_resource_id: '$inputs.file2.resource_id',
          file2_revision_id: '$inputs.file2.revision_id',
          auth_token: '$inputs.llm_credential.secret_id',
          model: '$inputs.model',
          prompt: '$inputs.prompt',
        },
      },
      outputs: [
        { key: 'report', label: 'Diff report (HTML)', type: 'artifact' },
        { key: 'prompt_audit', label: 'Prompt and model audit trail', type: 'artifact' },
        { key: 'summary', label: 'Summary', type: 'json' },
      ],
    },
    {
      key: 'results',
      name: 'Results',
      view: { type: 'summary', source: '$stages.configure.outputs' },
    },
  ],
};

export const docReviewManifest: WorkflowManifest = {
  schema_version: '1',
  key: 'doc-review',
  name: 'Diff, review, resolve',
  description: 'Compare two documents, choose which conflicts to resolve, and write a resolved revision.',
  version: '0.3.0',
  tags: ['documents', 'review'],
  stages: [
    {
      key: 'diff',
      name: 'Select documents',
      inputs: [
        { key: 'system', label: 'System', type: 'system', required: true },
        {
          key: 'branch',
          label: 'Branch',
          type: 'branch',
          required: true,
          filter: { system: '$inputs.system' },
        },
        {
          key: 'file1',
          label: 'First document',
          type: 'resource',
          required: true,
          filter: { extensions: ['pdf', 'docx'], system: '$inputs.system' },
        },
        {
          key: 'file2',
          label: 'Second document',
          type: 'resource',
          required: true,
          filter: { extensions: ['pdf', 'docx'], system: '$inputs.system' },
        },
        {
          key: 'llm',
          label: 'LLM credential',
          type: 'auth_secret',
          required: true,
          filter: { secret_type: '@token:llm' },
        },
        {
          key: 'strict',
          label: 'Strict mode',
          type: 'boolean',
          default: false,
          help: 'Flag minor wording changes.',
        },
        {
          key: 'threshold',
          label: 'Similarity threshold',
          type: 'number',
          default: 0.8,
          filter: { min: 0, max: 1, step: 0.05 },
        },
      ],
      function: {
        name: '@istari_utils:smart_diff',
        target: 'file1',
        parameters: {
          file2_resource_id: '$inputs.file2.resource_id',
          auth_token: '$inputs.llm.secret_id',
          strict: '$inputs.strict',
          threshold: '$inputs.threshold',
        },
      },
      outputs: [
        { key: 'report', label: 'Diff report', type: 'artifact' },
        { key: 'conflicts', label: 'Conflicts', type: 'json' },
      ],
    },
    {
      key: 'review',
      name: 'Choose conflicts to resolve',
      description: 'Pick the conflicts to resolve and how to resolve them.',
      inputs: [
        {
          key: 'conflicts',
          label: 'Conflicts',
          type: 'stage_output',
          required: true,
          filter: { source: '$stages.diff.outputs.conflicts', multiple: true },
        },
        {
          key: 'strategy',
          label: 'Resolution strategy',
          type: 'enum',
          required: true,
          filter: {
            options: [
              { value: 'prefer_a', label: 'Prefer first document' },
              { value: 'prefer_b', label: 'Prefer second document' },
              { value: 'llm', label: 'Let the LLM propose' },
            ],
          },
        },
        {
          key: 'notify',
          label: 'Notify',
          type: 'multi_enum',
          filter: {
            options: [
              { value: 'owner', label: 'Document owner' },
              { value: 'reviewers', label: 'Reviewers' },
              { value: 'me', label: 'Me' },
            ],
            max: 2,
          },
        },
      ],
      view: { type: 'json_table', source: '$stages.diff.outputs.conflicts' },
    },
    {
      key: 'resolve',
      name: 'Resolve',
      inputs: [{ key: 'target_doc', label: 'Document to update', type: 'resource', required: true }],
      function: {
        name: '@istari_utils:resolve_conflicts',
        target: 'target_doc',
        parameters: {
          report_artifact_id: '$stages.diff.outputs.report.resource_id',
          conflicts: '$stages.review.inputs.conflicts',
          strategy: '$stages.review.inputs.strategy',
        },
      },
      outputs: [{ key: 'resolved', label: 'Resolved document', type: 'revision' }],
    },
    {
      key: 'results',
      name: 'Results',
      view: { type: 'artifact_list', source: '$stages.resolve.outputs' },
    },
  ],
};

/** Deliberately invalid: no stages, bad input type. */
export const brokenManifest = {
  schema_version: '1',
  key: 'broken-workflow',
  name: 'Broken workflow',
  version: '0.0.1',
  stages: [{ key: 'one', name: 'One', inputs: [{ key: 'x', label: 'X', type: 'colour' }] }],
};
