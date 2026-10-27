import { Link } from 'react-router-dom';
import type { InvalidManifest, LoadedManifest } from '../manifest/types';
import { useCatalog } from '../catalog/useCatalog';
import { AlertIcon, Badge, Button, Card, CardTitle, EmptyState, ErrorState, Spinner } from '../components/ui';
import { PageHeader } from './PageHeader';

export function Catalog() {
  const catalog = useCatalog();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Workflows" description="Workflows shared with you. Start one to begin a run." />
      {catalog.isPending && (
        <div className="flex items-center gap-3 text-sm text-ink-500">
          <Spinner /> Loading workflows…
        </div>
      )}
      {catalog.isError && (
        <ErrorState
          title="The workflow-manager system could not be read"
          error={catalog.error}
          onRetry={() => void catalog.refetch()}
        />
      )}
      {catalog.data && catalog.data.length === 0 && (
        <EmptyState
          title="No workflows yet"
          description="Upload a manifest to the workflow-manager system and share it to see it here."
        />
      )}
      {catalog.data && catalog.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.data.map((entry) =>
            entry.ok ? (
              <WorkflowCard key={entry.resourceId} entry={entry} />
            ) : (
              <InvalidCard key={entry.resourceId} entry={entry} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowCard({ entry }: { entry: LoadedManifest }) {
  const m = entry.manifest;
  const stageCount = `${m.stages.length} ${m.stages.length === 1 ? 'stage' : 'stages'}`;
  return (
    <Card
      interactive
      className="relative flex flex-col gap-3 overflow-hidden pl-6 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-istari-blue"
      data-testid="workflow-card"
    >
      <CardTitle>{m.name}</CardTitle>
      {m.description && <p className="line-clamp-2 text-sm leading-5 text-ink-600">{m.description}</p>}
      {(m.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(m.tags ?? []).map((t) => (
            <Badge key={t} tone="muted" className="px-1.5 py-0 text-[11px]">
              {t}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
        <span className="text-xs text-ink-500">
          v{m.version} <span aria-hidden="true">·</span> {stageCount}
        </span>
        <Link to={`/workflows/${encodeURIComponent(m.key)}`} tabIndex={-1}>
          <Button size="sm">Start</Button>
        </Link>
      </div>
    </Card>
  );
}

export function InvalidCard({ entry }: { entry: InvalidManifest }) {
  return (
    <Card
      className="relative flex flex-col gap-2 overflow-hidden pl-6 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-danger/60"
      data-testid="invalid-card"
    >
      <div className="flex items-start justify-between gap-2">
        <CardTitle className="truncate font-mono text-sm">{entry.fileName}</CardTitle>
        <Badge tone="danger">
          <AlertIcon size={12} />
          invalid
        </Badge>
      </div>
      <p className="text-sm leading-5 text-ink-600">
        This manifest failed validation and is hidden from users until it is fixed.
      </p>
      <details className="mt-auto text-sm">
        <summary className="cursor-pointer select-none text-xs font-medium text-danger hover:underline">
          {entry.errors.length} {entry.errors.length === 1 ? 'error' : 'errors'}
        </summary>
        <ul className="mt-2 list-disc space-y-1 rounded-md bg-ink-50 py-2 pl-7 pr-3 font-mono text-xs text-ink-700">
          {entry.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
