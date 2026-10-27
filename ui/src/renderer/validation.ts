import type { InputValues, ManifestInput, ManifestStage } from '../manifest/types';
import type { BindingContext } from './bindings';
import { resolveEnumOptions } from '../components/inputs/enumOptions';

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Client-side validation for one input. Returns an error message or null. */
export function validateInput(input: ManifestInput, value: unknown, ctx: BindingContext): string | null {
  const filter = input.filter;
  if (isEmptyValue(value)) return input.required ? 'This field is required.' : null;

  switch (input.type) {
    case 'text': {
      if (typeof value !== 'string') return 'Expected text.';
      if (filter?.max_length !== undefined && value.length > filter.max_length) {
        return `Must be at most ${filter.max_length} characters (currently ${value.length}).`;
      }
      if (filter?.pattern) {
        try {
          if (!new RegExp(filter.pattern).test(value)) return 'Value does not match the required format.';
        } catch {
          return `Manifest pattern "${filter.pattern}" is not a valid regular expression.`;
        }
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) return 'Enter a number.';
      if (filter?.min !== undefined && value < filter.min) return `Must be at least ${filter.min}.`;
      if (filter?.max !== undefined && value > filter.max) return `Must be at most ${filter.max}.`;
      return null;
    }
    case 'enum': {
      const options = resolveEnumOptions(input, ctx);
      if (options.state === 'ready' && !options.options.some((o) => o.value === value)) {
        return 'Choose one of the listed options.';
      }
      return null;
    }
    case 'multi_enum': {
      if (!Array.isArray(value)) return 'Expected a list.';
      if (filter?.min !== undefined && value.length < filter.min) return `Select at least ${filter.min}.`;
      if (filter?.max !== undefined && value.length > filter.max) return `Select at most ${filter.max}.`;
      return null;
    }
    default:
      return null;
  }
}

export type StageErrors = Record<string, string>;

export function validateStage(stage: ManifestStage, values: InputValues, ctx: BindingContext): StageErrors {
  const errors: StageErrors = {};
  for (const input of stage.inputs ?? []) {
    const err = validateInput(input, values[input.key], ctx);
    if (err) errors[input.key] = err;
  }
  return errors;
}

/** Initial values from manifest defaults. */
export function defaultValues(stage: ManifestStage): InputValues {
  const values: InputValues = {};
  for (const input of stage.inputs ?? []) {
    if (input.default !== undefined) values[input.key] = input.default;
  }
  return values;
}
