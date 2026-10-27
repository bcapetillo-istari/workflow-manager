/**
 * RestGateway: IstariGateway over the registry REST API (v2 + v3) using plain fetch.
 * See README.md in this folder for the endpoint map and the upload / commit recipes.
 */
import {
  GatewayError,
  type ArtifactSummary,
  type AuthSecretSummary,
  type BranchSummary,
  type CreateJobRequest,
  type CreateJsonResourceRequest,
  type CurrentUser,
  type FunctionSummary,
  type IstariGateway,
  type JobSummary,
  type JsonRead,
  type ResourceSearch,
  type ResourceSummary,
  type RevisionSummary,
  type SystemSummary,
  type TrackedResource,
} from '../types';
import { commitFileToBranch, listBranches, listTrackedFiles, resolveBranch } from './branches';
import type {
  ArtifactDto,
  FunctionVersionDto,
  JobDto,
  ResourceDto,
  ResourceRevisionDto,
  StoredCredentialDto,
  SystemDto,
  TrackedFileDto,
  UserDto,
} from './dto';
import { HttpClient, type CursorPage, type Query } from './http';
import { buildJobBody, buildJobQuery } from './jobBody';
import {
  groupFunctions,
  mapArtifact,
  mapBranch,
  mapCredential,
  mapJob,
  mapResource,
  mapRevision,
  mapSystem,
  mapTrackedResource,
  mapUser,
} from './mappers';
import {
  decodeUtf8,
  downloadBlob,
  encodeUtf8,
  uploadBlob,
  type StorageToken,
  type UploadedBlob,
  type UrlRewrite,
} from './storage';

export interface RestGatewayOptions {
  registryUrl: string;
  istariWebUrl: string;
  getToken: () => string | null;
  /**
   * Rewrite presigned object-store URLs before fetching them. Development only: the bucket's CORS
   * allowlist does not include localhost, so the dev server proxies these requests. Leave unset in production.
   */
  rewriteObjectStoreUrl?: UrlRewrite;
}

const JSON_MIME = 'application/json';
const DEFAULT_SEARCH_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function ensureJsonName(name: string): string {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function tokenBody(token: StorageToken): { sha: string; salt: string } {
  return { sha: token.sha, salt: token.salt };
}

export class RestGateway implements IstariGateway {
  private readonly http: HttpClient;
  private readonly webUrl: string;
  private readonly rewriteUrl: UrlRewrite | undefined;

  constructor(opts: RestGatewayOptions) {
    this.http = new HttpClient({ registryUrl: opts.registryUrl, getToken: opts.getToken });
    this.webUrl = opts.istariWebUrl.replace(/\/+$/, '');
    this.rewriteUrl = opts.rewriteObjectStoreUrl;
  }

  // ---------------------------------------------------------------- users

  async currentUser(): Promise<CurrentUser> {
    return mapUser(await this.http.get<UserDto>('/v2/users/me'));
  }

  // -------------------------------------------------------------- systems

  async listSystems(query?: { name?: string; size?: number }): Promise<SystemSummary[]> {
    const size = Math.min(query?.size ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const page = await this.http.get<{ items: SystemDto[] }>('/v2/systems', {
      name: query?.name,
      size,
      include_total: false,
      sort: '-created',
    });
    return page.items.map(mapSystem);
  }

  async getSystem(systemId: string): Promise<SystemSummary> {
    return mapSystem(await this.http.get<SystemDto>(`/v2/systems/${systemId}`));
  }

  async listBranches(systemId: string): Promise<BranchSummary[]> {
    return (await listBranches(this.http, systemId)).map(mapBranch);
  }

  async listTrackedResources(systemId: string, branchId?: string): Promise<TrackedResource[]> {
    const branch = await resolveBranch(this.http, systemId, branchId);
    const tracked = await listTrackedFiles(this.http, branch.snapshotId);
    const byResourceId = new Map<string, TrackedFileDto>();
    for (const tf of tracked) if (tf.resource_id) byResourceId.set(tf.resource_id, tf);
    if (byResourceId.size === 0) return [];

    const resources: ResourceDto[] = [];
    for (const ids of chunk([...byResourceId.keys()], 50)) {
      resources.push(
        ...(await this.http.getAllCursorPages<ResourceDto>('/v3/resources', { resource_id: ids })),
      );
    }
    const out: TrackedResource[] = [];
    for (const r of resources) {
      const tf = byResourceId.get(r.resource_id);
      if (tf) out.push(mapTrackedResource(r, tf));
    }
    return out;
  }

  // ------------------------------------------------------------ resources

  async searchResources(query: ResourceSearch): Promise<ResourceSummary[]> {
    const size = Math.min(query.size ?? DEFAULT_SEARCH_SIZE, MAX_PAGE_SIZE);
    const exts = query.extensions?.map((e) => e.replace(/^\./, '').toLowerCase());
    const matches = (r: ResourceSummary): boolean =>
      (!exts || exts.includes((r.extension ?? '').toLowerCase())) &&
      (!query.resourceTypes || query.resourceTypes.includes(r.resourceType)) &&
      (!query.name || r.name.toLowerCase().includes(query.name.toLowerCase()));

    if (query.systemId) {
      // v3 /resources has no system filter: scope via the system's baseline tracked files.
      const tracked = await this.listTrackedResources(query.systemId);
      return tracked.filter(matches).slice(0, size);
    }
    const params: Query = {
      size: exts ? MAX_PAGE_SIZE : size,
      include_total: false,
      own_files_first: true,
      type_name: query.resourceTypes,
    };
    if (query.name) {
      // name__contains needs >= 3 chars; fall back to exact name match for shorter inputs.
      if (query.name.length >= 3) params.name__contains = [query.name];
      else params.name = [query.name];
    }
    const page = await this.http.get<CursorPage<ResourceDto>>('/v3/resources', params);
    const mapped = page.items.map(mapResource);
    return (exts ? mapped.filter(matches) : mapped).slice(0, size);
  }

  async getResource(resourceId: string): Promise<ResourceSummary> {
    return mapResource(await this.fetchResource(resourceId));
  }

  async listRevisions(resourceId: string): Promise<RevisionSummary[]> {
    const rows = await this.http.getAllCursorPages<ResourceRevisionDto>(
      `/v3/resources/${resourceId}/revisions`,
    );
    return rows.map(mapRevision).sort((a, b) => b.created.localeCompare(a.created));
  }

  // -------------------------------------------------------------- content

  async readText(resourceId: string, revisionId?: string): Promise<string> {
    const { token } = await this.resolveContent(resourceId, revisionId);
    return decodeUtf8(await downloadBlob(this.http, token, this.rewriteUrl));
  }

  async readJson<T = unknown>(resourceId: string, revisionId?: string): Promise<JsonRead<T>> {
    const { token, revisionId: actual } = await this.resolveContent(resourceId, revisionId);
    const text = decodeUtf8(await downloadBlob(this.http, token, this.rewriteUrl));
    try {
      return { data: JSON.parse(text) as T, revisionId: actual };
    } catch (cause) {
      throw new GatewayError(`Resource ${resourceId} revision ${actual} is not valid JSON`, { cause });
    }
  }

  async createJsonResource(
    req: CreateJsonResourceRequest,
  ): Promise<{ resourceId: string; revisionId: string }> {
    const name = ensureJsonName(req.name);
    const branch = await resolveBranch(this.http, req.systemId, req.branchId);
    const blob = await this.uploadJson(name, req.data, req.description);
    const created = await this.http.post<ResourceDto>('/v3/resources', {
      resource_type: req.resourceType ?? 'artifact',
      ...this.revisionBody(blob),
    });
    await commitFileToBranch(this.http, req.systemId, branch, created.file_id, `Add ${name}`);
    return { resourceId: created.resource_id, revisionId: created.file_revision_id };
  }

  async createJsonRevision(
    resourceId: string,
    data: unknown,
    opts?: { description?: string },
  ): Promise<{ revisionId: string }> {
    const current = await this.fetchResource(resourceId);
    const name = ensureJsonName(current.name ?? `${resourceId}.json`);
    const blob = await this.uploadJson(name, data, opts?.description ?? current.description);
    const rev = await this.http.post<ResourceRevisionDto>(
      `/v3/resources/${resourceId}/revisions`,
      this.revisionBody(blob),
    );
    return { revisionId: rev.file_revision_id };
  }

  // -------------------------------------------------- secrets & functions

  async listAuthSecrets(filter?: { secretType?: string }): Promise<AuthSecretSummary[]> {
    const rows = await this.http.get<StoredCredentialDto[]>('/v2/credentials');
    const wanted = filter?.secretType?.toLowerCase();
    return rows.filter((c) => !wanted || c.auth_type.toLowerCase() === wanted).map(mapCredential);
  }

  async listFunctions(filter?: { name?: string; inputExtension?: string }): Promise<FunctionSummary[]> {
    const rows = await this.http.getAllPages<FunctionVersionDto>(
      '/v2/modules/versions/functions',
      { name: filter?.name, input_extension: filter?.inputExtension, status: 'supported' },
      10,
    );
    return groupFunctions(rows);
  }

  // ----------------------------------------------------------------- jobs

  async createJob(req: CreateJobRequest): Promise<JobSummary> {
    const params = await this.uploadJson('parameters.json', req.parameters);
    const body = buildJobBody(req, params);
    const job = await this.http.post<JobDto>(`/v2/models/${req.resourceId}/jobs`, body, buildJobQuery(req));
    return mapJob(job);
  }

  async getJob(jobId: string): Promise<JobSummary> {
    return mapJob(await this.http.get<JobDto>(`/v2/jobs/${jobId}`));
  }

  async listJobs(filter: {
    resourceId?: string;
    createdById?: string;
    size?: number;
  }): Promise<JobSummary[]> {
    const size = Math.min(filter.size ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const page = await this.http.get<{ items: JobDto[] }>('/v2/jobs', {
      model_id: filter.resourceId,
      size,
      sort: '-created',
    });
    const jobs = page.items.map(mapJob);
    return filter.createdById ? jobs.filter((j) => j.createdById === filter.createdById) : jobs;
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.http.put(
      `/v2/jobs/${jobId}/status`,
      { message: 'Canceled by Workflow Manager' },
      {
        status_name: 'Canceled',
      },
    );
  }

  async listArtifacts(resourceId: string): Promise<ArtifactSummary[]> {
    const rows = await this.http.getAllPages<ArtifactDto>(`/v2/models/${resourceId}/artifacts`, {
      sort: '-created',
    });
    return rows.map(mapArtifact).filter((a): a is ArtifactSummary => a !== undefined);
  }

  // ---------------------------------------------------------------- links

  resourceUrl(resourceId: string): string {
    return `${this.webUrl}/resources/${resourceId}`;
  }

  jobUrl(jobId: string): string {
    return `${this.webUrl}/jobs/${jobId}`;
  }

  // -------------------------------------------------------------- helpers

  private fetchResource(resourceId: string): Promise<ResourceDto> {
    return this.http.get<ResourceDto>(`/v3/resources/${resourceId}`);
  }

  /** Content token of a specific revision, or of the resource's current revision when omitted. */
  private async resolveContent(
    resourceId: string,
    revisionId?: string,
  ): Promise<{ token: StorageToken; revisionId: string }> {
    if (revisionId) {
      const rev = await this.http.get<ResourceRevisionDto>(
        `/v3/resources/${resourceId}/revisions/${revisionId}`,
      );
      return { token: rev.content_token, revisionId: rev.file_revision_id };
    }
    const res = await this.fetchResource(resourceId);
    return { token: res.content_token, revisionId: res.file_revision_id };
  }

  private uploadJson(fileName: string, data: unknown, description?: string | null): Promise<UploadedBlob> {
    const bytes = encodeUtf8(JSON.stringify(data, null, 2));
    return uploadBlob(this.http, bytes, { fileName, extension: 'json', mime: JSON_MIME, description }, this.rewriteUrl);
  }

  /** Shared fields of ResourceCreateDto / ResourceRevisionCreateDto. */
  private revisionBody(blob: UploadedBlob): Record<string, unknown> {
    return {
      content_token: tokenBody(blob.contentToken),
      properties_token: tokenBody(blob.propertiesToken),
      name: blob.fileName,
      extension: blob.extension,
      size: blob.size,
      mime: blob.mime,
      description: blob.description ?? null,
    };
  }
}
