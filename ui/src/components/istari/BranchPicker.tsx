import type { InputComponentProps } from '../../renderer/types';
import { resolveBinding } from '../../renderer/bindings';
import { controlClasses } from '../ui/Field';
import { errorMessage } from '../ui/ErrorState';
import { isBranchValue, isSystemValue } from '../inputs/valueGuards';
import { useBranches } from './hooks';

export function BranchPicker({
  id,
  input,
  value,
  onChange,
  context,
  disabled,
  invalid,
}: InputComponentProps) {
  const resolved = input.filter?.system ? resolveBinding(input.filter.system, context) : undefined;
  const systemId = isSystemValue(resolved)
    ? resolved.system_id
    : typeof resolved === 'string'
      ? resolved
      : undefined;
  const branches = useBranches(systemId);
  const current = isBranchValue(value) ? value.branch_id : '';
  const placeholder = !systemId
    ? 'Select a system first'
    : branches.isPending
      ? 'Loading branches…'
      : 'Select a branch…';
  return (
    <div className="flex flex-col gap-1">
      <select
        id={id}
        name={input.key}
        className={`${controlClasses} max-w-md`}
        value={current}
        disabled={disabled || !systemId || branches.isPending}
        aria-invalid={invalid}
        onChange={(e) => {
          const b = branches.data?.find((x) => x.branchId === e.target.value);
          onChange(b ? { branch_id: b.branchId, tag: b.tag } : undefined);
        }}
      >
        <option value="">{placeholder}</option>
        {(branches.data ?? []).map((b) => (
          <option key={b.branchId} value={b.branchId}>
            {b.tag}
            {b.isBaseline ? ' (baseline)' : ''}
          </option>
        ))}
      </select>
      {!input.filter?.system && (
        <p className="text-xs text-warning">This branch input has no `filter.system` binding.</p>
      )}
      {branches.isError && <p className="text-xs text-danger">{errorMessage(branches.error)}</p>}
    </div>
  );
}
