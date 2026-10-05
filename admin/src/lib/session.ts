/**
 * Admin session in sessionStorage: cleared when the tab closes, never sent automatically
 * (no cookies, so no CSRF surface). The JWT is verified by the API on every request;
 * the client only reads `exp` to log out on time.
 */
const STORAGE_KEY = 'cricket-live-admin-session';
export const SESSION_EXPIRED_EVENT = 'cricket-live:session-expired';

export interface Session {
  token: string;
  email: string;
  expiresAt: number;
}

export function decodeJwtExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function createSession(token: string, email: string): Session {
  return { token, email, expiresAt: decodeJwtExpiry(token) ?? Date.now() + 8 * 3_600_000 };
}

export function isSessionValid(session: Session | null, now = Date.now()): session is Session {
  return Boolean(session && session.token && session.expiresAt > now + 5_000);
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSession: Session | null = null;

/** Returns the same object until the stored value changes (required by useSyncExternalStore). */
export function loadSession(): Session | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedSession = JSON.parse(raw ?? 'null') as Session | null;
    } catch {
      cachedSession = null;
    }
  }
  return isSessionValid(cachedSession) ? cachedSession : null;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveSession(session: Session): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  listeners.forEach((listener) => listener());
}

export function clearSession(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(STORAGE_KEY);
    listeners.forEach((listener) => listener());
  }
}
