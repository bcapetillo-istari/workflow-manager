import type { InputComponentProps } from '../../renderer/types';
import { resolveBinding } from '../../renderer/bindings';
import { pickerListClasses, pickerRowClasses } from '../ui/Field';

interface Candidate {
  key: string;
  label: string;
  item: unknown;
}

/** Turn the resolved source (array or object) into pickable candidates. */
export function outputCandidates(source: unknown): Candidate[] {
  if (Array.isArray(source))
    return source.map((item, i) => ({ key: String(i), label: itemLabel(item, i), item }));
  if (source && typeof source === 'object') {
    return Object.entries(source as Record<string, unknown>).map(([k, item]) => ({ key: k, label: k, item }));
  }
  return [];
}

function itemLabel(item: unknown, index: number): string {
  if (item === null || typeof item !== 'object') return String(item);
  const rec = item as Record<string, unknown>;
  const primary = ['name', 'title', 'label', 'section', 'id']
    .map((k) => rec[k])
    .find((v) => typeof v === 'string');
  const rest = Object.entries(rec)
    .filter(([, v]) => typeof v !== 'object' && v !== primary)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
  return primary ? (rest ? `${primary} — ${rest}` : String(primary)) : rest || `Item ${index + 1}`;
}

/** stage_output: pick one or many items from a prior stage's output. Value = the picked item(s). */
export function OutputPicker({
  id,
  input,
  value,
  onChange,
  context,
  disabled,
  invalid,
}: InputComponentProps) {
  const source = input.filter?.source ? resolveBinding(input.filter.source, context) : undefined;
  const candidates = outputCandidates(source);
  const multiple = input.filter?.multiple === true;
  const picked: unknown[] = multiple
    ? Array.isArray(value)
      ? value
      : []
    : value === undefined
      ? []
      : [value];
  const isPicked = (c: Candidate) => picked.some((p) => Object.is(p, c.item) || deepEqual(p, c.item));

  const toggle = (c: Candidate) => {
    if (!multiple) return onChange(isPicked(c) ? undefined : c.item);
    const next = isPicked(c) ? picked.filter((p) => !deepEqual(p, c.item)) : [...picked, c.item];
    onChange(next.length ? next : undefined);
  };

  if (source === undefined) {
    return <p className="text-sm text-ink-500">The source output is not available yet.</p>;
  }
  if (candidates.length === 0) {
    return <p className="text-sm text-ink-500">The source output is empty.</p>;
  }
  return (
    <ul
      id={id}
      aria-invalid={invalid}
      className={pickerListClasses(invalid)}
    >
      {candidates.map((c) => {
        const on = isPicked(c);
        return (
          <li key={c.key}>
            <label className={`${pickerRowClasses(on)} items-start`}>
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={input.key}
                className="mt-1 accent-flight-blue"
                checked={on}
                disabled={disabled}
                onChange={() => toggle(c)}
              />
              <span className={on ? 'font-medium' : ''}>{c.label}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
