import { describe, expect, it } from 'vitest';
import {
  bindingReferences,
  isBinding,
  parseBinding,
  resolveBinding,
  resolveParameters,
  type BindingContext,
} from './bindings';
import type { WorkflowManifest } from './types';
import smartDiff from '../../../docs/examples/smart_diff_workflow_manifest.json';
import reviewGate from '../../../docs/examples/review_gate_workflow_manifest.json';

const ctx: BindingContext = {
  inputs: {
    file1: { resource_id: 'r1', revision_id: 'v1', name: 'a.pdf' },
    prompt: 'focus on timing',
    count: 3,
    flag: false,
  },
  stages: {
    diff: {
      inputs: { llm: { secret_id: 's1', name: 'OpenAI', provider: 'openai' } },
      outputs: { report: 'art-1', summary: { matches: 4, nested: { deep: 'yes' } } },
    },
    review: { inputs: { strategy: 'llm' } },
  },
};

describe('isBinding', () => {
  it('accepts the two binding roots', () => {
    expect(isBinding('$inputs.file1')).toBe(true);
    expect(isBinding('$stages.diff.outputs.report')).toBe(true);
  });

  it('rejects literals and non-strings', () => {
    expect(isBinding('hello')).toBe(false);
    expect(isBinding('$inputs')).toBe(false);
    expect(isBinding('$other.x')).toBe(false);
    expect(isBinding('inputs.file1')).toBe(false);
    expect(isBinding(42)).toBe(false);
    expect(isBinding(true)).toBe(false);
    expect(isBinding(null)).toBe(false);
    expect(isBinding(undefined)).toBe(false);
  });
});

describe('parseBinding', () => {
  it('parses $inputs.<key>', () => {
    expect(parseBinding('$inputs.file1')).toEqual({ kind: 'inputs', key: 'file1', path: [] });
  });

  it('parses $inputs.<key>.<field>... with nested fields', () => {
    expect(parseBinding('$inputs.file1.resource_id')).toEqual({
      kind: 'inputs',
      key: 'file1',
      path: ['resource_id'],
    });
    expect(parseBinding('$inputs.x.a.b.c')).toEqual({ kind: 'inputs', key: 'x', path: ['a', 'b', 'c'] });
  });

  it('parses $stages.<stage>.inputs.<key>', () => {
    expect(parseBinding('$stages.review.inputs.strategy')).toEqual({
      kind: 'stages',
      stage: 'review',
      section: 'inputs',
      key: 'strategy',
      path: [],
    });
  });

  it('parses $stages.<stage>.outputs.<key>.<field>...', () => {
    expect(parseBinding('$stages.diff.outputs.summary.nested.deep')).toEqual({
      kind: 'stages',
      stage: 'diff',
      section: 'outputs',
      key: 'summary',
      path: ['nested', 'deep'],
    });
  });

  it('parses a whole-section reference with an empty key', () => {
    expect(parseBinding('$stages.diff.outputs')).toEqual({
      kind: 'stages',
      stage: 'diff',
      section: 'outputs',
      key: '',
      path: [],
    });
  });

  it('returns null for literals and malformed bindings', () => {
    expect(parseBinding('literal')).toBeNull();
    expect(parseBinding('$inputs')).toBeNull();
    expect(parseBinding('$inputs.')).toBeNull();
    expect(parseBinding('$inputs..x')).toBeNull();
    expect(parseBinding('$inputs.x.')).toBeNull();
    expect(parseBinding('$stages.diff')).toBeNull();
    expect(parseBinding('$stages.diff.params.x')).toBeNull();
    expect(parseBinding('$stages..outputs.x')).toBeNull();
  });
});

describe('resolveBinding', () => {
  it('passes literals through unchanged', () => {
    expect(resolveBinding('plain text', ctx)).toBe('plain text');
    expect(resolveBinding(7, ctx)).toBe(7);
    expect(resolveBinding(false, ctx)).toBe(false);
    expect(resolveBinding('', ctx)).toBe('');
  });

  it('resolves current-stage inputs and their fields', () => {
    expect(resolveBinding('$inputs.prompt', ctx)).toBe('focus on timing');
    expect(resolveBinding('$inputs.count', ctx)).toBe(3);
    expect(resolveBinding('$inputs.flag', ctx)).toBe(false);
    expect(resolveBinding('$inputs.file1', ctx)).toEqual({
      resource_id: 'r1',
      revision_id: 'v1',
      name: 'a.pdf',
    });
    expect(resolveBinding('$inputs.file1.resource_id', ctx)).toBe('r1');
  });

  it('resolves earlier-stage inputs and outputs, including nested fields', () => {
    expect(resolveBinding('$stages.diff.inputs.llm.secret_id', ctx)).toBe('s1');
    expect(resolveBinding('$stages.review.inputs.strategy', ctx)).toBe('llm');
    expect(resolveBinding('$stages.diff.outputs.report', ctx)).toBe('art-1');
    expect(resolveBinding('$stages.diff.outputs.summary.matches', ctx)).toBe(4);
    expect(resolveBinding('$stages.diff.outputs.summary.nested.deep', ctx)).toBe('yes');
  });

  it('resolves a whole outputs section', () => {
    expect(resolveBinding('$stages.diff.outputs', ctx)).toEqual(ctx.stages.diff.outputs);
    expect(resolveBinding('$stages.review.inputs', ctx)).toEqual({ strategy: 'llm' });
  });

  it('yields undefined for anything that does not resolve', () => {
    expect(resolveBinding('$inputs.missing', ctx)).toBeUndefined();
    expect(resolveBinding('$inputs.prompt.length', ctx)).toBeUndefined();
    expect(resolveBinding('$inputs.file1.nope', ctx)).toBeUndefined();
    expect(resolveBinding('$stages.nope.outputs.report', ctx)).toBeUndefined();
    expect(resolveBinding('$stages.review.outputs.report', ctx)).toBeUndefined();
    expect(resolveBinding('$stages.diff.outputs.missing', ctx)).toBeUndefined();
    expect(resolveBinding('$stages.diff.outputs.report.field', ctx)).toBeUndefined();
    expect(resolveBinding('$stages.diff.params.x', ctx)).toBeUndefined();
    expect(resolveBinding('$inputs.', ctx)).toBeUndefined();
  });
});

describe('resolveParameters', () => {
  it('resolves bindings, keeps literals, and omits unresolved keys', () => {
    expect(
      resolveParameters(
        {
          resource: '$inputs.file1.resource_id',
          prompt: '$inputs.prompt',
          token: '$stages.diff.inputs.llm.secret_id',
          report: '$stages.diff.outputs.report',
          missing: '$inputs.nothing',
          literal: 'as-is',
          count: 2,
          enabled: true,
        },
        ctx,
      ),
    ).toEqual({
      resource: 'r1',
      prompt: 'focus on timing',
      token: 's1',
      report: 'art-1',
      literal: 'as-is',
      count: 2,
      enabled: true,
    });
  });

  it('returns an empty object for undefined or empty parameters', () => {
    expect(resolveParameters(undefined, ctx)).toEqual({});
    expect(resolveParameters({}, ctx)).toEqual({});
  });
});

describe('bindingReferences', () => {
  it('lists every binding in the Smart Diff manifest with its path', () => {
    const refs = bindingReferences(smartDiff as WorkflowManifest);
    expect(refs).toEqual([
      { location: 'stages[0].inputs[3].filter.options_by.source', expr: '$inputs.llm_credential.name' },
      { location: 'stages[0].function.name', expr: '$inputs.model' },
      { location: 'stages[0].function.parameters.prompt', expr: '$inputs.prompt' },
      { location: 'stages[0].function.sources.file2', expr: '$inputs.file2' },
      { location: 'stages[0].function.auth_bindings.auth_token', expr: '$inputs.llm_credential' },
      { location: 'stages[1].view.source', expr: '$stages.configure.outputs.artifacts' },
    ]);
  });

  it('includes filter.source and filter.system, and skips literal parameters', () => {
    const refs = bindingReferences(reviewGate as WorkflowManifest);
    const locations = refs.map((ref) => ref.location);
    expect(locations).toContain('stages[1].inputs[0].filter.source');
    expect(locations).toContain('stages[2].function.parameters.report_artifact_id');
    expect(locations).not.toContain('stages[0].function.parameters.emit_conflicts');
    expect(refs.find((ref) => ref.location === 'stages[1].inputs[0].filter.source')?.expr).toBe(
      '$stages.diff.outputs.conflicts',
    );

    const manifest: WorkflowManifest = {
      schema_version: '1',
      key: 'k',
      name: 'K',
      version: '1.0.0',
      stages: [
        {
          key: 's',
          name: 'S',
          inputs: [
            { key: 'sys', label: 'System', type: 'system' },
            { key: 'branch', label: 'Branch', type: 'branch', filter: { system: '$inputs.sys' } },
          ],
        },
      ],
    };
    expect(bindingReferences(manifest)).toEqual([
      { location: 'stages[0].inputs[1].filter.system', expr: '$inputs.sys' },
    ]);
  });

  it('skips a literal function name', () => {
    const refs = bindingReferences(reviewGate as WorkflowManifest);
    expect(refs.map((ref) => ref.location)).not.toContain('stages[0].function.name');
  });

  it('brackets parameter names that are not identifiers', () => {
    const manifest: WorkflowManifest = {
      schema_version: '1',
      key: 'k',
      name: 'K',
      version: '1.0.0',
      stages: [
        {
          key: 's',
          name: 'S',
          inputs: [{ key: 'doc', label: 'Doc', type: 'resource' }],
          function: { name: '@m:f', target: 'doc', parameters: { 'odd.name': '$inputs.doc.name' } },
        },
      ],
    };
    expect(bindingReferences(manifest)).toEqual([
      { location: 'stages[0].function.parameters["odd.name"]', expr: '$inputs.doc.name' },
    ]);
  });
});
