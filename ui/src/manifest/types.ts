/**
 * Workflow manifest types. Mirrors docs/manifest-schema.md (schema_version "1").
 * The JSON Schema at schema/workflow-manifest.v1.json is the enforced contract;
 * these types are its TypeScript projection.
 */

export type InputType =
  | 'resource'
  | 'system'
  | 'branch'
  | 'auth_secret'
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'multi_enum'
  | 'stage_output';

export interface EnumOption {
  value: string;
  label: string;
}

/** Dependent options: show the group whose key equals the resolved `source` binding. */
export interface OptionsBy {
  source: string;
  groups: Record<string, EnumOption[]>;
}

export interface InputFilter {
  // resource
  extensions?: string[];
  system?: string; // binding, e.g. "$inputs.sys"
  // auth_secret
  secret_type?: string;
  // text
  multiline?: boolean;
  pattern?: string;
  max_length?: number;
  // number / multi_enum
  min?: number;
  max?: number;
  step?: number;
  // enum / multi_enum
  options?: EnumOption[];
  options_by?: OptionsBy;
  // stage_output
  source?: string; // binding, e.g. "$stages.diff.outputs.conflicts"
  multiple?: boolean;
}

export interface ManifestInput {
  key: string;
  label: string;
  type: InputType;
  required?: boolean;
  help?: string;
  default?: unknown;
  secret?: boolean;
  component?: string;
  filter?: InputFilter;
}

export type ParameterBinding = string | number | boolean;

export interface ManifestFunction {
  /** Function name, or a binding (e.g. "$inputs.model") whose resolved string value is the function name. */
  name: string;
  version?: string;
  /** Key of a `resource` input in the same stage; its resource_id is the job's resource_id. */
  target: string;
  /** Plain parameters written to the job's parameters file. */
  parameters?: Record<string, ParameterBinding>;
  /**
   * Additional user_model inputs: function input key -> binding to a `resource` input (or a stage output
   * resource/revision). The bound value's revision_id is sent as a job source with that relationship identifier.
   */
  sources?: Record<string, string>;
  /** auth_info inputs: function input key -> binding to an `auth_secret` input; its secret_id is bound to the job. */
  auth_bindings?: Record<string, string>;
  tool_name?: string;
  tool_version?: string;
  operating_system?: string;
  agent_pool_id?: string;
}

export type OutputType = 'artifact' | 'resource' | 'revision' | 'json' | 'text';

export interface ManifestOutput {
  key: string;
  label: string;
  type: OutputType;
  path?: string;
}

export type ViewType = 'artifact_list' | 'json_table' | 'markdown' | 'summary';

export interface ManifestView {
  type: ViewType;
  source: string;
  component?: string;
}

export interface ManifestStage {
  key: string;
  name: string;
  description?: string;
  inputs?: ManifestInput[];
  function?: ManifestFunction;
  outputs?: ManifestOutput[];
  view?: ManifestView;
}

export interface WorkflowManifest {
  schema_version: '1';
  key: string;
  name: string;
  description?: string;
  version: string;
  tags?: string[];
  icon?: string;
  stages: ManifestStage[];
}

/** Stage kind derived from its fields. */
export type StageKind = 'job' | 'review' | 'display';

export function stageKind(stage: ManifestStage): StageKind {
  if (stage.function) return 'job';
  if (stage.inputs && stage.inputs.length > 0) return 'review';
  return 'display';
}

/* ---------- Collected input values (what components produce) ---------- */

export interface ResourceValue {
  resource_id: string;
  revision_id: string;
  name: string;
}
export interface SystemValue {
  system_id: string;
  name: string;
}
export interface BranchValue {
  branch_id: string;
  tag: string;
}
export interface AuthSecretValue {
  secret_id: string;
  name: string;
  /** Derived from the linked auth integration when possible. */
  provider?: string;
}

export type InputValue =
  | ResourceValue
  | SystemValue
  | BranchValue
  | AuthSecretValue
  | string
  | number
  | boolean
  | string[]
  | unknown;

export type InputValues = Record<string, InputValue>;

/* ---------- Loaded manifests (catalog entries) ---------- */

export interface ManifestSource {
  resourceId: string;
  revisionId: string;
  /** File name in the workflow-manager system. */
  fileName: string;
}

export interface LoadedManifest extends ManifestSource {
  ok: true;
  manifest: WorkflowManifest;
}

export interface InvalidManifest extends ManifestSource {
  ok: false;
  errors: string[];
}

export type CatalogEntry = LoadedManifest | InvalidManifest;
