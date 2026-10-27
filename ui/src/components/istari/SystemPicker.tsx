import type { InputComponentProps } from '../../renderer/types';
import { controlClasses } from '../ui/Field';
import { errorMessage } from '../ui/ErrorState';
import { isSystemValue } from '../inputs/valueGuards';
import { useSystems } from './hooks';

export function SystemPicker({ id, input, value, onChange, disabled, invalid }: InputComponentProps) {
  const systems = useSystems();
  const current = isSystemValue(value) ? value.system_id : '';
  return (
    <div className="flex flex-col gap-1">
      <select
        id={id}
        name={input.key}
        className={`${controlClasses} max-w-md`}
        value={current}
        disabled={disabled || systems.isPending}
        aria-invalid={invalid}
        onChange={(e) => {
          const s = systems.data?.find((x) => x.systemId === e.target.value);
          onChange(s ? { system_id: s.systemId, name: s.name } : undefined);
        }}
      >
        <option value="">{systems.isPending ? 'Loading systems…' : 'Select a system…'}</option>
        {(systems.data ?? []).map((s) => (
          <option key={s.systemId} value={s.systemId}>
            {s.name}
          </option>
        ))}
      </select>
      {systems.isError && <p className="text-xs text-danger">{errorMessage(systems.error)}</p>}
    </div>
  );
}
