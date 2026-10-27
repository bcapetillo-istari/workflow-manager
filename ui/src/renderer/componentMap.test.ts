import { describe, expect, it } from 'vitest';
import type { InputType, ManifestInput } from '../manifest/types';
import { componentMap, resolveInputComponent } from './componentMap';

const ALL_TYPES: InputType[] = [
  'resource',
  'system',
  'branch',
  'auth_secret',
  'text',
  'number',
  'boolean',
  'enum',
  'multi_enum',
  'stage_output',
];

describe('componentMap', () => {
  it('maps every InputType to exactly one component', () => {
    for (const type of ALL_TYPES) expect(componentMap[type], type).toBeTypeOf('function');
    expect(Object.keys(componentMap).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('resolves the default component for a type', () => {
    const input: ManifestInput = { key: 'a', label: 'A', type: 'text' };
    const r = resolveInputComponent(input);
    expect(r.ok && r.Component).toBe(componentMap.text);
  });

  it('honours a component override from the custom registry and reports missing ones', () => {
    const Custom = () => null;
    const input: ManifestInput = { key: 'a', label: 'A', type: 'text', component: 'MyPicker' };
    const found = resolveInputComponent(input, { MyPicker: Custom });
    expect(found.ok && found.Component).toBe(Custom);
    expect(found.ok && found.custom).toBe(true);
    const missing = resolveInputComponent(input, {});
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.reason).toMatch(/MyPicker/);
  });
});
