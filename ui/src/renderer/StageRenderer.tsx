import type { InputValues, ManifestStage } from '../manifest/types';
import { stageKind } from '../manifest/types';
import type { RunDocument, StageRecord } from '../run/types';
import { Button, EmptyState, ErrorState } from '../components/ui';
import { StageForm } from './StageForm';
import { StageProgress } from './StageProgress';
import { SummaryView, ViewRenderer } from './ViewRenderer';

export interface StageRendererProps {
  stage: ManifestStage;
  record: StageRecord | undefined;
  run: RunDocument;
  isLast: boolean;
  onSubmitInputs: (values: InputValues) => Promise<void>;
  onAdvance: () => Promise<void>;
  busy?: boolean;
}

/** Decides what the current stage shows: form, job progress, or a view with a Continue button. */
export function StageRenderer({
  stage,
  record,
  run,
  isLast,
  onSubmitInputs,
  onAdvance,
  busy,
}: StageRendererProps) {
  const status = record?.status ?? 'pending';
  const kind = stageKind(stage);
  const terminalRun = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled';

  if (status === 'running' || status === 'submitted') {
    return <StageProgress record={record ?? { key: stage.key, status }} />;
  }
  if (status === 'failed') {
    return (
      <ErrorState title="Stage failed" error={record?.error ?? 'The job did not complete successfully.'} />
    );
  }
  if (status === 'cancelled') return <EmptyState title="Stage cancelled" />;

  const collecting = status === 'pending' || status === 'collecting';
  if (collecting && kind !== 'display' && !terminalRun) {
    return (
      <div className="flex flex-col gap-6">
        {stage.view && <ViewRenderer view={stage.view} run={run} />}
        <StageForm
          stage={stage}
          run={run}
          onSubmit={onSubmitInputs}
          submitLabel={kind === 'job' ? 'Start job' : 'Continue'}
          disabled={busy}
        />
      </div>
    );
  }

  // Display stage, or a finished stage waiting to advance.
  return (
    <div className="flex flex-col gap-6">
      {stage.view ? (
        <ViewRenderer view={stage.view} run={run} />
      ) : record?.outputs ? (
        <SummaryView data={record.outputs} />
      ) : (
        <EmptyState title="Stage complete" />
      )}
      {!terminalRun && (
        <div className="border-t border-ink-100 pt-4">
          <Button onClick={() => void onAdvance()} loading={busy}>
            {isLast ? 'Finish' : 'Continue'}
          </Button>
        </div>
      )}
    </div>
  );
}
