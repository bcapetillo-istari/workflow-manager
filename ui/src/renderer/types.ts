import type { ComponentType } from 'react';
import type { ManifestInput } from '../manifest/types';
import type { BindingContext } from './bindings';

/** Props every input component receives from the StageForm. Components narrow `value` themselves. */
export interface InputComponentProps {
  id: string;
  input: ManifestInput;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Live binding context for the stage (current form values + prior stages). */
  context: BindingContext;
  disabled?: boolean;
  invalid?: boolean;
}

export type InputComponent = ComponentType<InputComponentProps>;
