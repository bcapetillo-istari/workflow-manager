/**
 * The ONLY registration point mapping a manifest input `type` to a React component.
 * Adding a type: add the component and one row here (and a row in docs/manifest-schema.md).
 */
import type { InputType, ManifestInput } from '../manifest/types';
import type { InputComponent } from './types';
import { customComponents } from '../workflows';
import { ResourcePicker } from '../components/istari/ResourcePicker';
import { SystemPicker } from '../components/istari/SystemPicker';
import { BranchPicker } from '../components/istari/BranchPicker';
import { LinkedAccountCredentialPicker } from '../components/istari/LinkedAccountCredentialPicker';
import { TextInput } from '../components/inputs/TextInput';
import { NumberInput } from '../components/inputs/NumberInput';
import { Toggle } from '../components/inputs/Toggle';
import { Select } from '../components/inputs/Select';
import { MultiSelect } from '../components/inputs/MultiSelect';
import { OutputPicker } from '../components/inputs/OutputPicker';

export const componentMap: Record<InputType, InputComponent> = {
  resource: ResourcePicker,
  system: SystemPicker,
  branch: BranchPicker,
  auth_secret: LinkedAccountCredentialPicker,
  text: TextInput,
  number: NumberInput,
  boolean: Toggle,
  enum: Select,
  multi_enum: MultiSelect,
  stage_output: OutputPicker,
};

export type ResolvedComponent =
  { ok: true; Component: InputComponent; custom: boolean } | { ok: false; reason: string };

/** Resolve the component for an input, honouring a `component` override from the custom registry. */
export function resolveInputComponent(
  input: ManifestInput,
  registry: Record<string, InputComponent> = customComponents,
): ResolvedComponent {
  if (input.component) {
    const Component = registry[input.component];
    if (Component) return { ok: true, Component, custom: true };
    return { ok: false, reason: `Custom component "${input.component}" is not compiled into this build.` };
  }
  const Component = componentMap[input.type];
  if (Component) return { ok: true, Component, custom: false };
  return { ok: false, reason: `Unknown input type "${String(input.type)}".` };
}
