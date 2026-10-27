import { describe, expect, it } from 'vitest';
import { validateManifest } from './validate';
import type { WorkflowManifest } from './types';
import smartDiff from '../../../docs/examples/smart_diff_workflow_manifest.json';
import reviewGate from '../../../docs/examples/review_gate_workflow_manifest.json';
import missingTarget from '../../../docs/examples/invalid_missing_target_manifest.json';
import badBinding from '../../../docs/examples/invalid_bad_binding_manifest.json';

type Json = Record<string, unknown>;

/** Loosely typed manifest so tests can build invalid shapes. */
interface LooseStage extends Json {
  key?: string;
  name?: string;
  inputs?: Json[];
  function?: Json;
  outputs?: Json[];
  view?: Json;
}
interface Loose extends Json {
  stages: LooseStage[];
}

/** A minimal valid two-stage manifest: a job stage followed by a result view. */
function base(): WorkflowManifest {
  return {
    schema_version: '1',
    key: 'base-flow',
    name: 'Base flow',
    version: '1.0.0',
    stages: [
      {
        key: 'configure',
        name: 'Configure',
        inputs: [
          { key: 'doc', label: 'Document', type: 'resource', required: true },
          { key: 'sys', label: 'System', type: 'system' },
          { key: 'note', label: 'Note', type: 'text' },
        ],
        function: { name: '@istari_utils:do_thing', target: 'doc', parameters: { note: '$inputs.note' } },
        outputs: [{ key: 'report', label: 'Report', type: 'artifact' }],
      },
      {
        key: 'results',
        name: 'Results',
        view: { type: 'artifact_list', source: '$stages.configure.outputs' },
      },
    ],
  };
}

/** Builds a manifest from `base()` with a mutation, typed loosely so tests can produce invalid shapes. */
function build(mutate: (manifest: Loose) => void): unknown {
  const manifest = structuredClone(base()) as unknown as Loose;
  mutate(manifest);
  return manifest;
}

function errorsOf(data: unknown): string[] {
  const result = validateManifest(data);
  return result.ok ? [] : result.errors;
}

function withInput(input: Json, stageIndex = 0): unknown {
  return build((m) => {
    const stage = m.stages[stageIndex];
    stage.inputs = [...(stage.inputs ?? []), { key: 'extra', label: 'Extra', type: 'text', ...input }];
  });
}

describe('examples', () => {
  it('accepts the Smart Diff manifest and returns it typed', () => {
    const result = validateManifest(smartDiff);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.key).toBe('smart-diff');
  });

  it('accepts the review gate manifest', () => {
    expect(errorsOf(reviewGate)).toEqual([]);
  });

  it('rejects the missing-target example with the documented message', () => {
    expect(errorsOf(missingTarget)).toEqual(['stages[0].function: missing required property "target"']);
  });

  it('rejects the bad-binding example with the documented messages', () => {
    expect(errorsOf(badBinding)).toEqual([
      'stages[0].function.parameters.file2_resource_id: "$inputs.file3.resource_id" does not resolve: ' +
        'stage "configure" has no input "file3"',
      'stages[0].function.parameters.previous_report: "$stages.results.outputs.report" references ' +
        'stage "results" (stages[1]), which comes after this stage',
    ]);
  });

  it('accepts the baseline fixture', () => {
    expect(errorsOf(base())).toEqual([]);
  });
});

describe('schema: top level', () => {
  it('rejects non-objects', () => {
    expect(errorsOf(undefined)).toEqual(['manifest: must be of type object']);
    expect(errorsOf([])).toEqual(['manifest: must be of type object']);
  });

  it('requires schema_version "1"', () => {
    expect(errorsOf(build((m) => (m.schema_version = '2')))).toEqual([
      'schema_version: schema_version must be "1"',
    ]);
    expect(errorsOf(build((m) => (m.schema_version = 1)))).toEqual([
      'schema_version: schema_version must be "1"',
    ]);
  });

  it('requires a kebab-case key and a semver version', () => {
    expect(errorsOf(build((m) => (m.key = 'Not Kebab')))).toEqual([
      'key: key must be kebab-case (lowercase letters, digits, single hyphens)',
    ]);
    expect(errorsOf(build((m) => (m.version = 'v1')))).toEqual([
      'version: version must be semver, for example "1.0.0"',
    ]);
    expect(errorsOf(build((m) => (m.version = '1.2.3-beta.1+build.7')))).toEqual([]);
  });

  it('requires at least one stage and typed optional fields', () => {
    expect(errorsOf(build((m) => (m.stages = [])))).toEqual(['stages: must have at least 1 item(s)']);
    expect(errorsOf(build((m) => (m.tags = ['a', 2])))).toEqual(['tags[1]: must be of type string']);
    expect(errorsOf(build((m) => (m.icon = 3)))).toEqual(['icon: must be of type string']);
    expect(errorsOf(build((m) => (m.name = '')))).toEqual(['name: must have at least 1 character(s)']);
  });

  it('tolerates unknown fields everywhere', () => {
    const data = build((m) => {
      m.extra = true;
      m.stages[0].extra = 'x';
      (m.stages[0].inputs as Json[])[0].extra = 1;
      (m.stages[0].function as Json).extra = [];
      (m.stages[0].inputs as Json[])[0].filter = { unknown_filter_field: 1 };
    });
    expect(errorsOf(data)).toEqual([]);
  });
});

describe('schema: stages, inputs, outputs, views', () => {
  it('requires stage key and name', () => {
    expect(errorsOf(build((m) => delete m.stages[1].name))).toEqual([
      'stages[1]: missing required property "name"',
    ]);
    expect(errorsOf(build((m) => (m.stages[1].key = 'has.dot')))).toEqual([
      'stages[1].key: key must contain only letters, digits, underscores, and hyphens',
    ]);
  });

  it('requires input key, label and a known type', () => {
    expect(errorsOf(withInput({ type: 'date' }))).toEqual([
      'stages[0].inputs[3].type: must be one of "resource", "system", "branch", "auth_secret", "text", "number", ' +
        '"boolean", "enum", "multi_enum", "stage_output"',
    ]);
    expect(errorsOf(build((m) => delete (m.stages[0].inputs as Json[])[2].label))).toEqual([
      'stages[0].inputs[2]: missing required property "label"',
    ]);
  });

  it('requires enum and multi_enum to have exactly one of options or options_by', () => {
    const msg = 'enum and multi_enum require exactly one of "options" or "options_by"';
    expect(errorsOf(withInput({ type: 'enum', filter: {} }))).toEqual([`stages[0].inputs[3].filter: ${msg}`]);
    expect(errorsOf(withInput({ type: 'multi_enum' }))).toEqual([
      'stages[0].inputs[3]: enum and multi_enum require a filter with exactly one of "options" or "options_by"',
    ]);
    const both = {
      options: [{ value: 'a', label: 'A' }],
      options_by: { source: '$inputs.note', groups: { x: [{ value: 'a', label: 'A' }] } },
    };
    expect(errorsOf(withInput({ type: 'multi_enum', filter: both }))).toEqual([
      `stages[0].inputs[3].filter: ${msg}`,
    ]);
    expect(errorsOf(withInput({ type: 'enum', filter: { options: [{ value: 'a', label: 'A' }] } }))).toEqual(
      [],
    );
    expect(errorsOf(withInput({ type: 'enum', filter: { options: [] } }))).toEqual([
      'stages[0].inputs[3].filter.options: must have at least 1 item(s)',
    ]);
    expect(errorsOf(withInput({ type: 'enum', filter: { options: [{ value: 'a' }] } }))).toEqual([
      'stages[0].inputs[3].filter.options[0]: missing required property "label"',
    ]);
  });

  it('validates the options_by shape', () => {
    const ok = { source: '$inputs.sys.name', groups: { prod: [{ value: 'a', label: 'A' }], dev: [] } };
    expect(errorsOf(withInput({ type: 'enum', filter: { options_by: ok } }))).toEqual([]);
    expect(
      errorsOf(withInput({ type: 'enum', filter: { options_by: { source: '$inputs.sys.name' } } })),
    ).toEqual(['stages[0].inputs[3].filter.options_by: missing required property "groups"']);
    expect(
      errorsOf(withInput({ type: 'enum', filter: { options_by: { source: 'openai', groups: {} } } })),
    ).toEqual([
      'stages[0].inputs[3].filter.options_by.source: must be a binding ($inputs.<key> or ' +
        '$stages.<stage>.inputs|outputs.<key>)',
    ]);
    const badGroup = { source: '$inputs.sys.name', groups: { prod: [{ value: 1, label: 'A' }] } };
    expect(errorsOf(withInput({ type: 'enum', filter: { options_by: badGroup } }))).toEqual([
      'stages[0].inputs[3].filter.options_by.groups.prod[0].value: must be of type string',
    ]);
  });

  it('requires stage_output to have filter.source in outputs form', () => {
    expect(errorsOf(withInput({ type: 'stage_output' }, 1))).toEqual([
      'stages[1].inputs[0]: stage_output requires a filter with source ($stages.<stage>.outputs.<key>)',
    ]);
    expect(errorsOf(withInput({ type: 'stage_output', filter: { multiple: true } }, 1))).toEqual([
      'stages[1].inputs[0].filter: stage_output requires filter.source ($stages.<stage>.outputs.<key>)',
    ]);
    expect(
      errorsOf(withInput({ type: 'stage_output', filter: { source: '$stages.configure.inputs.doc' } }, 1)),
    ).toEqual([
      "stages[1].inputs[0].filter.source: must reference an earlier stage's output ($stages.<stage>.outputs.<key>)",
    ]);
    expect(
      errorsOf(
        withInput({ type: 'stage_output', filter: { source: '$stages.configure.outputs.report' } }, 1),
      ),
    ).toEqual([]);
  });

  it('requires branch to have filter.system', () => {
    expect(errorsOf(withInput({ type: 'branch' }))).toEqual([
      'stages[0].inputs[3]: branch requires a filter with system ($inputs.<key> of a system input)',
    ]);
    expect(errorsOf(withInput({ type: 'branch', filter: {} }))).toEqual([
      'stages[0].inputs[3].filter: branch requires filter.system ($inputs.<key> of a system input)',
    ]);
    expect(errorsOf(withInput({ type: 'branch', filter: { system: '$inputs.sys' } }))).toEqual([]);
  });

  it('allows secret only on auth_secret and text', () => {
    expect(errorsOf(withInput({ type: 'number', secret: true }))).toEqual([
      'stages[0].inputs[3].type: secret may only be set on auth_secret and text inputs',
    ]);
    expect(errorsOf(withInput({ type: 'text', secret: true }))).toEqual([]);
    expect(
      errorsOf(withInput({ type: 'auth_secret', secret: true, filter: { secret_type: '@token:llm' } })),
    ).toEqual([]);
    expect(errorsOf(withInput({ type: 'number', secret: false }))).toEqual([]);
  });

  it('types filter fields', () => {
    expect(errorsOf(withInput({ type: 'text', filter: { pattern: '(' } }))).toEqual([
      'stages[0].inputs[3].filter.pattern: must be a valid regex',
    ]);
    expect(errorsOf(withInput({ type: 'text', filter: { max_length: 1.5, multiline: 'yes' } }))).toEqual([
      'stages[0].inputs[3].filter.multiline: must be of type boolean',
      'stages[0].inputs[3].filter.max_length: must be of type integer',
    ]);
    expect(errorsOf(withInput({ type: 'number', filter: { min: '1', step: 0 } }))).toEqual([
      'stages[0].inputs[3].filter.min: must be of type number',
      'stages[0].inputs[3].filter.step: must be > 0',
    ]);
    expect(errorsOf(withInput({ type: 'resource', filter: { extensions: 'pdf' } }))).toEqual([
      'stages[0].inputs[3].filter.extensions: must be of type array',
    ]);
  });

  it('validates function shape', () => {
    expect(errorsOf(build((m) => delete (m.stages[0].function as Json).name))).toEqual([
      'stages[0].function: missing required property "name"',
    ]);
    expect(errorsOf(build((m) => ((m.stages[0].function as Json).name = 'smart_diff')))).toEqual([
      'stages[0].function.name: function name must be fully qualified (for example "@istari_utils:smart_diff") ' +
        'or a binding such as "$inputs.model"',
    ]);
    expect(errorsOf(build((m) => ((m.stages[0].function as Json).parameters = { x: { a: 1 } })))).toEqual([
      'stages[0].function.parameters.x: must be of type string or number or boolean',
    ]);
    expect(errorsOf(build((m) => ((m.stages[0].function as Json).version = 3)))).toEqual([
      'stages[0].function.version: must be of type string',
    ]);
    expect(errorsOf(build((m) => ((m.stages[0].function as Json).sources = { file2: 'literal' })))).toEqual([
      'stages[0].function.sources.file2: must be a binding ($inputs.<key> or $stages.<stage>.inputs|outputs.<key>)',
    ]);
    expect(
      errorsOf(build((m) => ((m.stages[0].function as Json).auth_bindings = { '': '$inputs.doc' }))),
    ).toEqual(['stages[0].function.auth_bindings: function input keys must be non-empty']);
    expect(errorsOf(build((m) => ((m.stages[0].function as Json).sources = [])))).toEqual([
      'stages[0].function.sources: must be of type object',
    ]);
  });

  it('requires a job stage to declare a resource input', () => {
    expect(
      errorsOf(build((m) => (m.stages[0].inputs = [{ key: 'note', label: 'Note', type: 'text' }]))),
    ).toEqual([
      'stages[0].inputs: a stage with a function must have at least one "resource" input to use as function.target',
    ]);
    expect(errorsOf(build((m) => delete m.stages[0].inputs))).toEqual([
      'stages[0]: a stage with a function must declare inputs including at least one "resource" input',
    ]);
  });

  it('validates outputs and views', () => {
    expect(errorsOf(build((m) => (m.stages[0].outputs = [{ key: 'r', label: 'R', type: 'blob' }])))).toEqual([
      'stages[0].outputs[0].type: must be one of "artifact", "resource", "revision", "json", "text"',
    ]);
    expect(errorsOf(build((m) => (m.stages[0].outputs = [{ key: 'r', type: 'json', path: 1 }])))).toEqual([
      'stages[0].outputs[0]: missing required property "label"',
      'stages[0].outputs[0].path: must be of type string',
    ]);
    expect(
      errorsOf(build((m) => (m.stages[1].view = { type: 'chart', source: '$stages.configure.outputs' }))),
    ).toEqual(['stages[1].view.type: must be one of "artifact_list", "json_table", "markdown", "summary"']);
    expect(errorsOf(build((m) => (m.stages[1].view = { type: 'markdown' })))).toEqual([
      'stages[1].view: missing required property "source"',
    ]);
    expect(errorsOf(build((m) => (m.stages[1].view = { type: 'markdown', source: 'Hello' })))).toEqual([
      'stages[1].view.source: must be a binding ($inputs.<key> or $stages.<stage>.inputs|outputs.<key>)',
    ]);
  });
});

describe('semantics: unique keys', () => {
  it('rejects duplicate stage keys', () => {
    expect(errorsOf(build((m) => (m.stages[1].key = 'configure')))).toEqual([
      'stages[1].key: duplicate stage key "configure" (already used by stages[0])',
    ]);
  });

  it('rejects duplicate input keys within a stage but allows reuse across stages', () => {
    expect(errorsOf(withInput({ key: 'doc' }))).toEqual([
      'stages[0].inputs[3].key: duplicate input key "doc" (already used by stages[0].inputs[0])',
    ]);
    expect(errorsOf(withInput({ key: 'note' }, 1))).toEqual([]);
  });

  it('rejects duplicate output keys within a stage', () => {
    const dup = build((m) =>
      (m.stages[0].outputs as Json[]).push({ key: 'report', label: 'Again', type: 'json' }),
    );
    expect(errorsOf(dup)).toEqual([
      'stages[0].outputs[1].key: duplicate output key "report" (already used by stages[0].outputs[0])',
    ]);
  });
});

describe('semantics: function.target', () => {
  it('must name an input of the same stage', () => {
    expect(errorsOf(build((m) => ((m.stages[0].function as Json).target = 'nope')))).toEqual([
      'stages[0].function.target: "nope" is not an input of stage "configure"',
    ]);
  });

  it('must name a resource input', () => {
    expect(errorsOf(build((m) => ((m.stages[0].function as Json).target = 'note')))).toEqual([
      'stages[0].function.target: "note" must be a "resource" input (it is "text")',
    ]);
  });
});

describe('semantics: binding resolution', () => {
  function withParams(params: Record<string, string | number | boolean>, stageIndex = 0): unknown {
    return build((m) => {
      const stage = m.stages[stageIndex];
      stage.inputs = [...(stage.inputs ?? []), { key: 'doc2', label: 'Doc', type: 'resource' }];
      stage.function = { name: '@istari_utils:f', target: 'doc2', parameters: params };
    });
  }
  const loc = 'stages[1].function.parameters.p';

  it('accepts every valid form and literals', () => {
    const params = {
      a: '$inputs.doc2',
      b: '$inputs.doc2.revision_id',
      c: '$stages.configure.inputs.doc.resource_id',
      d: '$stages.configure.inputs.note',
      e: '$stages.configure.outputs.report',
      f: '$stages.configure.outputs',
      g: '$stages.configure.inputs',
      literal: 'just text',
      n: 1,
      flag: true,
    };
    expect(errorsOf(withParams(params, 1))).toEqual([]);
  });

  it('rejects unknown inputs, stages and outputs', () => {
    expect(errorsOf(withParams({ p: '$inputs.ghost' }, 1))).toEqual([
      `${loc}: "$inputs.ghost" does not resolve: stage "results" has no input "ghost"`,
    ]);
    expect(errorsOf(withParams({ p: '$stages.ghost.outputs.report' }, 1))).toEqual([
      `${loc}: "$stages.ghost.outputs.report" does not resolve: no stage "ghost"`,
    ]);
    expect(errorsOf(withParams({ p: '$stages.configure.outputs.ghost' }, 1))).toEqual([
      `${loc}: "$stages.configure.outputs.ghost" does not resolve: stage "configure" declares no output "ghost"`,
    ]);
    expect(errorsOf(withParams({ p: '$stages.configure.inputs.ghost' }, 1))).toEqual([
      `${loc}: "$stages.configure.inputs.ghost" does not resolve: stage "configure" has no input "ghost"`,
    ]);
  });

  it('rejects malformed bindings', () => {
    expect(errorsOf(withParams({ p: '$stages.configure.params.x' }, 1))).toEqual([
      `${loc}: "$stages.configure.params.x" is not a valid binding (expected $inputs.<key> or ` +
        '$stages.<stage>.inputs|outputs.<key>)',
    ]);
    expect(errorsOf(withParams({ p: '$inputs.' }, 1))).toEqual([
      `${loc}: "$inputs." is not a valid binding (expected $inputs.<key> or $stages.<stage>.inputs|outputs.<key>)`,
    ]);
  });

  it('only allows $stages references to earlier stages', () => {
    expect(errorsOf(withParams({ p: '$stages.results.outputs.report' }, 0))).toEqual([
      'stages[0].function.parameters.p: "$stages.results.outputs.report" references stage "results" (stages[1]), ' +
        'which comes after this stage',
    ]);
    expect(errorsOf(withParams({ p: '$stages.configure.inputs.doc' }, 0))).toEqual([
      'stages[0].function.parameters.p: "$stages.configure.inputs.doc" references its own stage; ' +
        'use $inputs.<key> for the current stage',
    ]);
  });

  it('checks field names against the bound value shape', () => {
    expect(errorsOf(withParams({ p: '$inputs.doc2.id' }, 1))).toEqual([
      `${loc}: "$inputs.doc2.id": "id" is not a field of a resource input ` +
        '(expected one of "resource_id", "revision_id", "name")',
    ]);
    expect(errorsOf(withParams({ p: '$stages.configure.inputs.note.length' }, 1))).toEqual([
      `${loc}: "$stages.configure.inputs.note.length": input "note" is a text and has no fields`,
    ]);
    expect(errorsOf(withParams({ p: '$stages.configure.inputs.sys.system_id' }, 1))).toEqual([]);
    expect(errorsOf(withParams({ p: '$stages.configure.outputs.report.anything.deep' }, 1))).toEqual([]);
  });

  it('allows any field path on stage_output inputs (value shape is unknown)', () => {
    const data = build((m) => {
      m.stages[1].inputs = [
        {
          key: 'pick',
          label: 'Pick',
          type: 'stage_output',
          filter: { source: '$stages.configure.outputs.report' },
        },
        { key: 'doc2', label: 'Doc', type: 'resource' },
      ];
      m.stages[1].function = {
        name: '@istari_utils:f',
        target: 'doc2',
        parameters: { p: '$inputs.pick.some.field' },
      };
    });
    expect(errorsOf(data)).toEqual([]);
  });
});

describe('semantics: function name, sources and auth_bindings', () => {
  function withFunction(fn: Json, stageIndex = 1): unknown {
    return build((m) => {
      const stage = m.stages[stageIndex];
      stage.inputs = [
        ...(stage.inputs ?? []),
        { key: 'doc2', label: 'Doc', type: 'resource' },
        { key: 'cred', label: 'Credential', type: 'auth_secret' },
        { key: 'fn', label: 'Function', type: 'enum', filter: { options: [{ value: '@m:f', label: 'F' }] } },
        { key: 'fn_text', label: 'Function', type: 'text' },
        { key: 'count', label: 'Count', type: 'number' },
      ];
      stage.function = { name: '@istari_utils:f', target: 'doc2', ...fn };
    });
  }
  const fnLoc = 'stages[1].function';

  it('accepts a function name bound to an enum or text input', () => {
    expect(errorsOf(withFunction({ name: '$inputs.fn' }))).toEqual([]);
    expect(errorsOf(withFunction({ name: '$inputs.fn_text' }))).toEqual([]);
    expect(errorsOf(withFunction({ name: '$stages.configure.inputs.note' }))).toEqual([]);
  });

  it('rejects a function name bound to anything that is not a string value', () => {
    expect(errorsOf(withFunction({ name: '$inputs.count' }))).toEqual([
      `${fnLoc}.name: "$inputs.count" must reference an "enum" or "text" input`,
    ]);
    expect(errorsOf(withFunction({ name: '$inputs.doc2' }))).toEqual([
      `${fnLoc}.name: "$inputs.doc2" must reference an "enum" or "text" input`,
    ]);
    expect(errorsOf(withFunction({ name: '$stages.configure.outputs.report' }))).toEqual([
      `${fnLoc}.name: "$stages.configure.outputs.report" must reference a text value`,
    ]);
    expect(errorsOf(withFunction({ name: '$inputs.ghost' }))).toEqual([
      `${fnLoc}.name: "$inputs.ghost" does not resolve: stage "results" has no input "ghost"`,
    ]);
  });

  it('accepts sources bound to resource inputs or stage outputs', () => {
    const sources = {
      a: '$inputs.doc2',
      b: '$stages.configure.inputs.doc',
      c: '$stages.configure.outputs.report',
      d: '$stages.configure.outputs.report.revision_id',
    };
    expect(errorsOf(withFunction({ sources }))).toEqual([]);
  });

  it('rejects sources bound to non-resource values', () => {
    expect(errorsOf(withFunction({ sources: { x: '$inputs.cred' } }))).toEqual([
      `${fnLoc}.sources.x: "$inputs.cred" must reference a "resource" input or a stage output`,
    ]);
    expect(errorsOf(withFunction({ sources: { x: '$inputs.doc2.resource_id' } }))).toEqual([]);
    expect(errorsOf(withFunction({ sources: { x: '$stages.configure.outputs' } }))).toEqual([
      `${fnLoc}.sources.x: "$stages.configure.outputs" must reference a "resource" input or a stage output`,
    ]);
    expect(errorsOf(withFunction({ sources: { 'odd.key': '$inputs.ghost' } }))).toEqual([
      `${fnLoc}.sources["odd.key"]: "$inputs.ghost" does not resolve: stage "results" has no input "ghost"`,
    ]);
  });

  it('accepts auth_bindings bound to auth_secret inputs, here or in an earlier stage', () => {
    const data = build((m) => {
      (m.stages[0].inputs as Json[]).push({ key: 'cred0', label: 'Cred', type: 'auth_secret' });
    });
    expect(errorsOf(data)).toEqual([]);
    expect(errorsOf(withFunction({ auth_bindings: { auth_token: '$inputs.cred' } }))).toEqual([]);
    const manifest = build((m) => {
      (m.stages[0].inputs as Json[]).push({ key: 'cred0', label: 'Cred', type: 'auth_secret' });
      m.stages[1].inputs = [{ key: 'doc2', label: 'Doc', type: 'resource' }];
      m.stages[1].function = {
        name: '@m:f',
        target: 'doc2',
        auth_bindings: { auth_token: '$stages.configure.inputs.cred0' },
      };
    });
    expect(errorsOf(manifest)).toEqual([]);
  });

  it('rejects auth_bindings bound to anything else', () => {
    expect(errorsOf(withFunction({ auth_bindings: { auth_token: '$inputs.doc2' } }))).toEqual([
      `${fnLoc}.auth_bindings.auth_token: "$inputs.doc2" must reference an "auth_secret" input`,
    ]);
    expect(
      errorsOf(withFunction({ auth_bindings: { auth_token: '$stages.configure.outputs.report' } })),
    ).toEqual([
      `${fnLoc}.auth_bindings.auth_token: "$stages.configure.outputs.report" must reference an "auth_secret" input`,
    ]);
    expect(errorsOf(withFunction({ auth_bindings: { auth_token: '$inputs.cred.secret_id' } }))).toEqual([]);
  });
});

describe('semantics: filter bindings', () => {
  it('filter.system must reference a system input', () => {
    expect(errorsOf(withInput({ type: 'resource', filter: { system: '$inputs.sys' } }))).toEqual([]);
    expect(errorsOf(withInput({ type: 'resource', filter: { system: '$inputs.note' } }))).toEqual([
      'stages[0].inputs[3].filter.system: "$inputs.note" must reference a "system" input',
    ]);
    expect(errorsOf(withInput({ type: 'branch', filter: { system: '$inputs.ghost' } }))).toEqual([
      'stages[0].inputs[3].filter.system: "$inputs.ghost" does not resolve: stage "configure" has no input "ghost"',
    ]);
    expect(
      errorsOf(withInput({ type: 'branch', filter: { system: '$stages.configure.inputs.sys' } }, 1)),
    ).toEqual([]);
    expect(
      errorsOf(withInput({ type: 'branch', filter: { system: '$stages.configure.outputs' } }, 1)),
    ).toEqual([
      'stages[1].inputs[0].filter.system: "$stages.configure.outputs" must reference a "system" input',
    ]);
  });

  it('stage_output filter.source must resolve to an earlier stage output', () => {
    expect(
      errorsOf(withInput({ type: 'stage_output', filter: { source: '$stages.configure.outputs.ghost' } }, 1)),
    ).toEqual([
      'stages[1].inputs[0].filter.source: "$stages.configure.outputs.ghost" does not resolve: ' +
        'stage "configure" declares no output "ghost"',
    ]);
    expect(
      errorsOf(withInput({ type: 'stage_output', filter: { source: '$stages.results.outputs.report' } }, 0)),
    ).toEqual([
      'stages[0].inputs[3].filter.source: "$stages.results.outputs.report" references stage "results" (stages[1]), ' +
        'which comes after this stage',
    ]);
  });

  it('options_by.source must reference another input in the same stage', () => {
    const groups = { x: [{ value: 'a', label: 'A' }] };
    expect(
      errorsOf(withInput({ type: 'enum', filter: { options_by: { source: '$inputs.sys.name', groups } } })),
    ).toEqual([]);
    expect(
      errorsOf(withInput({ type: 'enum', filter: { options_by: { source: '$inputs.extra', groups } } })),
    ).toEqual([
      'stages[0].inputs[3].filter.options_by.source: "$inputs.extra" may not reference its own input',
    ]);
    expect(
      errorsOf(withInput({ type: 'enum', filter: { options_by: { source: '$inputs.ghost', groups } } })),
    ).toEqual([
      'stages[0].inputs[3].filter.options_by.source: "$inputs.ghost" does not resolve: ' +
        'stage "configure" has no input "ghost"',
    ]);
    const cross = { source: '$stages.configure.inputs.sys.name', groups };
    expect(errorsOf(withInput({ type: 'multi_enum', filter: { options_by: cross } }, 1))).toEqual([
      'stages[1].inputs[0].filter.options_by.source: "$stages.configure.inputs.sys.name" must reference an input ' +
        'in the same stage ($inputs.<key>)',
    ]);
  });

  it('view.source must resolve', () => {
    expect(
      errorsOf(
        build((m) => (m.stages[1].view = { type: 'summary', source: '$stages.configure.outputs.report' })),
      ),
    ).toEqual([]);
    expect(
      errorsOf(build((m) => (m.stages[1].view = { type: 'summary', source: '$stages.ghost.outputs' }))),
    ).toEqual(['stages[1].view.source: "$stages.ghost.outputs" does not resolve: no stage "ghost"']);
    expect(
      errorsOf(build((m) => (m.stages[0].view = { type: 'summary', source: '$stages.results.outputs' }))),
    ).toEqual([
      'stages[0].view.source: "$stages.results.outputs" references stage "results" (stages[1]), ' +
        'which comes after this stage',
    ]);
  });
});

describe('phases', () => {
  it('reports schema errors before semantic errors', () => {
    const data = build((m) => {
      delete m.stages[1].name;
      m.stages[1].view = { type: 'summary', source: '$stages.ghost.outputs' };
    });
    expect(errorsOf(data)).toEqual(['stages[1]: missing required property "name"']);
  });

  it('collects every semantic error at once', () => {
    const data = build((m) => {
      m.stages[1].key = 'configure';
      (m.stages[0].function as Json).target = 'note';
      (m.stages[0].function as Json).parameters = { p: '$inputs.ghost' };
    });
    expect(errorsOf(data)).toHaveLength(3);
  });
});
