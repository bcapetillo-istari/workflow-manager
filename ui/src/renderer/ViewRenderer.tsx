import type { ManifestView } from '../manifest/types';
import type { RunDocument } from '../run/types';
import { useGateway } from '../gateway/GatewayContext';
import { EmptyState, ExternalLinkIcon, FileIcon } from '../components/ui';
import { resolveBinding } from './bindings';
import { buildBindingContext } from './bindingContext';

interface LinkedRef {
  resourceId: string;
  revisionId?: string;
  name?: string;
}

/** Artifact / resource / revision values written by modules: `{ resource_id, revision_id?, name? }`. */
export function asLinkedRef(value: unknown): LinkedRef | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const resourceId = rec.resource_id ?? rec.resourceId;
  if (typeof resourceId !== 'string') return null;
  const revisionId = rec.revision_id ?? rec.revisionId;
  const name = rec.name ?? rec.label;
  return {
    resourceId,
    revisionId: typeof revisionId === 'string' ? revisionId : undefined,
    name: typeof name === 'string' ? name : undefined,
  };
}

export function ViewRenderer({ view, run }: { view: ManifestView; run: RunDocument | null }) {
  const data = resolveBinding(view.source, buildBindingContext(run));
  if (data === undefined || data === null) {
    return <EmptyState title="Nothing to show yet" description={`Source ${view.source} has no value.`} />;
  }
  switch (view.type) {
    case 'summary':
      return <SummaryView data={data} />;
    case 'artifact_list':
      return <ArtifactListView data={data} />;
    case 'json_table':
      return <JsonTableView data={data} />;
    case 'markdown':
      return <MarkdownView data={data} />;
    default:
      return <ErrorNote>Unknown view type “{String(view.type)}”.</ErrorNote>;
  }
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-warning">{children}</p>;
}

/** Bordered neutral container shared by the result views. */
const panelClasses = 'overflow-hidden rounded-md border border-ink-200 bg-white';

export function ValueCell({ value }: { value: unknown }) {
  const gateway = useGateway();
  const ref = asLinkedRef(value);
  if (ref) {
    return (
      <a
        href={gateway.resourceUrl(ref.resourceId)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-flight-blue hover:underline"
      >
        {ref.name ?? ref.resourceId}
        <ExternalLinkIcon size={12} className="text-ink-400" />
      </a>
    );
  }
  if (value === null || value === undefined) return <span className="text-ink-400">—</span>;
  if (typeof value === 'object') {
    return (
      <pre className="max-h-48 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-2 font-mono text-xs leading-5 text-ink-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  return <span className="break-words">{String(value)}</span>;
}

export function SummaryView({ data }: { data: unknown }) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return <ValueCell value={data} />;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return <EmptyState title="No outputs" />;
  return (
    <dl className={`${panelClasses} divide-y divide-ink-100`}>
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-3 gap-4 px-4 py-2.5 text-sm">
          <dt className="font-medium text-ink-600">{humanize(key)}</dt>
          <dd className="col-span-2 min-w-0 text-apple-black">
            <ValueCell value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ArtifactListView({ data }: { data: unknown }) {
  const items = Array.isArray(data) ? data : typeof data === 'object' && data ? Object.values(data) : [data];
  const refs = items.map(asLinkedRef).filter((r): r is LinkedRef => r !== null);
  if (refs.length === 0)
    return <EmptyState title="No artifacts" description="No artifact references were found." />;
  return (
    <ul className={`${panelClasses} divide-y divide-ink-100`}>
      {refs.map((ref) => (
        <li
          key={`${ref.resourceId}:${ref.revisionId ?? ''}`}
          className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm hover:bg-ink-50"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cloud-blue text-istari-blue">
              <FileIcon size={15} />
            </span>
            <ValueCell value={ref} />
          </span>
          <span className="shrink-0 font-mono text-xs text-ink-500">{ref.revisionId ?? ref.resourceId}</span>
        </li>
      ))}
    </ul>
  );
}

export function JsonTableView({ data }: { data: unknown }) {
  if (!Array.isArray(data)) return <ErrorNote>json_table expects an array; got {typeof data}.</ErrorNote>;
  const rows = data.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
  if (rows.length === 0) return <EmptyState title="No rows" />;
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return (
    <div className={`${panelClasses} overflow-x-auto`}>
      <table className="min-w-full text-sm">
        <thead className="border-b border-ink-200 bg-ink-100">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-3 py-1.5 text-left text-xs font-semibold text-ink-600">
                {humanize(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-white even:bg-ink-50">
              {columns.map((c) => (
                <td key={c} className="px-3 py-1.5 align-top text-ink-800">
                  <ValueCell value={row[c]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Markdown rendering: no markdown library is installed, so the text is shown preformatted for now. */
export function MarkdownView({ data }: { data: unknown }) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <pre className="whitespace-pre-wrap rounded-md border border-ink-200 bg-ink-50 p-4 font-mono text-xs leading-5 text-ink-800">
      {text}
    </pre>
  );
}

export function humanize(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
