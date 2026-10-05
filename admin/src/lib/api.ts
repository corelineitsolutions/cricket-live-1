import { API_BASE_URL } from './config';
import { clearSession, loadSession, SESSION_EXPIRED_EVENT } from './session';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: string[] = [],
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** One line for the UI, including field errors from VALIDATION_ERROR. */
  describe(): string {
    return this.errors.length > 0 ? `${this.message}: ${this.errors.join('; ')}` : this.message;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Send the admin JWT. Defaults to true. */
  auth?: boolean;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query: Query = {}, base = API_BASE_URL): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

/** Turns any response into data or an ApiError, following the backend envelope. */
export async function parseResponse<T>(response: Response): Promise<{ data: T; meta?: PaginationMeta }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = (body ?? {}) as Record<string, unknown>;
  if (response.ok && record.success === true) {
    return { data: record.data as T, meta: record.meta as PaginationMeta | undefined };
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  throw new ApiError(
    response.status,
    typeof record.code === 'string' ? record.code : response.ok ? 'INVALID_RESPONSE' : `HTTP_${response.status}`,
    typeof record.message === 'string' ? record.message : `Request failed (${response.status})`,
    Array.isArray(record.errors) ? record.errors.filter((item): item is string => typeof item === 'string') : [],
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  );
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: PaginationMeta }> {
  if (!API_BASE_URL) {
    throw new ApiError(0, 'NOT_CONFIGURED', 'NEXT_PUBLIC_API_URL is not set. Rebuild the admin panel with the API URL.');
  }
  const auth = options.auth ?? true;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const session = loadSession();
    if (!session) {
      expireSession();
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    }
    headers.Authorization = `Bearer ${session.token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API. Check that the NestJS API is running.');
  }

  try {
    return await parseResponse<T>(response);
  } catch (error) {
    if (auth && error instanceof ApiError && error.status === 401) {
      expireSession();
    }
    throw error;
  }
}

function expireSession(): void {
  clearSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}
