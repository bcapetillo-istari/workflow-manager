import { controlClasses } from '../ui/Field';
import type { InputComponentProps } from '../../renderer/types';
import { resolveEnumOptions } from './enumOptions';

export function Select({ id, input, value, onChange, context, disabled, invalid }: InputComponentProps) {
  const resolved = resolveEnumOptions(input, context);
  const current = typeof value === 'string' ? value : '';
  const waiting = resolved.state === 'waiting';
  return (
    <div className="flex flex-col gap-1">
      <select
        id={id}
        name={input.key}
        className={`${controlClasses} max-w-md`}
        value={current}
        disabled={disabled || waiting}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        <option value="">{waiting ? 'Waiting for a dependent selection…' : 'Select…'}</option>
        {resolved.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {resolved.state === 'no-match' && (
        <p className="text-xs text-warning">No options available for “{resolved.sourceValue}”.</p>
      )}
    </div>
  );
}
