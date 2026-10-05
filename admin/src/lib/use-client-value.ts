'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => undefined;

/**
 * Reads a browser-only value without a hydration mismatch: `serverValue` during SSR and
 * hydration, then `read()` on the client. `read` must return a primitive or a stable reference.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => serverValue);
}
