/**
 * Binding expressions: the only dynamic construct in a manifest.
 *
 *   $inputs.<key>[.<field>...]
 *   $stages.<stageKey>.inputs.<key>[.<field>...]
 *   $stages.<stageKey>.outputs[.<key>[.<field>...]]   (no key = the whole outputs section, used by views)
 *
 * Any other string is a literal. Field access walks plain object properties.
 */
import type { InputValues, ParameterBinding, WorkflowManifest } from './types';

export interface BindingContext {
  /** Values collected in the current stage. */
  inputs: InputValues;
  /** Completed stages by key. */
  stages: Record<string, { inputs?: InputValues; outputs?: Record<string, unknown> }>;
}

export type ParsedBinding =
  | { kind: 'inputs'; key: string; path: string[] }
  | {
      kind: 'stages';
      stage: string;
      section: 'inputs' | 'outputs';
      /** Empty string when the binding names a whole section, e.g. `$stages.diff.outputs`. */
      key: string;
      path: string[];
    };

export interface BindingReference {
  /** JSON path of the binding inside the manifest, e.g. `stages[0].function.parameters.prompt`. */
  location: string;
  expr: string;
}

const INPUTS_ROOT = '$inputs';
const STAGES_ROOT = '$stages';

/** True for strings starting with `$inputs.` or `$stages.`; such strings are never literals. */
export function isBinding(value: unknown): value is string {
  return (
    typeof value === 'string' && (value.startsWith(`${INPUTS_ROOT}.`) || value.startsWith(`${STAGES_ROOT}.`))
  );
}

/** Parses a binding expression; null when the string is not a binding or is malformed. */
export function parseBinding(expr: string): ParsedBinding | null {
  if (!isBinding(expr)) return null;
  const segments = expr.split('.');
  if (segments.some((segment) => segment.length === 0)) return null;
  const [root, ...rest] = segments;
  if (root === INPUTS_ROOT) {
    if (rest.length === 0) return null;
    const [key, ...path] = rest;
    return { kind: 'inputs', key, path };
  }
  if (rest.length < 2) return null;
  const [stage, section, ...keyAndPath] = rest;
  if (section !== 'inputs' && section !== 'outputs') return null;
  const [key = '', ...path] = keyAndPath;
  return { kind: 'stages', stage, section, key, path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function walk(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Literals pass through; bindings resolve against the context; unresolved bindings yield undefined. */
export function resolveBinding(value: ParameterBinding, ctx: BindingContext): unknown {
  if (!isBinding(value)) return value;
  const parsed = parseBinding(value);
  if (!parsed) return undefined;
  if (parsed.kind === 'inputs') return walk(ctx.inputs, [parsed.key, ...parsed.path]);
  const section: unknown = ctx.stages[parsed.stage]?.[parsed.section];
  const path = parsed.key === '' ? parsed.path : [parsed.key, ...parsed.path];
  return walk(section, path);
}

/** Resolves every parameter, omitting keys whose value resolves to undefined. */
export function resolveParameters(
  params: Record<string, ParameterBinding> | undefined,
  ctx: BindingContext,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    const result = resolveBinding(value, ctx);
    if (result !== undefined) resolved[name] = result;
  }
  return resolved;
}

function member(base: string, name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `${base}.${name}` : `${base}[${JSON.stringify(name)}]`;
}

/** Every binding string in the manifest with its JSON path, in document order. */
export function bindingReferences(manifest: WorkflowManifest): BindingReference[] {
  const refs: BindingReference[] = [];
  const add = (location: string, value: unknown): void => {
    if (isBinding(value)) refs.push({ location, expr: value });
  };
  manifest.stages.forEach((stage, stageIndex) => {
    const base = `stages[${stageIndex}]`;
    (stage.inputs ?? []).forEach((input, inputIndex) => {
      const filter = `${base}.inputs[${inputIndex}].filter`;
      add(`${filter}.system`, input.filter?.system);
      add(`${filter}.source`, input.filter?.source);
      add(`${filter}.options_by.source`, input.filter?.options_by?.source);
    });
    const fn = stage.function;
    add(`${base}.function.name`, fn?.name);
    for (const [name, value] of Object.entries(fn?.parameters ?? {})) {
      add(member(`${base}.function.parameters`, name), value);
    }
    for (const [name, value] of Object.entries(fn?.sources ?? {})) {
      add(member(`${base}.function.sources`, name), value);
    }
    for (const [name, value] of Object.entries(fn?.auth_bindings ?? {})) {
      add(member(`${base}.function.auth_bindings`, name), value);
    }
    add(`${base}.view.source`, stage.view?.source);
  });
  return refs;
}
