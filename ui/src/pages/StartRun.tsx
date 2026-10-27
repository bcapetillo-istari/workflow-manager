import { Link, useNavigate, useParams } from 'react-router-dom';
import { findWorkflow, useCatalog } from '../catalog/useCatalog';
import { stageKind } from '../manifest/types';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner } from '../components/ui';
import { useCreateRun } from './runHooks';
import { PageHeader } from './PageHeader';

export function StartRun() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const { createRun, creating, error } = useCreateRun();
  const entry = findWorkflow(catalog.data, key);

  if (catalog.isPending) return <Spinner />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />;
  if (!entry) {
    return (
      <EmptyState
        title="Workflow not found"
        description={`No valid workflow with key "${key}" is shared with you.`}
        action={
          <Link to="/">
            <Button variant="secondary">Back to workflows</Button>
          </Link>
        }
      />
    );
  }

  const m = entry.manifest;
  const start = async () => {
    const { resourceId } = await createRun(entry);
    navigate(`/runs/${encodeURIComponent(resourceId)}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link to="/" className="hover:underline">
            Workflows
          </Link>
        }
        title={m.name}
        description={m.description}
        actions={
          <Button onClick={() => void start().catch(() => undefined)} loading={creating}>
            Start
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
        <Badge tone="neutral">v{m.version}</Badge>
        {(m.tags ?? []).map((t) => (
          <Badge key={t} tone="muted">
            {t}
          </Badge>
        ))}
        <span className="font-mono text-xs text-ink-500">{entry.fileName}</span>
      </div>
      {error && <ErrorState title="Could not start the run" error={error} />}
      <section className="flex flex-col gap-3">
        <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-500">
          Stages ({m.stages.length})
        </h2>
        <Card padded={false}>
          <ol className="divide-y divide-ink-100">
            {m.stages.map((s, i) => (
              <li key={s.key} className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cloud-blue text-xs font-semibold text-istari-blue">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-apple-black">{s.name}</p>
                    <Badge tone="muted">{stageKind(s)}</Badge>
                  </div>
                  {s.description && <p className="mt-0.5 text-sm text-ink-600">{s.description}</p>}
                  {s.inputs && s.inputs.length > 0 && (
                    <p className="mt-1 text-xs text-ink-500">
                      Collects: {s.inputs.map((x) => x.label).join(', ')}
                    </p>
                  )}
                  {s.function && <p className="mt-1 font-mono text-xs text-ink-500">{s.function.name}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
