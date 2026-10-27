import { describe, expect, it } from 'vitest';
import { formatPath, schemaErrors, workflowManifestSchema } from './schema';
import smartDiff from '../../../docs/examples/smart_diff_workflow_manifest.json';

const INPUT_TYPES = [
  'resource',
  'system',
  'branch',
  'auth_secret',
  'text',
  'number',
  'boolean',
  'enum',
  'multi_enum',
  'stage_output',
];

describe('workflow-manifest.v1.json', () => {
  it('is a draft 2020-12 schema with the expected identity', () => {
    expect(workflowManifestSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(workflowManifestSchema.$id).toMatch(/workflow-manifest\.v1\.json$/);
    expect(workflowManifestSchema.properties.schema_version.const).toBe('1');
    expect(workflowManifestSchema.required).toEqual(['schema_version', 'key', 'name', 'version', 'stages']);
  });

  it('enumerates the input, output, and view types from the spec', () => {
    expect(workflowManifestSchema.$defs.inputType.enum).toEqual(INPUT_TYPES);
    expect(workflowManifestSchema.$defs.outputType.enum).toEqual([
      'artifact',
      'resource',
      'revision',
      'json',
      'text',
    ]);
    expect(workflowManifestSchema.$defs.viewType.enum).toEqual([
      'artifact_list',
      'json_table',
      'markdown',
      'summary',
    ]);
  });

  it('leaves additionalProperties open everywhere (readers tolerate unknown fields)', () => {
    const closed: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return;
      if (!Array.isArray(node) && 'additionalProperties' in node && node.additionalProperties === false) {
        closed.push(path);
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${path}/${key}`);
    };
    walk(workflowManifestSchema, '#');
    expect(closed).toEqual([]);
  });

  it('requires function.target and a name', () => {
    expect(workflowManifestSchema.$defs.function.required).toEqual(['name', 'target']);
  });
});

describe('schemaErrors', () => {
  it('returns no errors for the Smart Diff example', () => {
    expect(schemaErrors(smartDiff)).toEqual([]);
  });

  it('reports a non-object document', () => {
    expect(schemaErrors('nope')).toEqual(['manifest: must be of type object']);
    expect(schemaErrors(null)).toEqual(['manifest: must be of type object']);
  });

  it('reports every missing top-level field at once', () => {
    expect(schemaErrors({})).toEqual([
      'manifest: missing required property "schema_version"',
      'manifest: missing required property "key"',
      'manifest: missing required property "name"',
      'manifest: missing required property "version"',
      'manifest: missing required property "stages"',
    ]);
  });
});

describe('formatPath', () => {
  it('turns JSON pointers into readable paths', () => {
    expect(formatPath('')).toBe('manifest');
    expect(formatPath('/stages')).toBe('stages');
    expect(formatPath('/stages/0/inputs/2/filter')).toBe('stages[0].inputs[2].filter');
    expect(formatPath('/stages/0/function/parameters/odd.name')).toBe(
      'stages[0].function.parameters["odd.name"]',
    );
    expect(formatPath('/a~1b/c~0d')).toBe('["a/b"]["c~d"]');
  });
});
