import { describe, expect, it } from 'vitest';
import { apiBaseUrl } from './config';
import { dayBoundary } from './date-filter';
import { formatInterval, formatOvers, formatRelative, formatScore, humanize, teamLabel } from './format';
import { safeNextPath } from './redirect';
import { createSession, decodeJwtExpiry, isSessionValid } from './session';

describe('apiBaseUrl', () => {
  it('normalises the configured origin to the versioned API root', () => {
    expect(apiBaseUrl('https://api.example.com')).toBe('https://api.example.com/api/v1');
    expect(apiBaseUrl('https://api.example.com/')).toBe('https://api.example.com/api/v1');
    expect(apiBaseUrl(' https://api.example.com/api/v1/ ')).toBe('https://api.example.com/api/v1');
    expect(apiBaseUrl('')).toBe('');
  });
});

describe('safeNextPath', () => {
  it('only allows same-origin paths', () => {
    expect(safeNextPath('/devices?page=2')).toBe('/devices?page=2');
    expect(safeNextPath('https://evil.example')).toBe('/dashboard');
    expect(safeNextPath('//evil.example')).toBe('/dashboard');
    expect(safeNextPath('/\\evil.example')).toBe('/dashboard');
    expect(safeNextPath('/login?next=/x')).toBe('/dashboard');
    expect(safeNextPath(null)).toBe('/dashboard');
  });
});

describe('session', () => {
  const token = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

  it('reads exp from the JWT payload', () => {
    expect(decodeJwtExpiry(token({ exp: 1_790_000_000 }))).toBe(1_790_000_000_000);
    expect(decodeJwtExpiry(token({ sub: 'x' }))).toBeNull();
    expect(decodeJwtExpiry('garbage')).toBeNull();
    expect(decodeJwtExpiry('a.%%%.c')).toBeNull();
  });

  it('treats sessions about to expire as invalid', () => {
    const now = 1_790_000_000_000;
    const session = createSession(token({ exp: now / 1000 + 60 }), 'admin@example.com');
    expect(isSessionValid(session, now)).toBe(true);
    expect(isSessionValid(session, now + 57_000)).toBe(false);
    expect(isSessionValid(null, now)).toBe(false);
  });
});

describe('format helpers', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  it('formats relative times', () => {
    expect(formatRelative(null, now)).toBe('never');
    expect(formatRelative('2026-10-01T11:59:58Z', now)).toBe('just now');
    expect(formatRelative('2026-10-01T11:59:48Z', now)).toBe('12 s ago');
    expect(formatRelative('2026-10-01T12:00:08Z', now)).toBe('in 8 s');
    expect(formatRelative('2026-10-01T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-10-01T09:00:00Z', now)).toBe('3 h ago');
  });

  it('formats intervals, scores, overs and labels', () => {
    expect(formatInterval(10_000)).toBe('10 s');
    expect(formatInterval(90_000)).toBe('1.5 min');
    expect(formatInterval(null)).toBe('—');
    expect(formatScore(120, 3)).toBe('120/3');
    expect(formatScore(120, null)).toBe('120');
    expect(formatScore(null, 3)).toBe('—');
    expect(formatOvers(15.2)).toBe('15.2');
    expect(formatOvers(20)).toBe('20');
    expect(teamLabel({ shortName: null, name: 'India' })).toBe('India');
    expect(teamLabel({ shortName: null, name: null })).toBe('TBD');
    expect(humanize('HOME_BANNER')).toBe('Home banner');
    expect(humanize('rate-limited')).toBe('Rate limited');
  });
});

describe('dayBoundary', () => {
  it('maps a date input to the start or end of that local day', () => {
    const start = dayBoundary('2026-10-01', 'start');
    const end = dayBoundary('2026-10-01', 'end');
    expect(start && new Date(start).getHours()).toBe(0);
    expect(end && new Date(end).getMinutes()).toBe(59);
    expect(Date.parse(end!) - Date.parse(start!)).toBe(86_399_999);
    expect(dayBoundary('', 'start')).toBeUndefined();
    expect(dayBoundary('01/10/2026', 'end')).toBeUndefined();
  });
});
