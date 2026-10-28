/**
 * Manifest validation: JSON Schema conformance first, then the cross-reference rules the schema cannot
 * express (unique keys, function.target, binding resolution and stage ordering).
 *
 * Semantic checks run only once the document conforms to the schema, so they can rely on its shape.
 */
import { isBinding, parseBinding, type ParsedBinding } from './bindings';
import { schemaErrors } from './schema';
import type { InputType, ManifestInput, ManifestOutput, ManifestStage, WorkflowManifest } from './types';

export type ValidationResult = { ok: true; manifest: WorkflowManifest } | { ok: false; errors: string[] };

export function validateManifest(data: unknown): ValidationResult {
  const errors = schemaErrors(data);
  if (errors.length > 0) return { ok: false, errors };
  const manifest = data as WorkflowManifest;
  const semantic = semanticErrors(manifest);
  return semantic.length > 0 ? { ok: false, errors: semantic } : { ok: true, manifest };
}

const BINDING_FORMS = '$inputs.<key> or $stages.<stage>.inputs|outputs.<key>';

/** Fields of the structured value each input type produces (see the "Value bound" column of the spec). */
const VALUE_FIELDS: Partial<Record<InputType, readonly string[]>> = {
  resource: ['resource_id', 'revision_id', 'name'],
  system: ['system_id', 'name'],
  branch: ['branch_id', 'tag'],
  auth_secret: ['secret_id', 'name'],
};
/** Types whose value is a scalar or string list and therefore has no fields. */
const SCALAR_TYPES: ReadonlySet<InputType> = new Set(['text', 'number', 'boolean', 'enum', 'multi_enum']);

interface Scope {
  manifest: WorkflowManifest;
  index: number;
  stage: ManifestStage;
}

type Target =
  | { kind: 'input'; input: ManifestInput; stage: ManifestStage }
  | { kind: 'output'; output: ManifestOutput; stage: ManifestStage }
  | { kind: 'section'; section: 'inputs' | 'outputs'; stage: ManifestStage };

type Resolution = { ok: true; target: Target; parsed: ParsedBinding } | { ok: false; error: string };

function semanticErrors(manifest: WorkflowManifest): string[] {
  const errors: string[] = [];
  const stageIndexByKey = new Map<string, number>();
  manifest.stages.forEach((stage, index) => {
    const loc = `stages[${index}]`;
    const previous = stageIndexByKey.get(stage.key);
    if (previous === undefined) stageIndexByKey.set(stage.key, index);
    else errors.push(`${loc}.key: duplicate stage key "${stage.key}" (already used by stages[${previous}])`);
    checkUniqueKeys(stage.inputs, `${loc}.inputs`, 'input', errors);
    checkUniqueKeys(stage.outputs, `${loc}.outputs`, 'output', errors);
    const scope: Scope = { manifest, index, stage };
    checkTarget(scope, loc, errors);
    checkInputFilters(scope, loc, errors);
    checkFunctionBindings(scope, loc, errors);
    checkBinding(`${loc}.view.source`, stage.view?.source, scope, errors);
  });
  return errors;
}

function checkUniqueKeys(
  items: ReadonlyArray<{ key: string }> | undefined,
  loc: string,
  noun: string,
  errors: string[],
): void {
  const seen = new Map<string, number>();
  (items ?? []).forEach((item, index) => {
    const previous = seen.get(item.key);
    if (previous === undefined) seen.set(item.key, index);
    else
      errors.push(
        `${loc}[${index}].key: duplicate ${noun} key "${item.key}" (already used by ${loc}[${previous}])`,
      );
  });
}

function checkTarget(scope: Scope, loc: string, errors: string[]): void {
  const fn = scope.stage.function;
  if (!fn) return;
  const input = scope.stage.inputs?.find((candidate) => candidate.key === fn.target);
  if (!input) {
    errors.push(`${loc}.function.target: "${fn.target}" is not an input of stage "${scope.stage.key}"`);
  } else if (input.type !== 'resource') {
    errors.push(`${loc}.function.target: "${fn.target}" must be a "resource" input (it is "${input.type}")`);
  }
}

function checkInputFilters(scope: Scope, loc: string, errors: string[]): void {
  (scope.stage.inputs ?? []).forEach((input, index) => {
    const filterLoc = `${loc}.inputs[${index}].filter`;
    const filter = input.filter;
    if (!filter) return;
    if (input.type === 'resource' || input.type === 'branch') {
      checkBinding(`${filterLoc}.system`, filter.system, scope, errors, (target) =>
        target.kind === 'input' && target.input.type === 'system' ? null : 'must reference a "system" input',
      );
    }
    if (input.type === 'stage_output') {
      checkBinding(`${filterLoc}.source`, filter.source, scope, errors, (target) =>
        target.kind === 'output'
          ? null
          : "must reference an earlier stage's output ($stages.<stage>.outputs.<key>)",
      );
    }
    if ((input.type === 'enum' || input.type === 'multi_enum') && filter.options_by) {
      checkBinding(
        `${filterLoc}.options_by.source`,
        filter.options_by.source,
        scope,
        errors,
        (_target, parsed) => {
          if (parsed.kind !== 'inputs') return 'must reference an input in the same stage ($inputs.<key>)';
          return parsed.key === input.key ? 'may not reference its own input' : null;
        },
      );
    }
  });
}

/** Types whose value is a plain string and may therefore name a function at runtime. */
const FUNCTION_NAME_TYPES: ReadonlySet<InputType> = new Set(['enum', 'text']);

function checkFunctionBindings(scope: Scope, loc: string, errors: string[]): void {
  const fn = scope.stage.function;
  if (!fn) return;
  const fnLoc = `${loc}.function`;
  if (isBinding(fn.name)) {
    checkBinding(`${fnLoc}.name`, fn.name, scope, errors, (target) => {
      if (target.kind === 'input') {
        return FUNCTION_NAME_TYPES.has(target.input.type) ? null : 'must reference an "enum" or "text" input';
      }
      return target.kind === 'output' && target.output.type === 'text' ? null : 'must reference a text value';
    });
  }
  for (const [name, value] of Object.entries(fn.parameters ?? {})) {
    if (isBinding(value)) checkBinding(member(`${fnLoc}.parameters`, name), value, scope, errors);
  }
  for (const [name, value] of Object.entries(fn.sources ?? {})) {
    checkBinding(member(`${fnLoc}.sources`, name), value, scope, errors, (target) => {
      if (target.kind === 'output') return null;
      if (target.kind === 'input' && target.input.type === 'resource') return null;
      return 'must reference a "resource" input or a stage output';
    });
  }
  for (const [name, value] of Object.entries(fn.auth_bindings ?? {})) {
    checkBinding(member(`${fnLoc}.auth_bindings`, name), value, scope, errors, (target) =>
      target.kind === 'input' && target.input.type === 'auth_secret'
        ? null
        : 'must reference an "auth_secret" input',
    );
  }
}

function member(base: string, name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `${base}.${name}` : `${base}[${JSON.stringify(name)}]`;
}

/**
 * Checks a field that must hold a binding: it parses, resolves to a declaration in scope, and satisfies
 * `accept` (which returns an error suffix or null). `undefined` values are skipped.
 */
function checkBinding(
  loc: string,
  expr: string | undefined,
  scope: Scope,
  errors: string[],
  accept?: (target: Target, parsed: ParsedBinding) => string | null,
): void {
  if (expr === undefined) return;
  if (!isBinding(expr)) {
    errors.push(`${loc}: "${expr}" must be a binding (${BINDING_FORMS})`);
    return;
  }
  const resolution = resolveReference(expr, scope);
  if (!resolution.ok) {
    errors.push(`${loc}: ${resolution.error}`);
    return;
  }
  const problem = accept?.(resolution.target, resolution.parsed);
  if (problem) errors.push(`${loc}: "${expr}" ${problem}`);
}

function resolveReference(expr: string, scope: Scope): Resolution {
  const parsed = parseBinding(expr);
  if (!parsed) return { ok: false, error: `"${expr}" is not a valid binding (expected ${BINDING_FORMS})` };
  if (parsed.kind === 'inputs') return resolveInput(expr, parsed, scope.stage, parsed.key, parsed.path);

  const { stages } = scope.manifest;
  const targetIndex = stages.findIndex((stage) => stage.key === parsed.stage);
  if (targetIndex < 0) return { ok: false, error: `"${expr}" does not resolve: no stage "${parsed.stage}"` };
  if (targetIndex === scope.index) {
    return {
      ok: false,
      error: `"${expr}" references its own stage; use $inputs.<key> for the current stage`,
    };
  }
  if (targetIndex > scope.index) {
    const later = `stage "${parsed.stage}" (stages[${targetIndex}]), which comes after this stage`;
    return { ok: false, error: `"${expr}" references ${later}` };
  }
  const stage = stages[targetIndex];
  if (parsed.key === '')
    return { ok: true, target: { kind: 'section', section: parsed.section, stage }, parsed };
  if (parsed.section === 'inputs') return resolveInput(expr, parsed, stage, parsed.key, parsed.path);

  const output = stage.outputs?.find((candidate) => candidate.key === parsed.key);
  if (!output) {
    return {
      ok: false,
      error: `"${expr}" does not resolve: stage "${stage.key}" declares no output "${parsed.key}"`,
    };
  }
  return { ok: true, target: { kind: 'output', output, stage }, parsed };
}

function resolveInput(
  expr: string,
  parsed: ParsedBinding,
  stage: ManifestStage,
  key: string,
  path: readonly string[],
): Resolution {
  const input = stage.inputs?.find((candidate) => candidate.key === key);
  if (!input)
    return { ok: false, error: `"${expr}" does not resolve: stage "${stage.key}" has no input "${key}"` };
  const fieldError = checkFields(expr, input, path);
  if (fieldError) return { ok: false, error: fieldError };
  return { ok: true, target: { kind: 'input', input, stage }, parsed };
}

function checkFields(expr: string, input: ManifestInput, path: readonly string[]): string | null {
  if (path.length === 0) return null;
  if (SCALAR_TYPES.has(input.type)) {
    return `"${expr}": input "${input.key}" is a ${input.type} and has no fields`;
  }
  const fields = VALUE_FIELDS[input.type];
  if (fields && !fields.includes(path[0])) {
    const expected = fields.map((field) => `"${field}"`).join(', ');
    return `"${expr}": "${path[0]}" is not a field of a ${input.type} input (expected one of ${expected})`;
  }
  return null;
}
