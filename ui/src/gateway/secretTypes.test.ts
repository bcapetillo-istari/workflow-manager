import { describe, expect, it } from 'vitest';
import { matchesSecretType, normalizeSecretType } from './secretTypes';

describe('secret type matching', () => {
  it('lists everything when no filter is given', () => {
    expect(matchesSecretType('token', undefined)).toBe(true);
    expect(matchesSecretType('basic', '')).toBe(true);
    expect(matchesSecretType(undefined, undefined)).toBe(true);
  });
  it('maps Istari validation types to credential auth types', () => {
    expect(normalizeSecretType('@token:llm')).toBe('token');
    expect(matchesSecretType('token', '@token:llm')).toBe(true);
    expect(matchesSecretType('basic', '@token:llm')).toBe(false);
    expect(matchesSecretType('oauth2', '@oauth')).toBe(true);
    expect(matchesSecretType('basic', 'basic')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(matchesSecretType('Token', 'TOKEN')).toBe(true);
  });
});
