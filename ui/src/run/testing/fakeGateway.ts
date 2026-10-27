/**
 * In-memory IstariGateway for tests. Resources hold a revision history of JSON data; jobs can be
 * driven through statuses with setJobStatus(); writeModuleUpdate() simulates a module writing its
 * stage's outputs/progress into a run document. Every call is recorded in `calls`.
 */
import type {
  ArtifactSummary,
  AuthSecretSummary,
  BranchSummary,
  CreateJobRequest,
  CreateJsonResourceRequest,
  CurrentUser,
  FunctionSummary,
  IstariGateway,
  JobStatus,
  JobSummary,
  JsonRead,
  ResourceSearch,
  ResourceSummary,
  RevisionSummary,
  SystemSummary,
  TrackedResource,
} from '../../gateway/types';
import { GatewayError } from '../../gateway/types';
import type { ProgressEntry, RunDocument } from '../types';

interface StoredRevision {
  revisionId: string;
  data: unknown;
  created: string;
}
interface StoredResource {
  summary: ResourceSummary;
  systemId?: string;
  revisions: StoredRevision[];
}

export interface FakeGateway extends IstariGateway {
  readonly calls: Array<{ method: keyof IstariGateway; args: unknown[] }>;
  user: CurrentUser;
  setJobStatus(jobId: string, status: JobStatus, statusMessage?: string): void;
  writeModuleUpdate(
    resourceId: string,
    stageKey: string,
    update: { outputs?: Record<string, unknown>; progress?: ProgressEntry[] },
  ): void;
  peekJson<T = unknown>(resourceId: string): T;
  revisionCount(resourceId: string): number;
  /** Make the next call to `method` reject with `error`. */
  failNext(method: keyof IstariGateway, error: Error): void;
  seedJsonResource(req: CreateJsonResourceRequest & { createdById?: string; updated?: string }): {
    resourceId: string;
    revisionId: string;
  };
  /** The full request a job was created with (including sources and authBindings). */
  jobRequest(jobId: string): CreateJobRequest;
  /** Attach an artifact to a resource so listArtifacts(resourceId) returns it. */
  seedArtifact(resourceId: string, artifact: Partial<ArtifactSummary> & { name: string }): ArtifactSummary;
}

export function createFakeGateway(user: CurrentUser = { id: 'user-1', email: 'u@example.com' }): FakeGateway {
  const resources = new Map<string, StoredResource>();
  const jobs = new Map<string, JobSummary>();
  const jobRequests = new Map<string, CreateJobRequest>();
  const artifacts = new Map<string, ArtifactSummary[]>();
  const failures = new Map<keyof IstariGateway, Error>();
  const calls: FakeGateway['calls'] = [];
  const counters = new Map<string, number>();
  let tick = 0;
  const nextId = (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}-${n}`;
  };
  const now = () => new Date(Date.UTC(2026, 9, 23, 0, 0, ++tick)).toISOString();

  function record(method: keyof IstariGateway, ...args: unknown[]): void {
    calls.push({ method, args });
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
  }

  function getResource(resourceId: string): StoredResource {
    const r = resources.get(resourceId);
    if (!r) throw new GatewayError(`resource ${resourceId} not found`, { status: 404 });
    return r;
  }

  function addRevision(res: StoredResource, data: unknown): StoredRevision {
    const rev: StoredRevision = { revisionId: nextId('rev'), data: structuredClone(data), created: now() };
    res.revisions.push(rev);
    res.summary = { ...res.summary, revisionId: rev.revisionId, updated: rev.created };
    return rev;
  }

  function seed(req: CreateJsonResourceRequest & { createdById?: string; updated?: string }) {
    const resourceId = nextId('res');
    const created = now();
    const res: StoredResource = {
      systemId: req.systemId,
      revisions: [],
      summary: {
        resourceId,
        revisionId: '',
        name: req.name,
        extension: 'json',
        mime: 'application/json',
        resourceType: req.resourceType ?? 'artifact',
        description: req.description,
        createdById: req.createdById ?? user.id,
        created,
        updated: created,
      },
    };
    const rev = addRevision(res, req.data);
    if (req.updated) res.summary = { ...res.summary, updated: req.updated };
    resources.set(resourceId, res);
    return { resourceId, revisionId: rev.revisionId };
  }

  const gateway: FakeGateway = {
    calls,
    user,

    async currentUser() {
      record('currentUser');
      return gateway.user;
    },
    async listSystems(): Promise<SystemSummary[]> {
      record('listSystems');
      return [];
    },
    async getSystem(systemId): Promise<SystemSummary> {
      record('getSystem', systemId);
      return { systemId, name: systemId };
    },
    async listBranches(systemId): Promise<BranchSummary[]> {
      record('listBranches', systemId);
      return [{ branchId: 'main', tag: 'main', isBaseline: true, snapshotId: 'snap' }];
    },
    async listTrackedResources(systemId, branchId): Promise<TrackedResource[]> {
      record('listTrackedResources', systemId, branchId);
      return [...resources.values()]
        .filter((r) => r.systemId === systemId)
        .map((r) => ({ ...r.summary, path: r.summary.name, trackedFileId: `tf-${r.summary.resourceId}` }));
    },
    async searchResources(query: ResourceSearch): Promise<ResourceSummary[]> {
      record('searchResources', query);
      return [...resources.values()].map((r) => r.summary);
    },
    async getResource(resourceId) {
      record('getResource', resourceId);
      return getResource(resourceId).summary;
    },
    async listRevisions(resourceId): Promise<RevisionSummary[]> {
      record('listRevisions', resourceId);
      const res = getResource(resourceId);
      return res.revisions.map((r) => ({
        revisionId: r.revisionId,
        name: res.summary.name,
        created: r.created,
        createdById: res.summary.createdById,
      }));
    },
    async readText(resourceId, revisionId) {
      record('readText', resourceId, revisionId);
      return JSON.stringify((await gateway.readJson(resourceId, revisionId)).data);
    },
    async readJson<T = unknown>(resourceId: string, revisionId?: string): Promise<JsonRead<T>> {
      record('readJson', resourceId, revisionId);
      const res = getResource(resourceId);
      const rev = revisionId ? res.revisions.find((r) => r.revisionId === revisionId) : res.revisions.at(-1);
      if (!rev) throw new GatewayError(`revision ${revisionId} not found`, { status: 404 });
      return { data: structuredClone(rev.data) as T, revisionId: rev.revisionId };
    },
    async createJsonResource(req) {
      record('createJsonResource', req);
      return seed(req);
    },
    async createJsonRevision(resourceId, data, opts) {
      record('createJsonRevision', resourceId, data, opts);
      return { revisionId: addRevision(getResource(resourceId), data).revisionId };
    },
    async listAuthSecrets(): Promise<AuthSecretSummary[]> {
      record('listAuthSecrets');
      return [];
    },
    async listFunctions(): Promise<FunctionSummary[]> {
      record('listFunctions');
      return [];
    },
    async createJob(req: CreateJobRequest) {
      record('createJob', req);
      const job: JobSummary = {
        jobId: nextId('job'),
        resourceId: req.resourceId,
        functionName: req.functionName,
        functionVersion: req.functionVersion,
        status: 'Created',
        createdById: gateway.user.id,
        created: now(),
      };
      jobs.set(job.jobId, job);
      jobRequests.set(job.jobId, structuredClone(req));
      return { ...job };
    },
    async getJob(jobId) {
      record('getJob', jobId);
      const job = jobs.get(jobId);
      if (!job) throw new GatewayError(`job ${jobId} not found`, { status: 404 });
      return { ...job };
    },
    async listJobs() {
      record('listJobs');
      return [...jobs.values()];
    },
    async cancelJob(jobId) {
      record('cancelJob', jobId);
      gateway.setJobStatus(jobId, 'Canceled');
    },
    async listArtifacts(resourceId): Promise<ArtifactSummary[]> {
      record('listArtifacts', resourceId);
      return structuredClone(artifacts.get(resourceId) ?? []);
    },
    resourceUrl: (resourceId) => `https://istari.test/resources/${resourceId}`,
    jobUrl: (jobId) => `https://istari.test/jobs/${jobId}`,

    setJobStatus(jobId, status, statusMessage) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`fake: job ${jobId} not found`);
      jobs.set(jobId, { ...job, status, statusMessage, updated: now() });
    },
    writeModuleUpdate(resourceId, stageKey, update) {
      const res = getResource(resourceId);
      const doc = structuredClone(res.revisions.at(-1)?.data) as RunDocument;
      const stage = doc.stages[stageKey];
      if (!stage) throw new Error(`fake: stage ${stageKey} not in run`);
      doc.stages[stageKey] = { ...stage, ...update };
      addRevision(res, doc);
    },
    peekJson<T>(resourceId: string): T {
      return structuredClone(getResource(resourceId).revisions.at(-1)?.data) as T;
    },
    revisionCount: (resourceId) => getResource(resourceId).revisions.length,
    failNext: (method, error) => void failures.set(method, error),
    seedJsonResource: seed,
    jobRequest(jobId) {
      const req = jobRequests.get(jobId);
      if (!req) throw new Error(`fake: job ${jobId} not found`);
      return structuredClone(req);
    },
    seedArtifact(resourceId, artifact) {
      const full: ArtifactSummary = {
        resourceId: nextId('art'),
        revisionId: nextId('artrev'),
        created: now(),
        ...artifact,
      };
      artifacts.set(resourceId, [...(artifacts.get(resourceId) ?? []), full]);
      return full;
    },
  };
  return gateway;
}
