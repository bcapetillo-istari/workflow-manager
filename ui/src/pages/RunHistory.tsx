import { Link } from 'react-router-dom';
import { Button, ChevronRightIcon, EmptyState, ErrorState, Spinner, StatusBadge } from '../components/ui';
import { useRunHistory } from './runHooks';
import { PageHeader } from './PageHeader';

/** "3 minutes ago" style label; the absolute time goes in the title attribute. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((then - now) / 1000);
  if (Math.abs(seconds) < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2629800],
    ['year', 31557600],
  ];
  let pick = steps[0];
  for (const step of steps) if (Math.abs(seconds) >= step[1]) pick = step;
  return rtf.format(Math.round(seconds / pick[1]), pick[0]);
}

function Time({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className="whitespace-nowrap">
      {relativeTime(iso)}
    </time>
  );
}

const th = 'px-4 py-2 text-left text-xs font-semibold text-ink-600';
const td = 'px-4 py-2.5 align-middle';

export function RunHistory() {
  const { runs, loading, error } = useRunHistory();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Runs" description="Every run is resumable: open one to pick up where it left off." />
      {loading && <Spinner />}
      {error && <ErrorState error={error} />}
      {!loading && !error && runs.length === 0 && (
        <EmptyState
          title="No runs yet"
          description="Start a workflow to see it here."
          action={
            <Link to="/">
              <Button variant="secondary">Browse workflows</Button>
            </Link>
          }
        />
      )}
      {runs.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-ink-200 bg-white shadow-[var(--shadow-card)]">
          <table className="min-w-full text-sm">
            <thead className="border-b border-ink-200 bg-ink-100">
              <tr>
                <th scope="col" className={th}>
                  Workflow
                </th>
                <th scope="col" className={th}>
                  Status
                </th>
                <th scope="col" className={th}>
                  Current stage
                </th>
                <th scope="col" className={th}>
                  Created
                </th>
                <th scope="col" className={th}>
                  Updated
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {runs.map(({ resourceId, run }) => (
                <tr key={resourceId} className="odd:bg-white even:bg-ink-50 hover:bg-cloud-blue/40">
                  <td className={td}>
                    <Link
                      to={`/runs/${encodeURIComponent(resourceId)}`}
                      className="font-medium text-apple-black hover:text-flight-blue hover:underline"
                    >
                      {run.workflow_name}
                    </Link>
                    <div className="font-mono text-xs text-ink-500">v{run.workflow_version}</div>
                  </td>
                  <td className={td}>
                    <StatusBadge status={run.status} />
                  </td>
                  <td className={`${td} text-ink-700`}>{run.current_stage ?? '—'}</td>
                  <td className={`${td} text-ink-600`}>
                    <Time iso={run.created} />
                  </td>
                  <td className={`${td} text-ink-600`}>
                    <Time iso={run.updated} />
                  </td>
                  <td className={`${td} text-right`}>
                    <Link
                      to={`/runs/${encodeURIComponent(resourceId)}`}
                      className="inline-flex items-center gap-0.5 font-medium text-flight-blue hover:underline"
                    >
                      Open
                      <ChevronRightIcon size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
