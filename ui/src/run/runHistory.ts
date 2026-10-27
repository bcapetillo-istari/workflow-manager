/** Loads the current user's run documents from the runs system: newest 50 by `updated`. */
import type { IstariGateway } from '../gateway/types';
import type { RunDocument } from './types';

export const RUN_HISTORY_LIMIT = 50;

export interface RunHistoryEntry {
  resourceId: string;
  run: RunDocument;
}

export async function loadRunHistory(
  gateway: IstariGateway,
  systemId: string,
  userId: string,
  limit = RUN_HISTORY_LIMIT,
): Promise<RunHistoryEntry[]> {
  const tracked = await gateway.listTrackedResources(systemId);
  const candidates = tracked
    .filter((r) => r.name.endsWith('.json'))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, limit);
  const reads = await Promise.allSettled(candidates.map((r) => gateway.readJson<RunDocument>(r.resourceId)));
  const out: RunHistoryEntry[] = [];
  reads.forEach((read, i) => {
    if (read.status !== 'fulfilled') return;
    const run = read.value.data;
    if (isRunDocument(run) && run.initiator_user_id === userId)
      out.push({ resourceId: candidates[i].resourceId, run });
  });
  return out;
}

export function isRunDocument(value: unknown): value is RunDocument {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<RunDocument>;
  return v.schema_version === '1' && typeof v.run_id === 'string' && typeof v.initiator_user_id === 'string';
}
