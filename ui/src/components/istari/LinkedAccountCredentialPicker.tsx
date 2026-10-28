import type { AuthSecretSummary } from '../../gateway/types';
import type { InputComponentProps } from '../../renderer/types';
import { Spinner, pickerListClasses, pickerRowClasses } from '../ui';
import { errorMessage } from '../ui/ErrorState';
import { isAuthSecretValue } from '../inputs/valueGuards';
import { useAuthSecrets } from './hooks';

/** Picks an Istari function auth secret. The secret value never reaches the browser; only its id. */
export function LinkedAccountCredentialPicker({
  id,
  input,
  value,
  onChange,
  disabled,
  invalid,
}: InputComponentProps) {
  const secrets = useAuthSecrets(input.filter?.secret_type);
  const current = isAuthSecretValue(value) ? value.secret_id : undefined;
  const pick = (s: AuthSecretSummary) =>
    onChange({ secret_id: s.secretId, name: s.name });

  if (secrets.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Spinner size="sm" /> Loading credentials…
      </div>
    );
  }
  if (secrets.isError) return <p className="text-sm text-danger">{errorMessage(secrets.error)}</p>;
  if (secrets.data.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        No linked account credentials{input.filter?.secret_type ? ` matching ${input.filter.secret_type}` : ''}.
        Link one in Istari (Settings, Linked Accounts) first.
      </p>
    );
  }
  return (
    <ul
      id={id}
      role="radiogroup"
      aria-invalid={invalid}
      className={pickerListClasses(invalid)}
    >
      {secrets.data.map((s) => {
        const on = s.secretId === current;
        return (
          <li key={s.secretId}>
            <label className={pickerRowClasses(on)}>
              <input
                type="radio"
                name={input.key}
                className="accent-flight-blue"
                checked={on}
                disabled={disabled}
                onChange={() => pick(s)}
              />
              <span className="flex-1 truncate font-medium">{s.name}</span>
              {s.expiration && (
                <span className={`text-xs ${on ? 'text-istari-blue/80' : 'text-ink-500'}`}>
                  expires {new Date(s.expiration).toLocaleDateString()}
                </span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
