import type { InputValues } from '../manifest/types';
import type { RunDocument } from '../run/types';
import type { BindingContext } from './bindings';

/** Build the binding context for a stage: live form values plus every recorded stage of the run. */
export function buildBindingContext(run: RunDocument | null, inputs: InputValues = {}): BindingContext {
  const stages: BindingContext['stages'] = {};
  for (const [key, record] of Object.entries(run?.stages ?? {})) {
    stages[key] = { inputs: record.inputs, outputs: record.outputs };
  }
  return { inputs, stages };
}
