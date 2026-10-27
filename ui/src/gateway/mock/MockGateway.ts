/**
 * In-memory IstariGateway for development (`?mock=1`) and tests. Seeded with two systems, sample
 * documents, two LLM credentials and three manifests (two valid, one invalid). Jobs advance
 * Pending -> Running -> Completed on successive getJob calls; on completion the mock plays the
 * module's part and writes outputs + progress into the run document that references the job.
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
} from '../types';
import { GatewayError } from '../types';
import type { ManifestOutput, WorkflowManifest } from '../../manifest/types';
import type { RunDocument } from '../../run/types';
import { brokenManifest, docReviewManifest, smartDiffManifest } from './manifests';

export interface MockGatewayOptions {
  workflowManagerSystemId: string;
  workflowManagerRunsSystemId: string;
  istariWebUrl?: string;
  /** Simulated network latency per call. */
  latencyMs?: number;
  /** Seed the two workflow systems with the example manifests and sample documents (default true). */
  seed?: boolean;
}

interface StoredRevision {
  summary: RevisionSummary;
  json?: unknown;
  text?: string;
}

interface StoredResource {
  summary: ResourceSummary;
  revisions: StoredRevision[];
  systemId?: string;
  branchId?: string;
}

const USER: CurrentUser = { id: 'user-dev-0001', email: 'dev.user@example.com', displayName: 'Dev User' };
const JOB_SEQUENCE: JobStatus[] = ['Pending', 'Running', 'Completed'];

export class MockGateway implements IstariGateway {
  readonly user: CurrentUser = USER;
  private readonly opts: Required<Omit<MockGatewayOptions, 'seed'>>;
  private readonly systems = new Map<string, SystemSummary>();
  private readonly branches = new Map<string, BranchSummary[]>();
  private readonly resources = new Map<string, StoredResource>();
  private readonly artifacts = new Map<string, ArtifactSummary[]>();
  private readonly jobs = new Map<string, JobSummary>();
  private readonly secrets: AuthSecretSummary[] = [];
  private readonly functions: FunctionSummary[] = [];
  /** Tests can force the next matching call to fail. */
  failNext: { method: keyof IstariGateway; error: GatewayError } | null = null;
  private counter = 0;

  constructor(options: MockGatewayOptions) {
    this.opts = {
      workflowManagerSystemId: options.workflowManagerSystemId,
      workflowManagerRunsSystemId: options.workflowManagerRunsSystemId,
      istariWebUrl: options.istariWebUrl ?? 'https://istari.example.test',
      latencyMs: options.latencyMs ?? 0,
    };
    if (options.seed !== false) this.seed();
  }

  /* ---------------- IstariGateway ---------------- */

  async currentUser(): Promise<CurrentUser> {
    await this.tick('currentUser');
    return this.user;
  }

  async listSystems(query?: { name?: string; size?: number }): Promise<SystemSummary[]> {
    await this.tick('listSystems');
    const term = query?.name?.toLowerCase();
    return [...this.systems.values()]
      .filter((s) => !term || s.name.toLowerCase().includes(term))
      .slice(0, query?.size ?? 50);
  }

  async getSystem(systemId: string): Promise<SystemSummary> {
    await this.tick('getSystem');
    const system = this.systems.get(systemId);
    if (!system) throw new GatewayError(`System ${systemId} not found`, { status: 404 });
    return system;
  }

  async listBranches(systemId: string): Promise<BranchSummary[]> {
    await this.tick('listBranches');
    await this.getSystem(systemId);
    return this.branches.get(systemId) ?? [];
  }

  async listTrackedResources(systemId: string, branchId?: string): Promise<TrackedResource[]> {
    await this.tick('listTrackedResources');
    await this.getSystem(systemId);
    return [...this.resources.values()]
      .filter((r) => r.systemId === systemId && (!branchId || r.branchId === branchId))
      .map((r) => ({ ...r.summary, path: r.summary.name, trackedFileId: `tf-${r.summary.resourceId}` }));
  }

  async searchResources(query: ResourceSearch): Promise<ResourceSummary[]> {
    await this.tick('searchResources');
    const term = query.name?.toLowerCase();
    const exts = query.extensions?.map((e) => e.toLowerCase().replace(/^\./, ''));
    return [...this.resources.values()]
      .filter((r) => !query.systemId || r.systemId === query.systemId)
      .filter((r) => !exts || (r.summary.extension !== undefined && exts.includes(r.summary.extension)))
      .filter((r) => !query.resourceTypes || query.resourceTypes.includes(r.summary.resourceType))
      .filter((r) => !term || r.summary.name.toLowerCase().includes(term))
      .map((r) => r.summary)
      .slice(0, query.size ?? 25);
  }

  async getResource(resourceId: string): Promise<ResourceSummary> {
    await this.tick('getResource');
    return this.stored(resourceId).summary;
  }

  async listRevisions(resourceId: string): Promise<RevisionSummary[]> {
    await this.tick('listRevisions');
    return this.stored(resourceId).revisions.map((r) => r.summary);
  }

  async readText(resourceId: string, revisionId?: string): Promise<string> {
    await this.tick('readText');
    const rev = this.revision(resourceId, revisionId);
    return rev.text ?? JSON.stringify(rev.json ?? null, null, 2);
  }

  async readJson<T = unknown>(resourceId: string, revisionId?: string): Promise<JsonRead<T>> {
    await this.tick('readJson');
    const rev = this.revision(resourceId, revisionId);
    if (rev.json === undefined) {
      try {
        rev.json = JSON.parse(rev.text ?? '');
      } catch (cause) {
        throw new GatewayError(`Resource ${resourceId} is not JSON`, { status: 422, cause });
      }
    }
    return { data: structuredClone(rev.json) as T, revisionId: rev.summary.revisionId };
  }

  async createJsonResource(
    req: CreateJsonResourceRequest,
  ): Promise<{ resourceId: string; revisionId: string }> {
    await this.tick('createJsonResource');
    await this.getSystem(req.systemId);
    const branch = req.branchId ?? this.branches.get(req.systemId)?.find((b) => b.isBaseline)?.branchId;
    const resource = this.addResource({
      name: req.name,
      extension: 'json',
      mime: 'application/json',
      resourceType: req.resourceType ?? 'artifact',
      description: req.description,
      systemId: req.systemId,
      branchId: branch,
      json: structuredClone(req.data),
    });
    return { resourceId: resource.summary.resourceId, revisionId: resource.summary.revisionId };
  }

  async createJsonRevision(
    resourceId: string,
    data: unknown,
    opts?: { description?: string },
  ): Promise<{ revisionId: string }> {
    await this.tick('createJsonRevision');
    const stored = this.stored(resourceId);
    const revisionId = this.id('rev');
    stored.revisions.push({
      summary: {
        revisionId,
        name: stored.summary.name,
        created: now(),
        createdById: USER.id,
        description: opts?.description,
      },
      json: structuredClone(data),
    });
    stored.summary.revisionId = revisionId;
    stored.summary.updated = now();
    return { revisionId };
  }

  async listAuthSecrets(filter?: { secretType?: string }): Promise<AuthSecretSummary[]> {
    await this.tick('listAuthSecrets');
    return this.secrets.filter((s) => !filter?.secretType || s.functionAuthType === filter.secretType);
  }

  async listFunctions(filter?: { name?: string; inputExtension?: string }): Promise<FunctionSummary[]> {
    await this.tick('listFunctions');
    return this.functions.filter((f) => !filter?.name || f.name.includes(filter.name));
  }

  async createJob(req: CreateJobRequest): Promise<JobSummary> {
    await this.tick('createJob');
    this.stored(req.resourceId);
    const job: JobSummary = {
      jobId: this.id('job'),
      resourceId: req.resourceId,
      functionName: req.functionName,
      functionVersion: req.functionVersion,
      status: 'Pending',
      createdById: USER.id,
      created: now(),
      updated: now(),
    };
    this.jobs.set(job.jobId, job);
    return { ...job };
  }

  async getJob(jobId: string): Promise<JobSummary> {
    await this.tick('getJob');
    const job = this.jobs.get(jobId);
    if (!job) throw new GatewayError(`Job ${jobId} not found`, { status: 404 });
    const idx = JOB_SEQUENCE.indexOf(job.status);
    if (idx >= 0 && idx < JOB_SEQUENCE.length - 1) {
      job.status = JOB_SEQUENCE[idx + 1] ?? job.status;
      job.updated = now();
      if (job.status === 'Running') this.writeProgress(job, 'Comparing documents', 40);
      if (job.status === 'Completed') this.completeJob(job);
    }
    return { ...job };
  }

  async listJobs(filter: {
    resourceId?: string;
    createdById?: string;
    size?: number;
  }): Promise<JobSummary[]> {
    await this.tick('listJobs');
    return [...this.jobs.values()]
      .filter((j) => !filter.resourceId || j.resourceId === filter.resourceId)
      .filter((j) => !filter.createdById || j.createdById === filter.createdById)
      .slice(0, filter.size ?? 50)
      .map((j) => ({ ...j }));
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.tick('cancelJob');
    const job = this.jobs.get(jobId);
    if (!job) throw new GatewayError(`Job ${jobId} not found`, { status: 404 });
    job.status = 'Canceled';
    job.updated = now();
  }

  async listArtifacts(resourceId: string): Promise<ArtifactSummary[]> {
    await this.tick('listArtifacts');
    return [...(this.artifacts.get(resourceId) ?? [])];
  }

  resourceUrl(resourceId: string): string {
    return `${this.opts.istariWebUrl}/resources/${resourceId}`;
  }

  jobUrl(jobId: string): string {
    return `${this.opts.istariWebUrl}/jobs/${jobId}`;
  }

  /* ---------------- Seeding helpers (public for tests) ---------------- */

  addSystem(system: SystemSummary): void {
    this.systems.set(system.systemId, system);
    this.branches.set(system.systemId, [
      { branchId: `br-${system.systemId}-main`, tag: 'main', isBaseline: true, snapshotId: this.id('snap') },
      { branchId: `br-${system.systemId}-dev`, tag: 'dev', isBaseline: false, snapshotId: this.id('snap') },
    ]);
  }

  addResource(spec: {
    name: string;
    extension?: string;
    mime?: string;
    resourceType?: ResourceSummary['resourceType'];
    description?: string;
    systemId?: string;
    branchId?: string;
    json?: unknown;
    text?: string;
    revisions?: number;
  }): StoredResource {
    const resourceId = this.id('res');
    const count = Math.max(1, spec.revisions ?? 1);
    const revisions: StoredRevision[] = [];
    for (let i = 0; i < count; i += 1) {
      revisions.push({
        summary: {
          revisionId: this.id('rev'),
          name: spec.name,
          created: now(-(count - i) * 86_400_000),
          createdById: USER.id,
          versionName: `v${i + 1}`,
        },
        json: spec.json,
        text: spec.text,
      });
    }
    const current = revisions[revisions.length - 1]!;
    const stored: StoredResource = {
      summary: {
        resourceId,
        revisionId: current.summary.revisionId,
        name: spec.name,
        extension: spec.extension,
        mime: spec.mime,
        size: spec.text?.length ?? 4096,
        resourceType: spec.resourceType ?? 'file',
        description: spec.description,
        createdById: USER.id,
        created: revisions[0]!.summary.created,
        updated: current.summary.created,
      },
      revisions,
      systemId: spec.systemId,
      branchId: spec.branchId ?? (spec.systemId ? `br-${spec.systemId}-main` : undefined),
    };
    this.resources.set(resourceId, stored);
    return stored;
  }

  /* ---------------- Internals ---------------- */

  private seed(): void {
    const { workflowManagerSystemId: wm, workflowManagerRunsSystemId: runs } = this.opts;
    this.addSystem({ systemId: wm, name: 'workflow-manager', description: 'Workflow manifests' });
    this.addSystem({ systemId: runs, name: 'workflow-manager-runs', description: 'Run documents' });
    const program = 'sys-avionics-program';
    this.addSystem({ systemId: program, name: 'Avionics Program', description: 'Sample documents' });

    const manifestFile = (name: string, json: unknown) =>
      this.addResource({
        name,
        extension: 'json',
        mime: 'application/json',
        systemId: wm,
        json,
        resourceType: 'artifact',
      });
    manifestFile('smart-diff.json', smartDiffManifest);
    manifestFile('doc-review.json', docReviewManifest);
    manifestFile('broken-workflow.json', brokenManifest);
    this.addResource({ name: 'README.md', extension: 'md', systemId: wm, text: '# Workflow manifests' });

    const doc = (name: string, extension: string, revisions = 1) =>
      this.addResource({ name, extension, systemId: program, revisions, description: `${name} sample` });
    doc('ICD-Flight-Control-Rev-B.pdf', 'pdf', 3);
    doc('ICD-Flight-Control-Rev-C.pdf', 'pdf');
    doc('Requirements-Baseline.docx', 'docx', 2);
    doc('Power-Budget.xlsx', 'xlsx');
    doc('Release-Notes.txt', 'txt');
    doc('Wiring-Harness.step', 'step');

    this.secrets.push(
      {
        secretId: 'sec-openai',
        name: 'OpenAI (team key)',
        functionAuthType: '@token:llm',
        provider: 'openai',
      },
      {
        secretId: 'sec-claude',
        name: 'Anthropic (personal)',
        functionAuthType: '@token:llm',
        provider: 'claude',
      },
      { secretId: 'sec-github', name: 'GitHub', functionAuthType: '@token:git', provider: 'github' },
    );
    this.functions.push(
      {
        name: '@istari_utils:smart_diff',
        moduleName: 'istari_utils',
        displayName: 'Smart Diff',
        versions: ['1.0.2', '1.0.1'],
      },
      {
        name: '@istari_utils:resolve_conflicts',
        moduleName: 'istari_utils',
        displayName: 'Resolve conflicts',
        versions: ['0.1.0'],
      },
    );
  }

  /** Locate the run document and stage referencing this job. */
  private findRunStage(
    jobId: string,
  ): { resource: StoredResource; run: RunDocument; stageKey: string } | null {
    for (const resource of this.resources.values()) {
      if (resource.systemId !== this.opts.workflowManagerRunsSystemId) continue;
      const run = resource.revisions[resource.revisions.length - 1]?.json as RunDocument | undefined;
      if (!run || typeof run !== 'object' || !run.stages) continue;
      const stageKey = Object.keys(run.stages).find((k) => run.stages[k]?.job_id === jobId);
      if (stageKey) return { resource, run: structuredClone(run), stageKey };
    }
    return null;
  }

  private writeProgress(job: JobSummary, message: string, percent: number): void {
    const found = this.findRunStage(job.jobId);
    if (!found) return;
    const stage = found.run.stages[found.stageKey]!;
    stage.progress = [...(stage.progress ?? []), { at: now(), message, percent }];
    this.commitRun(found.resource, found.run, `progress: ${message}`);
  }

  private completeJob(job: JobSummary): void {
    const found = this.findRunStage(job.jobId);
    if (!found) return;
    const { resource, run, stageKey } = found;
    const stage = run.stages[stageKey]!;
    const declared = this.declaredOutputs(run, stageKey);
    const outputs: Record<string, unknown> = {};
    for (const out of declared) outputs[out.key] = this.fabricateOutput(out, job);
    stage.outputs = outputs;
    stage.progress = [...(stage.progress ?? []), { at: now(), message: 'Finished', percent: 100 }];
    this.commitRun(resource, run, 'module finished');
  }

  private declaredOutputs(run: RunDocument, stageKey: string): ManifestOutput[] {
    const manifestRes = this.resources.get(run.manifest_resource_id);
    const manifest = manifestRes?.revisions[manifestRes.revisions.length - 1]?.json as
      WorkflowManifest | undefined;
    const declared = manifest?.stages.find((s) => s.key === stageKey)?.outputs;
    if (declared && declared.length) return declared;
    return [
      { key: 'report', label: 'Report', type: 'artifact' },
      { key: 'summary', label: 'Summary', type: 'json' },
    ];
  }

  private fabricateOutput(out: ManifestOutput, job: JobSummary): unknown {
    switch (out.type) {
      case 'artifact':
      case 'resource':
      case 'revision': {
        const name = `${out.key.replace(/_/g, '-')}-${job.jobId.slice(-6)}.${out.key === 'summary' ? 'json' : 'html'}`;
        const art = this.addResource({
          name,
          extension: name.split('.').pop(),
          mime: 'text/html',
          resourceType: 'artifact',
          text: `<html><body><h1>${out.label}</h1><p>Produced by ${job.functionName}</p></body></html>`,
        });
        const list = this.artifacts.get(job.resourceId) ?? [];
        list.push({
          resourceId: art.summary.resourceId,
          revisionId: art.summary.revisionId,
          name,
          extension: art.summary.extension,
          mime: art.summary.mime,
          size: art.summary.size,
          created: now(),
        });
        this.artifacts.set(job.resourceId, list);
        return { resource_id: art.summary.resourceId, revision_id: art.summary.revisionId, name };
      }
      case 'json':
        if (out.key === 'conflicts') {
          return [
            { id: 'c1', section: '3.2 Signal timing', first: '5 ms', second: '8 ms', severity: 'high' },
            {
              id: 'c2',
              section: '4.1 Voltage',
              first: '28 V nominal',
              second: '24 V nominal',
              severity: 'high',
            },
            { id: 'c3', section: '6.3 Connector', first: 'D38999/26', second: 'D38999/20', severity: 'low' },
          ];
        }
        return { matches: 42, conflicts: 3, missing: 1, model: 'mock', duration_s: 12.4 };
      case 'text':
        return `${out.label}: mock output written by ${job.functionName}.`;
      default:
        return null;
    }
  }

  private commitRun(resource: StoredResource, run: RunDocument, description: string): void {
    run.updated = now();
    const revisionId = this.id('rev');
    resource.revisions.push({
      summary: {
        revisionId,
        name: resource.summary.name,
        created: now(),
        createdById: 'agent-mock',
        description,
      },
      json: run,
    });
    resource.summary.revisionId = revisionId;
    resource.summary.updated = now();
  }

  private stored(resourceId: string): StoredResource {
    const stored = this.resources.get(resourceId);
    if (!stored) throw new GatewayError(`Resource ${resourceId} not found`, { status: 404 });
    return stored;
  }

  private revision(resourceId: string, revisionId?: string): StoredRevision {
    const stored = this.stored(resourceId);
    const rev = revisionId
      ? stored.revisions.find((r) => r.summary.revisionId === revisionId)
      : stored.revisions[stored.revisions.length - 1];
    if (!rev) throw new GatewayError(`Revision ${revisionId} not found`, { status: 404 });
    return rev;
  }

  private id(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter.toString().padStart(4, '0')}-${crypto.randomUUID().slice(0, 8)}`;
  }

  private async tick(method: keyof IstariGateway): Promise<void> {
    if (this.failNext && this.failNext.method === method) {
      const { error } = this.failNext;
      this.failNext = null;
      throw error;
    }
    if (this.opts.latencyMs > 0) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
  }
}

function now(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}
