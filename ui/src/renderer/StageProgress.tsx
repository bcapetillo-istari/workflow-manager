import type { StageRecord } from '../run/types';
import { useGateway } from '../gateway/GatewayContext';
import { ExternalLinkIcon, Spinner } from '../components/ui';

/** Running job stage: progress entries written by the module plus a link to the Istari job. */
export function StageProgress({ record }: { record: StageRecord }) {
  const gateway = useGateway();
  const progress = record.progress ?? [];
  const latest = progress[progress.length - 1];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Spinner size="md" label="Job running" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-apple-black">
            {latest?.message ?? 'Waiting for the agent to pick up the job…'}
          </p>
          {record.job_id && (
            <a
              href={gateway.jobUrl(record.job_id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-flight-blue hover:underline"
            >
              job {record.job_id}
              <ExternalLinkIcon size={12} />
            </a>
          )}
        </div>
      </div>
      {latest?.percent !== undefined && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, latest.percent)}
        >
          <div
            className="h-full rounded-full bg-digital-blue transition-all"
            style={{ width: `${Math.min(100, latest.percent)}%` }}
          />
        </div>
      )}
      {progress.length > 0 && (
        <ol className="relative flex flex-col gap-0 border-l border-ink-200 pl-4 text-sm" aria-label="Progress">
          {progress.map((p, i) => {
            const isLatest = i === progress.length - 1;
            return (
              <li key={`${p.at}-${i}`} className="relative flex items-baseline gap-3 py-1">
                <span
                  className={`absolute -left-[21px] top-2.5 h-2 w-2 rounded-full ring-2 ring-white ${
                    isLatest ? 'bg-digital-blue' : 'bg-ink-300'
                  }`}
                  aria-hidden="true"
                />
                <time dateTime={p.at} className="w-20 shrink-0 font-mono text-xs text-ink-500 tabular-nums">
                  {new Date(p.at).toLocaleTimeString()}
                </time>
                <span className={isLatest ? 'text-apple-black' : 'text-ink-600'}>{p.message}</span>
                {p.percent !== undefined && <span className="text-xs text-ink-500 tabular-nums">{p.percent}%</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
