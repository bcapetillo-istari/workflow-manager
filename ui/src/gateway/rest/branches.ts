/**
 * System branch plumbing (v2 "snapshot tags"), following the SDK's Branches manager:
 *   branch -> snapshot -> configuration -> tracked files
 * and the commit recipe from `Branches.commit`:
 *   1. GET  /v2/systems/configurations/snapshots/{snapshot_id}            -> configuration_id
 *   2. GET  /v2/systems/configurations/{configuration_id}/tracked-files   (all pages)
 *   3. POST /v2/systems/{system_id}/configurations { name, tracked_files: existing + new }
 *   4. GET  /v2/systems/configurations/snapshots?configuration_id=&size=1&sort=-created
 *   5. PUT  /v2/systems/configurations/snapshots/tags/{tag_id} { snapshot_id, commit_message }
 * New files are added as `Latest` with no pinned revision so the branch follows new revisions.
 */
import { GatewayError } from '../types';
import type { HttpClient, OffsetPage } from './http';
import type {
  NewTrackedFileDto,
  SnapshotDto,
  SnapshotTagDto,
  SystemBaselineDto,
  SystemConfigurationDto,
  TrackedFileDto,
} from './dto';

export interface ResolvedBranch {
  tagId: string;
  tag: string;
  snapshotId: string;
}

export async function listBranches(http: HttpClient, systemId: string): Promise<SnapshotTagDto[]> {
  return http.getAllPages<SnapshotTagDto>('/v2/systems/configurations/snapshots/tags', {
    system_id: systemId,
  });
}

/** Baseline branch when branchId is omitted; otherwise the named tag of the system. */
export async function resolveBranch(
  http: HttpClient,
  systemId: string,
  branchId?: string,
): Promise<ResolvedBranch> {
  if (!branchId) {
    const base = await http.get<SystemBaselineDto>(`/v2/systems/${systemId}/baseline`);
    return { tagId: base.tag_id, tag: 'baseline', snapshotId: base.snapshot_id };
  }
  const tags = await listBranches(http, systemId);
  const tag = tags.find((t) => t.id === branchId);
  if (!tag) throw new GatewayError(`Branch ${branchId} not found on system ${systemId}`, { status: 404 });
  return { tagId: tag.id, tag: tag.tag, snapshotId: tag.snapshot_id };
}

export async function listTrackedFiles(http: HttpClient, snapshotId: string): Promise<TrackedFileDto[]> {
  const snapshot = await http.get<SnapshotDto>(`/v2/systems/configurations/snapshots/${snapshotId}`);
  return http.getAllPages<TrackedFileDto>(
    `/v2/systems/configurations/${snapshot.configuration_id}/tracked-files`,
  );
}

/**
 * Tracked-file paths are system-rooted ltree labels: `<system_hex>.<Folder>.<file_hex>`; the folder
 * part (everything but the trailing file label) is what `folder_path` expects. Root files omit it.
 */
export function folderPathOf(path: string): string | undefined {
  const labels = path.split('.');
  return labels.length > 2 ? labels.slice(0, -1).join('.') : undefined;
}

function carryForward(tf: TrackedFileDto): NewTrackedFileDto {
  return {
    specifier_type: tf.specifier_type,
    file_id: tf.file_id,
    pinned_file_revision_id: tf.pinned_file_revision_id ?? null,
    folder_path: folderPathOf(tf.path) ?? null,
  };
}

/** Add a file to a branch as a `Latest` tracked file; a no-op if the file is already tracked. */
export async function commitFileToBranch(
  http: HttpClient,
  systemId: string,
  branch: ResolvedBranch,
  fileId: string,
  commitMessage: string,
): Promise<void> {
  const existing = await listTrackedFiles(http, branch.snapshotId);
  if (existing.some((tf) => tf.file_id === fileId)) return;
  const trackedFiles: NewTrackedFileDto[] = existing.map(carryForward);
  trackedFiles.push({ specifier_type: 'Latest', file_id: fileId });

  const cfg = await http.post<SystemConfigurationDto>(`/v2/systems/${systemId}/configurations`, {
    name: `${branch.tag}-commit`,
    tracked_files: trackedFiles,
  });
  try {
    const snaps = await http.get<OffsetPage<SnapshotDto>>('/v2/systems/configurations/snapshots', {
      configuration_id: cfg.id,
      size: 1,
      sort: '-created',
    });
    const snapshot = snaps.items[0];
    if (!snapshot) throw new GatewayError(`No snapshot created for configuration ${cfg.id}`);
    await http.put(`/v2/systems/configurations/snapshots/tags/${branch.tagId}`, {
      snapshot_id: snapshot.id,
      commit_message: commitMessage,
    });
  } catch (err) {
    // Same best-effort cleanup as the SDK: archive the orphaned configuration, keep the original error.
    await http.delete(`/v2/systems/configurations/${cfg.id}`).catch(() => undefined);
    throw err;
  }
}
