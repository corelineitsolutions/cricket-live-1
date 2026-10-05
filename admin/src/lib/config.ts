/** API origin, inlined at build time. The literal `process.env.NEXT_PUBLIC_API_URL` is required for inlining. */
const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export function apiBaseUrl(raw: string = RAW_API_URL): string {
  const trimmed = raw.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return trimmed ? `${trimmed}/api/v1` : '';
}

export const API_BASE_URL = apiBaseUrl();
