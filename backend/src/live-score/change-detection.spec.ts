import { parseFixture } from '../sportmonks/sportmonks.validation';
import { rawFixture, VISITOR_TEAM_ID } from '../testing/sportmonks-fixtures';
import { detectChange, fingerprint, stableStringify } from './change-detection';
import { normalizeFixture } from './live-match.normalizer';

const base = normalizeFixture(parseFixture(rawFixture())!, new Date('2026-10-01T16:25:00Z'));

describe('detectChange', () => {
  it('reports a first sighting as new', () => {
    expect(detectChange(null, base)).toMatchObject({ changed: true, reason: 'new' });
  });

  it('ignores identical data even when the timestamp moved', () => {
    const later = { ...base, lastUpdatedAt: '2026-10-01T16:25:10.000Z' };

    expect(detectChange(base, later)).toEqual({ changed: false, reason: 'none', changedFields: [] });
  });

  it('lists the fields that changed after a boundary', () => {
    const next = normalizeFixture(
      parseFixture(
        rawFixture({
          runs: [
            [1, 101, 180, 6, 20],
            [2, VISITOR_TEAM_ID, 124, 3, 15.3],
          ],
        }),
      )!,
      new Date('2026-10-01T16:25:10Z'),
    );

    const change = detectChange(base, next);

    expect(change.changed).toBe(true);
    expect(change.reason).toBe('data');
    expect(change.changedFields).toEqual(
      expect.arrayContaining(['innings', 'score', 'overs', 'runRate', 'runsRequired', 'ballsRemaining', 'requiredRunRate']),
    );
    expect(change.changedFields).not.toContain('wickets');
  });

  it('reports fresh data after a stale period even when the score is unchanged', () => {
    expect(detectChange({ ...base, stale: true }, base)).toEqual({
      changed: true,
      reason: 'fresh',
      changedFields: ['stale'],
    });
    expect(detectChange(base, { ...base, stale: true }).changed).toBe(false);
  });

  it('fingerprints independently of key order', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(fingerprint({ ...base })).toBe(fingerprint(base));
  });
});
