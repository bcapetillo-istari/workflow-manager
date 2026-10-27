import { GatewayError } from '../gateway/types';

export function isUnauthorized(error: unknown): boolean {
  return error instanceof GatewayError && error.status === 401;
}
