/**
 * IstariGateway: the only way the SPA talks to Istari.
 * v1 implementation: a minimal fetch-based REST client (src/gateway/rest).
 * Later: the Istari TypeScript client, or an iframe postMessage bridge.
 * All calls are made as the current user with their bearer token.
 */

export interface CurrentUser {
  id: string;
  email?: string;
  displayName?: string;
}

export type ResourceType = 'model' | 'artifact' | 'file' | 'container';

export interface ResourceSummary {
  resourceId: string;
  /** Current active revision. */
  revisionId: string;
  name: string;
  extension?: string;
  mime?: string;
  size?: number;
  resourceType: ResourceType;
  description?: string;
  createdById: string;
  created: string;
  updated: string;
}

export interface RevisionSummary {
  revisionId: string;
  name: string;
  created: string;
  createdById: string;
  versionName?: string;
  description?: string;
}

export interface SystemSummary {
  systemId: string;
  name: string;
  description?: string;
}

export interface BranchSummary {
  branchId: string;
  tag: string;
  isBaseline: boolean;
  snapshotId: string;
}

export interface TrackedResource extends ResourceSummary {
  path: string;
  trackedFileId: string;
}

export interface AuthSecretSummary {
  secretId: string;
  name: string;
  functionAuthType: string;
  authIntegrationId?: string;
  expiration?: string;
}

export interface FunctionSummary {
  name: string;
  moduleName: string;
  displayName?: string;
  versions: string[];
  toolName?: string;
  toolVersions?: string[];
  operatingSystems?: string[];
}

export type JobStatus =
  | 'Created'
  | 'Pending'
  | 'Claimed'
  | 'Validating'
  | 'Running'
  | 'Uploading'
  | 'Completed'
  | 'Failed'
  | 'Canceled'
  | 'Unknown';

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'Completed',
  'Failed',
  'Canceled',
]);

export interface JobSummary {
  jobId: string;
  resourceId: string;
  functionName: string;
  functionVersion?: string;
  status: JobStatus;
  statusMessage?: string;
  createdById: string;
  created: string;
  updated?: string;
}

export interface ArtifactSummary {
  resourceId: string;
  revisionId: string;
  name: string;
  extension?: string;
  mime?: string;
  size?: number;
  created: string;
}

export interface JobSource {
  /** Revision of an additional input resource. */
  revisionId: string;
  /** The function input key this revision satisfies (e.g. "file2"). */
  relationshipIdentifier?: string;
}

export interface JobAuthBinding {
  /** The function's auth_info input name (e.g. "auth_token"). */
  inputName: string;
  /** Stored credential (function auth secret) id to mint from when the job is claimed. */
  credentialId: string;
}

export interface CreateJobRequest {
  resourceId: string;
  functionName: string;
  functionVersion?: string;
  parameters: Record<string, unknown>;
  toolName?: string;
  toolVersion?: string;
  operatingSystem?: string;
  agentPoolId?: string;
  /** Extra user_model inputs, recorded as sources of the parameters revision. */
  sources?: JobSource[];
  /** Credential bindings for the function's auth_info inputs. */
  authBindings?: JobAuthBinding[];
}

export interface CreateJsonResourceRequest {
  systemId: string;
  /** Defaults to the system's baseline branch. */
  branchId?: string;
  /** File name including .json extension. */
  name: string;
  data: unknown;
  description?: string;
  resourceType?: ResourceType; // default 'artifact'
}

export interface JsonRead<T> {
  data: T;
  revisionId: string;
}

export interface ResourceSearch {
  name?: string;
  extensions?: string[];
  systemId?: string;
  resourceTypes?: ResourceType[];
  size?: number;
}

export class GatewayError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, opts?: { status?: number; body?: unknown; cause?: unknown }) {
    super(message, { cause: opts?.cause });
    this.name = 'GatewayError';
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

export interface IstariGateway {
  currentUser(): Promise<CurrentUser>;

  listSystems(query?: { name?: string; size?: number }): Promise<SystemSummary[]>;
  getSystem(systemId: string): Promise<SystemSummary>;
  listBranches(systemId: string): Promise<BranchSummary[]>;
  /** Tracked resources on a branch; baseline branch when branchId is omitted. */
  listTrackedResources(systemId: string, branchId?: string): Promise<TrackedResource[]>;

  searchResources(query: ResourceSearch): Promise<ResourceSummary[]>;
  getResource(resourceId: string): Promise<ResourceSummary>;
  listRevisions(resourceId: string): Promise<RevisionSummary[]>;

  /** Read content of a revision (current revision when omitted). */
  readText(resourceId: string, revisionId?: string): Promise<string>;
  readJson<T = unknown>(resourceId: string, revisionId?: string): Promise<JsonRead<T>>;

  /** Create a JSON resource and commit it to a system branch. */
  createJsonResource(req: CreateJsonResourceRequest): Promise<{ resourceId: string; revisionId: string }>;
  /** Create a new revision of an existing resource with JSON content. */
  createJsonRevision(
    resourceId: string,
    data: unknown,
    opts?: { description?: string },
  ): Promise<{ revisionId: string }>;

  listAuthSecrets(filter?: { secretType?: string }): Promise<AuthSecretSummary[]>;
  listFunctions(filter?: { name?: string; inputExtension?: string }): Promise<FunctionSummary[]>;

  createJob(req: CreateJobRequest): Promise<JobSummary>;
  getJob(jobId: string): Promise<JobSummary>;
  listJobs(filter: { resourceId?: string; createdById?: string; size?: number }): Promise<JobSummary[]>;
  cancelJob(jobId: string): Promise<void>;
  /** Artifacts produced against a resource (job outputs are attached to the job's target resource). */
  listArtifacts(resourceId: string): Promise<ArtifactSummary[]>;

  /** Deep link into the Istari web UI for a resource. */
  resourceUrl(resourceId: string): string;
  jobUrl(jobId: string): string;
}
