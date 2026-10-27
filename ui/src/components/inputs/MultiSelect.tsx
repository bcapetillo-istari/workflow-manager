import type { InputComponentProps } from '../../renderer/types';
import { resolveEnumOptions } from './enumOptions';
import { isStringArray } from './valueGuards';

export function MultiSelect({ id, input, value, onChange, context, disabled, invalid }: InputComponentProps) {
  const resolved = resolveEnumOptions(input, context);
  const selected = isStringArray(value) ? value : [];
  const waiting = resolved.state === 'waiting';
  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next.length ? next : undefined);
  };
  return (
    <fieldset
      id={id}
      aria-invalid={invalid}
      disabled={disabled || waiting}
      className={`flex min-h-9 flex-wrap items-center gap-2 rounded-md border bg-white px-2 py-1.5
        ${invalid ? 'border-danger' : 'border-ink-300'} disabled:bg-ink-50 disabled:opacity-70`}
    >
      <legend className="sr-only">{input.label}</legend>
      {waiting && <p className="px-1 text-xs text-ink-500">Waiting for a dependent selection…</p>}
      {resolved.state === 'no-match' && (
        <p className="px-1 text-xs text-warning">No options available for “{resolved.sourceValue}”.</p>
      )}
      {resolved.options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <label
            key={o.value}
            className={`flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-medium
              transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-digital-blue/40
              ${
                on
                  ? 'border-flight-blue bg-cloud-blue text-istari-blue'
                  : 'border-ink-300 bg-white text-ink-700 hover:bg-ink-50'
              }`}
          >
            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        );
      })}
    </fieldset>
  );
}
