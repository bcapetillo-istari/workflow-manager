import { useState } from 'react';
import type { ResourceSummary, RevisionSummary } from '../../gateway/types';
import type { ResourceValue } from '../../manifest/types';
import type { InputComponentProps } from '../../renderer/types';
import { resolveBinding } from '../../renderer/bindings';
import { useGateway } from '../../gateway/GatewayContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { controlClasses } from '../ui/Field';
import { Badge, Button, FileIcon, Spinner, pickerRowClasses } from '../ui';
import { errorMessage } from '../ui/ErrorState';
import { isResourceValue, isSystemValue } from '../inputs/valueGuards';
import { useResourceSearch, useRevisions } from './hooks';

/** Resolve `filter.system` (a binding to a system input) to a system id. */
function scopedSystemId(input: InputComponentProps['input'], context: InputComponentProps['context']) {
  const binding = input.filter?.system;
  if (!binding) return undefined;
  const resolved = resolveBinding(binding, context);
  if (isSystemValue(resolved)) return resolved.system_id;
  return typeof resolved === 'string' && resolved ? resolved : undefined;
}

export function ResourcePicker({
  id,
  input,
  value,
  onChange,
  context,
  disabled,
  invalid,
}: InputComponentProps) {
  const selected = isResourceValue(value) ? value : undefined;
  const systemId = scopedSystemId(input, context);
  const scopeMissing = !!input.filter?.system && !systemId;

  if (selected) {
    return (
      <SelectedResource
        id={id}
        value={selected}
        disabled={disabled}
        onRevision={(rev) => onChange({ ...selected, revision_id: rev.revisionId })}
        onClear={() => onChange(undefined)}
      />
    );
  }
  return (
    <ResourceSearch
      id={id}
      extensions={input.filter?.extensions}
      systemId={systemId}
      disabled={disabled || scopeMissing}
      invalid={invalid}
      placeholder={scopeMissing ? 'Select a system first' : 'Search resources by name…'}
      onSelect={(r) => onChange({ resource_id: r.resourceId, revision_id: r.revisionId, name: r.name })}
    />
  );
}

function ResourceSearch({
  id,
  extensions,
  systemId,
  disabled,
  invalid,
  placeholder,
  onSelect,
}: {
  id: string;
  extensions?: string[];
  systemId?: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder: string;
  onSelect: (r: ResourceSummary) => void;
}) {
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 300);
  const results = useResourceSearch(debounced, { extensions, systemId }, !disabled);
  return (
    <div className="flex flex-col gap-2">
      <input
        id={id}
        type="search"
        className={controlClasses}
        placeholder={placeholder}
        value={term}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => setTerm(e.target.value)}
      />
      {extensions && (
        <p className="text-xs text-ink-500">Allowed types: {extensions.map((e) => `.${e}`).join(', ')}</p>
      )}
      {!disabled && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-ink-200 bg-white">
          {results.isPending && (
            <div className="flex items-center gap-2 p-3 text-sm text-ink-500">
              <Spinner size="sm" /> Searching…
            </div>
          )}
          {results.isError && <p className="p-3 text-sm text-danger">{errorMessage(results.error)}</p>}
          {results.data && results.data.length === 0 && (
            <p className="p-3 text-sm text-ink-500">No matching resources.</p>
          )}
          {results.data && results.data.length > 0 && (
            <ul className="divide-y divide-ink-100">
              {results.data.map((r) => (
                <li key={r.resourceId}>
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    className={`${pickerRowClasses(false)} justify-between`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileIcon size={16} className="text-ink-400" />
                      <span className="truncate font-medium">{r.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
                      {r.extension && <Badge tone="muted">.{r.extension}</Badge>}
                      <span>updated {new Date(r.updated).toLocaleDateString()}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SelectedResource({
  id,
  value,
  disabled,
  onRevision,
  onClear,
}: {
  id: string;
  value: ResourceValue;
  disabled?: boolean;
  onRevision: (rev: RevisionSummary) => void;
  onClear: () => void;
}) {
  const gateway = useGateway();
  const revisions = useRevisions(value.resource_id);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-brand-200 bg-cloud-blue/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <a
          href={gateway.resourceUrl(value.resource_id)}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-2 text-sm font-medium text-flight-blue hover:underline"
        >
          <FileIcon size={16} className="text-istari-blue" />
          <span className="truncate">{value.name}</span>
        </a>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
          Change
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-600">
        Revision
        {revisions.isPending ? (
          <Spinner size="sm" />
        ) : (
          <select
            id={`${id}-revision`}
            className={`${controlClasses} h-8 max-w-xs py-1 text-xs`}
            value={value.revision_id}
            disabled={disabled || revisions.isError}
            onChange={(e) => {
              const rev = revisions.data?.find((r) => r.revisionId === e.target.value);
              if (rev) onRevision(rev);
            }}
          >
            {(revisions.data ?? []).map((r, i, all) => (
              <option key={r.revisionId} value={r.revisionId}>
                {r.versionName ?? r.revisionId}
                {i === all.length - 1 ? ' (current)' : ''} · {new Date(r.created).toLocaleString()}
              </option>
            ))}
          </select>
        )}
      </label>
    </div>
  );
}
