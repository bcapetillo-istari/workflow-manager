import type { EnumOption, ManifestInput } from '../../manifest/types';
import { resolveBinding, type BindingContext } from '../../renderer/bindings';

export type ResolvedOptions =
  | { state: 'ready'; options: EnumOption[] }
  /** options_by source has no value yet; the control is disabled. */
  | { state: 'waiting'; options: [] }
  /** options_by source resolved but matches no group. */
  | { state: 'no-match'; options: []; sourceValue: string };

/** Pick the option group for a resolved source value: exact key match, or first key contained in the value. */
export function selectGroup(
  groups: Record<string, EnumOption[]>,
  value: string,
  match: 'exact' | 'contains',
): EnumOption[] | undefined {
  if (match === 'exact') return groups[value];
  const haystack = value.toLowerCase();
  const key = Object.keys(groups).find((k) => haystack.includes(k.toLowerCase()));
  return key === undefined ? undefined : groups[key];
}

/** Resolve static `options` or dependent `options_by` for an enum / multi_enum input. */
export function resolveEnumOptions(input: ManifestInput, ctx: BindingContext): ResolvedOptions {
  const filter = input.filter;
  if (filter?.options_by) {
    const raw = resolveBinding(filter.options_by.source, ctx);
    if (raw === undefined || raw === null || raw === '') return { state: 'waiting', options: [] };
    const value = String(raw);
    const group = selectGroup(filter.options_by.groups, value, filter.options_by.match ?? 'exact');
    return group ? { state: 'ready', options: group } : { state: 'no-match', options: [], sourceValue: value };
  }
  return { state: 'ready', options: filter?.options ?? [] };
}
