import type { EnumOption, ManifestInput } from '../../manifest/types';
import { resolveBinding, type BindingContext } from '../../renderer/bindings';

export type ResolvedOptions =
  | { state: 'ready'; options: EnumOption[] }
  /** options_by source has no value yet; the control is disabled. */
  | { state: 'waiting'; options: [] }
  /** options_by source resolved but matches no group. */
  | { state: 'no-match'; options: []; sourceValue: string };

/** Resolve static `options` or dependent `options_by` for an enum / multi_enum input. */
export function resolveEnumOptions(input: ManifestInput, ctx: BindingContext): ResolvedOptions {
  const filter = input.filter;
  if (filter?.options_by) {
    const raw = resolveBinding(filter.options_by.source, ctx);
    if (raw === undefined || raw === null || raw === '') return { state: 'waiting', options: [] };
    const key = String(raw);
    const group = filter.options_by.groups[key];
    return group ? { state: 'ready', options: group } : { state: 'no-match', options: [], sourceValue: key };
  }
  return { state: 'ready', options: filter?.options ?? [] };
}
