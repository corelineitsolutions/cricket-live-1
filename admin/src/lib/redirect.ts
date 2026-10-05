/** Only same-origin paths are allowed after login, so `?next=` cannot send admins elsewhere. */
export function safeNextPath(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) {
    return fallback;
  }
  return raw;
}
