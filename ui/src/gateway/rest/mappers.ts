/** Pure DTO -> gateway type mappers. */
import type {
  ArtifactSummary,
  AuthSecretSummary,
  BranchSummary,
  CurrentUser,
  FunctionSummary,
  JobStatus,
  JobSummary,
  ResourceSummary,
  ResourceType,
  RevisionSummary,
  SystemSummary,
  TrackedResource,
} from '../types';
import type {
  ArtifactDto,
  FunctionVersionDto,
  JobDto,
  ResourceDto,
  ResourceRevisionDto,
  SnapshotTagDto,
  StoredCredentialDto,
  SystemDto,
  TrackedFileDto,
  UserDto,
} from './dto';

const RESOURCE_TYPES: readonly ResourceType[] = ['model', 'artifact', 'file', 'container'];

export function toResourceType(raw: string): ResourceType {
  const lower = raw.toLowerCase();
  if (lower === 'connected_container') return 'container';
  if (lower === 'connected_resource') return 'file';
  return RESOURCE_TYPES.find((t) => t === lower) ?? 'file';
}

function orUndefined<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

export function mapUser(u: UserDto): CurrentUser {
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return {
    id: u.id,
    email: orUndefined(u.email),
    displayName: u.display_name ?? (fullName || undefined) ?? orUndefined(u.user_name),
  };
}

export function mapSystem(s: SystemDto): SystemSummary {
  return { systemId: s.id, name: s.name, description: orUndefined(s.description) };
}

export function mapBranch(t: SnapshotTagDto): BranchSummary {
  return { branchId: t.id, tag: t.tag, isBaseline: t.is_baseline, snapshotId: t.snapshot_id };
}

export function mapResource(r: ResourceDto): ResourceSummary {
  return {
    resourceId: r.resource_id,
    revisionId: r.file_revision_id,
    name: r.name ?? '',
    extension: orUndefined(r.extension),
    mime: orUndefined(r.mime),
    size: orUndefined(r.size),
    resourceType: toResourceType(r.resource_type),
    description: orUndefined(r.description),
    createdById: r.created_by_id,
    created: r.created,
    updated: r.updated ?? r.created,
  };
}

export function mapTrackedResource(r: ResourceDto, tf: TrackedFileDto): TrackedResource {
  return { ...mapResource(r), path: tf.path, trackedFileId: tf.id };
}

export function mapRevision(r: ResourceRevisionDto): RevisionSummary {
  return {
    revisionId: r.file_revision_id,
    name: r.name ?? '',
    created: r.created,
    createdById: r.created_by_id,
    versionName: orUndefined(r.version_name),
    description: orUndefined(r.description),
  };
}


export function mapCredential(c: StoredCredentialDto): AuthSecretSummary {
  return {
    secretId: c.id,
    name: c.name,
    functionAuthType: c.auth_type,
    authIntegrationId: orUndefined(c.auth_integration_id),
  };
}

function pushUnique(list: string[], value: string | null | undefined): void {
  if (value && !list.includes(value)) list.push(value);
}

/** Group FunctionVersion rows (one per function x tool-version x OS set) into one summary per function. */
export function groupFunctions(rows: FunctionVersionDto[]): FunctionSummary[] {
  const byKey = new Map<string, FunctionSummary>();
  for (const f of rows) {
    const key = `${f.module_name}\u0000${f.name}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        name: f.name,
        moduleName: f.module_name,
        displayName: orUndefined(f.tool_display_name),
        versions: [],
        toolName: orUndefined(f.tool_name),
        toolVersions: [],
        operatingSystems: [],
      };
      byKey.set(key, entry);
    }
    pushUnique(entry.versions, f.version);
    for (const tv of f.tool_versions ?? []) pushUnique(entry.toolVersions ?? [], tv.tool_version);
    for (const os of f.operating_systems ?? []) pushUnique(entry.operatingSystems ?? [], os.name);
  }
  return [...byKey.values()];
}

const JOB_STATUSES: readonly JobStatus[] = [
  'Created',
  'Pending',
  'Claimed',
  'Validating',
  'Running',
  'Uploading',
  'Completed',
  'Failed',
  'Canceled',
  'Unknown',
];

export function toJobStatus(raw: string | undefined): JobStatus {
  return JOB_STATUSES.find((s) => s === raw) ?? 'Unknown';
}

export function mapJob(j: JobDto): JobSummary {
  const history = [...j.status_history].sort((a, b) => a.created.localeCompare(b.created));
  const last = history.at(-1);
  return {
    jobId: j.id,
    resourceId: j.model_id ?? '',
    functionName: j.function.name,
    functionVersion: j.function.version,
    status: toJobStatus(last?.name),
    statusMessage: orUndefined(last?.message),
    createdById: j.created_by_id,
    created: j.created,
    updated: last?.created,
  };
}

export function mapArtifact(a: ArtifactDto): ArtifactSummary | undefined {
  const rev = [...a.file.revisions].sort((x, y) => x.created.localeCompare(y.created)).at(-1);
  if (!rev) return undefined;
  return {
    resourceId: a.id,
    revisionId: rev.id,
    name: rev.name ?? '',
    extension: orUndefined(rev.extension),
    mime: orUndefined(rev.mime),
    size: orUndefined(rev.size),
    created: a.created,
  };
}
