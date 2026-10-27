import type { JobStatus } from '../../gateway/types';
import type { RunStatus, StageStatus } from '../../run/types';
import { Badge, type BadgeTone } from './Badge';

type AnyStatus = RunStatus | StageStatus | JobStatus;

/**
 * queued/pending -> neutral; active (running, in progress, collecting, submitted) -> info (Cloud Blue);
 * succeeded/completed -> success; failed -> danger; cancelled -> muted; unknown -> warning.
 */
const tones: Record<AnyStatus, BadgeTone> = {
  // run
  in_progress: 'info',
  running_job: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'muted',
  // stage
  pending: 'neutral',
  collecting: 'info',
  submitted: 'info',
  running: 'info',
  // job
  Created: 'neutral',
  Pending: 'neutral',
  Claimed: 'info',
  Validating: 'info',
  Running: 'info',
  Uploading: 'info',
  Completed: 'success',
  Failed: 'danger',
  Canceled: 'muted',
  Unknown: 'warning',
};

/** Statuses where work is actively happening; these get a pulsing Digital Blue dot. */
const live = new Set<AnyStatus>(['running', 'running_job', 'submitted', 'Running', 'Uploading', 'Claimed', 'Validating']);

export function statusLabel(status: AnyStatus): string {
  return status.replace(/_/g, ' ');
}

export function StatusBadge({ status }: { status: AnyStatus }) {
  return (
    <Badge tone={tones[status] ?? 'neutral'}>
      {live.has(status) && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-digital-blue opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-digital-blue" />
        </span>
      )}
      {statusLabel(status)}
    </Badge>
  );
}
