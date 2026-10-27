/**
 * React hooks over the run engine. Components render; these hooks load, poll, reduce and write.
 * Shapes are fixed (the UI codes against them); see ./index.ts.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CurrentUser, IstariGateway } from '../gateway/types';
import type { InputValues, LoadedManifest, ManifestStage, WorkflowManifest } from '../manifest/types';
import { cancelRun, createRun, observeJobWithArtifacts, runningJob, submitStage, writeRun } from './effects';
import { useAuth, useConfig, useGateway, validateManifest } from './external';
import { startJobPolling } from './polling';
import { currentStage as currentStageOf, reduceRun } from './reducer';
import { loadRunHistory, type RunHistoryEntry } from './runHistory';
import type { RunDocument } from './types';

const nowIso = () => new Date().toISOString();
const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

/** The signed-in user's id: from auth state when it carries a user, otherwise from the gateway. */
function useCurrentUser(): CurrentUser | null {
  const auth = useAuth() as ReturnType<typeof useAuth> & { user?: CurrentUser | null };
  return auth.user ?? null;
}

function useCurrentUserId(gateway: IstariGateway): () => Promise<string> {
  const user = useCurrentUser();
  return useCallback(async () => user?.id ?? (await gateway.currentUser()).id, [user, gateway]);
}

export interface UseCreateRun {
  createRun: (entry: LoadedManifest) => Promise<{ resourceId: string }>;
  creating: boolean;
  error: Error | null;
}

export function useCreateRun(): UseCreateRun {
  const gateway = useGateway();
  const config = useConfig();
  const userId = useCurrentUserId(gateway);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(
    async (entry: LoadedManifest) => {
      setCreating(true);
      setError(null);
      try {
        const { resourceId } = await createRun({ gateway }, config, entry, await userId(), nowIso());
        return { resourceId };
      } catch (e) {
        setError(toError(e));
        throw e;
      } finally {
        setCreating(false);
      }
    },
    [gateway, config, userId],
  );
  return { createRun: create, creating, error };
}

export interface UseRun {
  run: RunDocument | null;
  manifest: WorkflowManifest | null;
  currentStage: ManifestStage | null;
  submitStageInputs: (inputs: InputValues) => Promise<void>;
  advance: () => Promise<void>;
  cancel: () => Promise<void>;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useRun(runResourceId: string): UseRun {
  const gateway = useGateway();
  const [run, setRun] = useState<RunDocument | null>(null);
  const [manifest, setManifest] = useState<WorkflowManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const runRef = useRef<RunDocument | null>(null);
  // Reset when pointed at another run (React's documented reset-on-prop-change pattern).
  const [loadedFor, setLoadedFor] = useState(runResourceId);
  if (loadedFor !== runResourceId) {
    setLoadedFor(runResourceId);
    setRun(null);
    setManifest(null);
    setLoading(true);
    setError(null);
  }

  const commit = useCallback(
    async (next: RunDocument) => {
      runRef.current = next;
      setRun(next);
      await writeRun(gateway, runResourceId, next);
    },
    [gateway, runResourceId],
  );

  const load = useCallback(async () => {
    try {
      const { data } = await gateway.readJson<RunDocument>(runResourceId);
      runRef.current = data;
      setRun(data);
      const loaded = await gateway.readJson(data.manifest_resource_id, data.manifest_revision_id);
      const result = validateManifest(loaded.data);
      if (result.ok) setManifest(result.manifest);
      else setError(new Error(`Manifest is invalid: ${result.errors.join('; ')}`));
    } catch (e) {
      setError(toError(e));
    } finally {
      setLoading(false);
    }
  }, [gateway, runResourceId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const polled = run && manifest ? runningJob(run, manifest) : null;
  const stageKey = polled?.stageKey ?? null;
  const jobId = polled?.jobId ?? null;
  useEffect(() => {
    if (!manifest || stageKey === null || jobId === null) return;
    return startJobPolling({
      gateway,
      runResourceId,
      jobId,
      onCycle: async (job, latest) => {
        const current = runRef.current;
        if (!current) return;
        const obs = { stageKey, job, latest, at: nowIso() };
        const { doc, terminal } = await observeJobWithArtifacts({ gateway }, manifest, current, obs);
        if (doc === current) return;
        if (terminal) await commit(doc);
        else {
          runRef.current = doc;
          setRun(doc);
        }
      },
      onError: (e) => setError(toError(e)),
    });
  }, [gateway, runResourceId, manifest, stageKey, jobId, commit]);

  const act = useCallback(
    async (fn: (doc: RunDocument, m: WorkflowManifest) => Promise<RunDocument> | RunDocument) => {
      const doc = runRef.current;
      if (!doc || !manifest) throw new Error('Run is not loaded');
      try {
        const next = await fn(doc, manifest);
        if (next !== doc) await commit(next);
      } catch (e) {
        setError(toError(e));
        throw e;
      }
    },
    [manifest, commit],
  );

  const submitStageInputs = useCallback(
    (inputs: InputValues) =>
      act((doc, m) => {
        if (!doc.current_stage) throw new Error('Run has no current stage');
        return submitStage({ gateway }, m, doc, doc.current_stage, inputs, nowIso());
      }),
    [act, gateway],
  );
  const advance = useCallback(
    () => act((doc, m) => reduceRun(doc, m, { type: 'Advance', at: nowIso() })),
    [act],
  );
  const cancel = useCallback(() => act((doc, m) => cancelRun({ gateway }, m, doc, nowIso())), [act, gateway]);

  const currentStage = useMemo(
    () => (run && manifest ? currentStageOf(run, manifest) : null),
    [run, manifest],
  );
  return { run, manifest, currentStage, submitStageInputs, advance, cancel, loading, error, refresh };
}

export interface UseRunHistory {
  runs: RunHistoryEntry[];
  loading: boolean;
  error: Error | null;
}

export function useRunHistory(): UseRunHistory {
  const gateway = useGateway();
  const { workflowManagerRunsSystemId: systemId } = useConfig();
  const user = useCurrentUser();
  const userId = useCurrentUserId(gateway);
  const query = useQuery({
    queryKey: ['run-history', systemId, user?.id ?? 'me'],
    queryFn: async () => loadRunHistory(gateway, systemId, await userId()),
  });
  return { runs: query.data ?? [], loading: query.isPending, error: query.error };
}
