import { controlClasses } from '../ui/Field';
import type { InputComponentProps } from '../../renderer/types';

export function NumberInput({ id, input, value, onChange, disabled, invalid }: InputComponentProps) {
  const filter = input.filter;
  return (
    <input
      id={id}
      name={input.key}
      type="number"
      className={`${controlClasses} max-w-xs tabular-nums`}
      value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
      min={filter?.min}
      max={filter?.max}
      step={filter?.step ?? 'any'}
      disabled={disabled}
      aria-invalid={invalid}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)}
    />
  );
}
