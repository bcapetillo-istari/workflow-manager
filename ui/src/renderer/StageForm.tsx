import { useMemo, useState, type FormEvent } from 'react';
import type { InputValues, ManifestStage } from '../manifest/types';
import type { RunDocument } from '../run/types';
import { Button, Field } from '../components/ui';
import { errorMessage } from '../components/ui/ErrorState';
import { buildBindingContext } from './bindingContext';
import { resolveInputComponent } from './componentMap';
import { defaultValues, validateStage } from './validation';

export interface StageFormProps {
  stage: ManifestStage;
  run: RunDocument | null;
  onSubmit: (values: InputValues) => Promise<void> | void;
  submitLabel?: string;
  disabled?: boolean;
}

/** Renders a stage's inputs in order, tracks values, validates, and submits when valid. */
export function StageForm({ stage, run, onSubmit, submitLabel = 'Submit', disabled }: StageFormProps) {
  const [values, setValues] = useState<InputValues>(() => defaultValues(stage));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const context = useMemo(() => buildBindingContext(run, values), [run, values]);
  const errors = useMemo(() => validateStage(stage, values, context), [stage, values, context]);
  const valid = Object.keys(errors).length === 0;

  const setValue = (key: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {(stage.inputs ?? []).map((input) => {
        const id = `${stage.key}-${input.key}`;
        const error = touched[input.key] ? errors[input.key] : undefined;
        const resolved = resolveInputComponent(input);
        return (
          <Field
            key={input.key}
            id={id}
            label={input.label}
            required={input.required}
            help={input.help}
            error={error ?? (resolved.ok ? null : resolved.reason)}
          >
            {resolved.ok ? (
              <resolved.Component
                id={id}
                input={input}
                value={values[input.key]}
                onChange={(v) => setValue(input.key, v)}
                context={context}
                disabled={disabled || submitting}
                invalid={!!error}
              />
            ) : null}
          </Field>
        );
      })}
      {submitError !== null && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(submitError)}
        </p>
      )}
      <div className="flex items-center gap-3 border-t border-ink-100 pt-4">
        <Button type="submit" disabled={!valid || disabled} loading={submitting}>
          {submitLabel}
        </Button>
        {!valid && <span className="text-xs text-ink-500">Complete the required fields to continue.</span>}
      </div>
    </form>
  );
}
