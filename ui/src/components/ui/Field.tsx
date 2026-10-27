import type { ReactNode } from 'react';

export interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  help?: string;
  error?: string | null;
  children: ReactNode;
}

/** Wraps an input with label, help text and validation error. */
export function Field({ id, label, required, help, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-700">
        {label}
        {required && (
          <span className="ml-0.5 text-flight-blue" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {help && !error && (
        <p id={`${id}-help`} className="text-xs text-ink-500">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared classes for text-like controls so every input looks the same. */
export const controlClasses =
  'block w-full rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm leading-5 text-apple-black shadow-sm ' +
  'placeholder:text-ink-400 focus:border-digital-blue focus:outline-none focus:ring-2 focus:ring-digital-blue/30 ' +
  'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20';

/** Classes for a selectable row in a picker list (resources, credentials, outputs). */
export function pickerRowClasses(selected: boolean): string {
  return `flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors
    focus:outline-none focus-visible:bg-ink-50 ${
      selected ? 'bg-cloud-blue text-istari-blue' : 'text-ink-800 hover:bg-ink-50'
    }`;
}

/** Classes for the bordered container around a picker list. */
export function pickerListClasses(invalid?: boolean): string {
  return `overflow-hidden rounded-md border bg-white divide-y divide-ink-100 ${
    invalid ? 'border-danger' : 'border-ink-300'
  }`;
}
