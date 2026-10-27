import type { AuthSecretValue, BranchValue, ResourceValue, SystemValue } from '../../manifest/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isResourceValue(v: unknown): v is ResourceValue {
  return isRecord(v) && typeof v.resource_id === 'string' && typeof v.revision_id === 'string';
}
export function isSystemValue(v: unknown): v is SystemValue {
  return isRecord(v) && typeof v.system_id === 'string';
}
export function isBranchValue(v: unknown): v is BranchValue {
  return isRecord(v) && typeof v.branch_id === 'string';
}
export function isAuthSecretValue(v: unknown): v is AuthSecretValue {
  return isRecord(v) && typeof v.secret_id === 'string';
}
export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
