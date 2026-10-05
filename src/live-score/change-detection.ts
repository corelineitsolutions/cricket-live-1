import { createHash } from 'node:crypto';
import type { LiveMatch } from './live-match.types';

/** Fields that represent a real change for clients. Timestamps and `stale` are excluded. */
export const TRACKED_FIELDS = [
  'matchId',
  'status',
  'statusDetail',
  'isLive',
  'isFinished',
  'note',
  'winnerTeamSportmonksId',
  'innings',
  'currentInning',
  'battingTeamSportmonksId',
  'score',
  'wickets',
  'overs',
  'runRate',
  'target',
  'runsRequired',
  'ballsRemaining',
  'requiredRunRate',
  'batsmen',
  'bowler',
  'localTeam',
  'visitorTeam',
  'venue',
  'startTime',
] as const satisfies ReadonlyArray<keyof LiveMatch>;

/** JSON with object keys sorted, so equal data always serializes identically. */
export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function fingerprint(match: LiveMatch): string {
  const tracked = Object.fromEntries(TRACKED_FIELDS.map((field) => [field, match[field]]));
  return createHash('sha1').update(stableStringify(tracked)).digest('hex');
}

export interface ChangeResult {
  changed: boolean;
  reason: 'new' | 'data' | 'fresh' | 'none';
  changedFields: string[];
}

export function detectChange(previous: LiveMatch | null, next: LiveMatch): ChangeResult {
  if (!previous) {
    return { changed: true, reason: 'new', changedFields: [...TRACKED_FIELDS] };
  }

  if (fingerprint(previous) !== fingerprint(next)) {
    const changedFields = TRACKED_FIELDS.filter(
      (field) => stableStringify(previous[field]) !== stableStringify(next[field]),
    );
    return { changed: true, reason: 'data', changedFields };
  }

  if (previous.stale && !next.stale) {
    return { changed: true, reason: 'fresh', changedFields: ['stale'] };
  }

  return { changed: false, reason: 'none', changedFields: [] };
}
