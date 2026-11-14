import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = canonicalize(v);
      }
    }
    return sorted;
  }
  return value;
}

export function hashIdempotencyPayload(payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return createHash('sha256').update(canonical).digest('hex');
}
