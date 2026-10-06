import type { LatiyalMatch, LatiyalRecord } from './latiyal.types';

export function asRecord(value: unknown): LatiyalRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as LatiyalRecord) : null;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** First present value among `keys`. */
export function pick(source: LatiyalRecord | null, keys: readonly string[]): unknown {
  if (!source) {
    return undefined;
  }
  for (const key of keys) {
    if (!isBlank(source[key])) {
      return source[key];
    }
  }
  return undefined;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[()*,]/g, '');
    if (cleaned === '') {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function pickNumber(source: LatiyalRecord | null, keys: readonly string[]): number | null {
  return toNumber(pick(source, keys));
}

export function pickText(source: LatiyalRecord | null, keys: readonly string[]): string | null {
  return toText(pick(source, keys));
}

export function pickRecord(source: LatiyalRecord | null, keys: readonly string[]): LatiyalRecord | null {
  const value = pick(source, keys);
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }
  return asRecord(value);
}

/** Arrays, or objects keyed by index ("0", "1" …), as a list of records. */
export function toRecords(value: unknown): LatiyalRecord[] {
  const items = Array.isArray(value) ? value : asRecord(value) ? Object.values(value as LatiyalRecord) : [];
  return items.map(asRecord).filter((item): item is LatiyalRecord => item !== null);
}

export function pickRecords(source: LatiyalRecord | null, keys: readonly string[]): LatiyalRecord[] {
  return toRecords(pick(source, keys));
}

export const MATCH_ID_KEYS = ['match_id', 'matchId', 'matchid', 'id'] as const;

export function matchIdOf(raw: LatiyalRecord): number | null {
  const id = pickNumber(raw, MATCH_ID_KEYS);
  return id !== null && Number.isInteger(id) && id > 0 ? id : null;
}

/** Match records from a list payload: an array, an index-keyed object or `{ matches: [...] }`. */
export function parseMatchList(data: unknown): { matches: LatiyalMatch[]; rejected: number } | null {
  if (data === null || data === undefined || data === '') {
    return { matches: [], rejected: 0 };
  }
  let items: unknown[];
  if (Array.isArray(data)) {
    items = data;
  } else {
    const record = asRecord(data);
    if (!record) {
      return null;
    }
    const nested = Object.values(record).find(Array.isArray);
    items = matchIdOf(record) !== null ? [record] : nested ? nested : Object.values(record);
  }

  const matches: LatiyalMatch[] = [];
  let rejected = 0;
  for (const item of items) {
    const raw = asRecord(item);
    const id = raw ? matchIdOf(raw) : null;
    if (raw && id !== null) {
      matches.push({ id, raw });
    } else {
      rejected += 1;
    }
  }
  return { matches, rejected };
}

/** The match record of a per-match payload, which may be wrapped in an array. */
export function parseMatchDetail(data: unknown): LatiyalRecord | null {
  if (Array.isArray(data)) {
    return asRecord(data[0]);
  }
  return asRecord(data);
}

/** Overlays `detail` on `base`, ignoring blank detail values so they never erase list data. */
export function mergeRecords(base: LatiyalRecord, detail: LatiyalRecord | null): LatiyalRecord {
  if (!detail) {
    return base;
  }
  const merged: LatiyalRecord = { ...base };
  for (const [key, value] of Object.entries(detail)) {
    if (!isBlank(value)) {
      merged[key] = value;
    }
  }
  return merged;
}
