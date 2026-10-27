import type { InputComponentProps } from '../../renderer/types';

export function Toggle({ id, input, value, onChange, disabled }: InputComponentProps) {
  const checked = value === true;
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={input.label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-digital-blue focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-flight-blue' : 'bg-ink-300'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform
          ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
