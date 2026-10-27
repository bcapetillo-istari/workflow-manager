import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { WorkflowManifest } from '../manifest/types';
import type { RunDocument, StageStatus } from '../run/types';
import {
  Button,
  Card,
  CardTitle,
  CheckIcon,
  ChevronRightIcon,
  ErrorState,
  RefreshIcon,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { StageRenderer } from '../renderer/StageRenderer';
import { SummaryView } from '../renderer/ViewRenderer';
import { useRun } from './runHooks';
import { PageHeader } from './PageHeader';

export function RunDetail() {
  const { resourceId = '' } = useParams();
  const { run, manifest, currentStage, submitStageInputs, advance, cancel, loading, error, refresh } =
    useRun(resourceId);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // surfaced through `error`
    } finally {
      setBusy(false);
    }
  };

  if (loading && !run) return <Spinner />;
  if (!run) return <ErrorState title="Run not found" error={error} onRetry={() => void refresh()} />;

  const terminal = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled';
  const currentIndex = run.current_stage ? run.stage_order.indexOf(run.current_stage) : -1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link to="/runs" className="hover:underline">
            Runs
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {run.workflow_name}
            <StatusBadge status={run.status} />
          </span>
        }
        description={
          <span className="font-mono text-xs text-ink-500">
            v{run.workflow_version} · run {run.run_id} · started {new Date(run.created).toLocaleString()}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              <RefreshIcon size={14} />
              Refresh
            </Button>
            {!terminal && (
              <Button variant="danger" size="sm" onClick={() => void act(cancel)} loading={busy}>
                Cancel run
              </Button>
            )}
          </>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refresh()} />}

      <Stepper run={run} manifest={manifest} />

      {currentStage && (
        <Card>
          <div className="mb-5 flex items-start justify-between gap-3 border-b border-ink-100 pb-4">
            <div className="min-w-0">
              <CardTitle>
                Step {currentIndex + 1}: {currentStage.name}
              </CardTitle>
              {currentStage.description && (
                <p className="mt-1 text-sm text-ink-600">{currentStage.description}</p>
              )}
            </div>
            <StatusBadge status={run.stages[currentStage.key]?.status ?? 'pending'} />
          </div>
          <StageRenderer
            stage={currentStage}
            record={run.stages[currentStage.key]}
            run={run}
            isLast={currentIndex === run.stage_order.length - 1}
            onSubmitInputs={(values) => act(() => submitStageInputs(values))}
            onAdvance={() => act(advance)}
            busy={busy}
          />
        </Card>
      )}

      {terminal && manifest && <FinalResult run={run} manifest={manifest} />}

      <CompletedStages run={run} manifest={manifest} />
    </div>
  );
}

type StepState = 'done' | 'current' | 'pending' | 'failed';

function stepState(status: StageStatus | undefined, active: boolean, index: number, currentIndex: number): StepState {
  if (status === 'failed') return 'failed';
  if (status === 'succeeded') return 'done';
  if (active) return 'current';
  if (currentIndex === -1 && status !== undefined && status !== 'pending') return 'done';
  return index < currentIndex ? 'done' : 'pending';
}

const circleClasses: Record<StepState, string> = {
  done: 'bg-flight-blue text-white',
  current: 'bg-white text-istari-blue ring-2 ring-digital-blue',
  pending: 'bg-ink-200 text-ink-500',
  failed: 'bg-danger text-white',
};

/** Horizontal stepper: numbered circles joined by connectors; done steps and connectors are Flight Blue. */
function Stepper({ run, manifest }: { run: RunDocument; manifest: WorkflowManifest | null }) {
  const currentIndex = run.current_stage ? run.stage_order.indexOf(run.current_stage) : -1;
  return (
    <ol className="flex items-start gap-2 overflow-x-auto px-1 py-1" aria-label="Stages">
      {run.stage_order.map((key, i) => {
        const record = run.stages[key];
        const name = manifest?.stages.find((s) => s.key === key)?.name ?? key;
        const active = run.current_stage === key;
        const state = stepState(record?.status, active, i, currentIndex);
        const last = i === run.stage_order.length - 1;
        return (
          <li
            key={key}
            aria-current={active ? 'step' : undefined}
            className={`flex min-w-0 items-start gap-2 ${last ? 'shrink-0' : 'flex-1'}`}
          >
            <div className="flex min-w-0 shrink-0 items-center gap-2.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${circleClasses[state]}`}
                aria-hidden="true"
              >
                {state === 'done' ? <CheckIcon size={14} strokeWidth={2.5} /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-col">
                <span
                  className={`truncate text-sm leading-7 ${
                    state === 'current' ? 'font-medium text-apple-black' : 'text-ink-700'
                  }`}
                >
                  {name}
                </span>
              </div>
              <span className="sr-only">{record?.status ?? 'pending'}</span>
            </div>
            {!last && (
              <span
                className={`mt-3.5 h-0.5 min-w-6 flex-1 rounded-full ${state === 'done' ? 'bg-flight-blue' : 'bg-ink-200'}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** When the run is over, show the last stage's view (or the outputs) so results remain visible. */
function FinalResult({ run, manifest }: { run: RunDocument; manifest: WorkflowManifest }) {
  const lastKey = run.stage_order[run.stage_order.length - 1];
  const stage = manifest.stages.find((s) => s.key === lastKey);
  if (!stage) return null;
  if (run.status !== 'succeeded') {
    const failed = Object.values(run.stages).find((s) => s.error);
    return failed?.error ? <ErrorState title="Run did not complete" error={failed.error} /> : null;
  }
  return (
    <Card>
      <CardTitle className="mb-4">{stage.name}</CardTitle>
      <StageRenderer
        stage={stage}
        record={run.stages[stage.key]}
        run={run}
        isLast
        onSubmitInputs={async () => undefined}
        onAdvance={async () => undefined}
      />
    </Card>
  );
}

function CompletedStages({ run, manifest }: { run: RunDocument; manifest: WorkflowManifest | null }) {
  const done = run.stage_order
    .map((key) => run.stages[key])
    .filter((r): r is NonNullable<typeof r> => !!r && (r.inputs !== undefined || r.outputs !== undefined))
    .filter((r) => r.key !== run.current_stage);
  if (done.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-500">Recorded stages</h2>
      {done.map((r) => (
        <details
          key={r.key}
          className="group rounded-[var(--radius-card)] border border-ink-200 bg-white shadow-[var(--shadow-card)]"
        >
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-ink-800 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <ChevronRightIcon size={14} className="text-ink-400 transition-transform group-open:rotate-90" />
              {manifest?.stages.find((s) => s.key === r.key)?.name ?? r.key}
            </span>
            <StatusBadge status={r.status} />
          </summary>
          <div className="flex flex-col gap-4 border-t border-ink-100 px-5 py-4">
            {r.inputs && (
              <div>
                <h3 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Inputs
                </h3>
                <SummaryView data={r.inputs} />
              </div>
            )}
            {r.outputs && (
              <div>
                <h3 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Outputs
                </h3>
                <SummaryView data={r.outputs} />
              </div>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
