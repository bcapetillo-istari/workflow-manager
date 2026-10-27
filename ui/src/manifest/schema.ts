/**
 * JSON Schema conformance. The schema at schema/workflow-manifest.v1.json is the enforced contract;
 * this module compiles it with Ajv (draft 2020-12) and turns Ajv errors into one-line messages.
 *
 * The schema uses a non-standard `errorMessage` annotation (registered here as a metadata keyword) so
 * the human-readable wording for cross-field rules lives next to the rule itself.
 */
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import manifestSchema from '../../../schema/workflow-manifest.v1.json';

export const workflowManifestSchema = manifestSchema;

const ajv = new Ajv2020({ allErrors: true, verbose: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addKeyword({ keyword: 'errorMessage', schemaType: 'string' });

const validate = ajv.compile(manifestSchema);

/** Validates against the JSON Schema only. Empty array means conformant. */
export function schemaErrors(data: unknown): string[] {
  if (validate(data)) return [];
  const errors = validate.errors ?? [];
  // An error carrying a custom message stands in for everything reported beneath it (e.g. oneOf branches).
  // `if` and `propertyNames` are wrappers whose inner errors carry the detail, so they are dropped.
  const covered = errors
    .filter((error) => customMessage(error) !== undefined)
    .map((error) => `${error.schemaPath}/`);
  const lines = errors
    .filter((error) => error.keyword !== 'if' && error.keyword !== 'propertyNames')
    .filter((error) => !covered.some((prefix) => error.schemaPath.startsWith(prefix)))
    .map((error) => `${formatPath(error.instancePath)}: ${describe(error)}`);
  return [...new Set(lines)];
}

function customMessage(error: ErrorObject): string | undefined {
  const parent: unknown = error.parentSchema;
  if (typeof parent !== 'object' || parent === null || !('errorMessage' in parent)) return undefined;
  const message: unknown = parent.errorMessage;
  return typeof message === 'string' ? message : undefined;
}

function describe(error: ErrorObject): string {
  const custom = customMessage(error);
  if (custom !== undefined) return custom;
  const params: Record<string, unknown> = error.params;
  switch (error.keyword) {
    case 'required':
      return `missing required property ${JSON.stringify(params.missingProperty)}`;
    case 'type':
      return `must be of type ${String(params.type).split(',').join(' or ')}`;
    case 'enum':
      return `must be one of ${asArray(params.allowedValues)
        .map((value) => JSON.stringify(value))
        .join(', ')}`;
    case 'const':
      return `must be ${JSON.stringify(params.allowedValue)}`;
    case 'pattern':
      return `must match pattern ${String(params.pattern)}`;
    case 'format':
      return `must be a valid ${String(params.format)}`;
    case 'minItems':
      return `must have at least ${String(params.limit)} item(s)`;
    case 'minLength':
      return `must have at least ${String(params.limit)} character(s)`;
    case 'minimum':
    case 'exclusiveMinimum':
    case 'maximum':
    case 'exclusiveMaximum':
      return `must be ${String(params.comparison)} ${String(params.limit)}`;
    case 'oneOf':
      return 'must match exactly one of the allowed shapes';
    case 'contains':
      return 'must contain at least one matching item';
    default:
      return error.message ?? `fails the "${error.keyword}" rule`;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `/stages/0/inputs/2/filter` -> `stages[0].inputs[2].filter`; the root is reported as `manifest`. */
export function formatPath(instancePath: string): string {
  if (instancePath === '') return 'manifest';
  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((path, segment) => {
      if (/^\d+$/.test(segment)) return `${path}[${segment}]`;
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) return path === '' ? segment : `${path}.${segment}`;
      return `${path}[${JSON.stringify(segment)}]`;
    }, '');
}
