import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCricsheetFile } from './cricsheet-file.reader';
import { parseCricsheetCsv } from './cricsheet-original.parser';
import { tokenizeCsvLine } from './csv-line.tokenizer';
import { ParsedMatch, ParseResult } from './parsed-match.types';

/** Fixtures are unmodified Cricsheet files (ODC-By 1.0, see __fixtures__/README.md). */
const fixture = (name: string) => join(__dirname, '__fixtures__', `${name}.csv`);
const parseFixture = (name: string) => parseCricsheetCsv(readFileSync(fixture(name), 'utf8'));

function expectOk(result: ParseResult): ParsedMatch {
  if (!result.ok) throw new Error(`parse failed: ${JSON.stringify(result.errors)}`);
  return result.match;
}

const codes = (result: ParseResult) => result.warnings.map((w) => w.code);

/** Real ball rows from 1120117 (four fielders) and 1068620 (two dismissals on one ball). */
const HEADER = [
  'version,1.8.0',
  'info,balls_per_over,6',
  'info,team,Wellington Firebirds',
  'info,team,Kent',
  'info,team_type,club',
  'info,gender,male',
  'info,season,2017/18',
  'info,date,2017/11/15',
  'info,match_id,test_rows',
  'info,match_type,MDM',
  'info,venue,Cello Basin Reserve',
  'info,city,',
  'info,registry,people,AM Ellis,f987245c',
  'info,registry,people,CD Fletcher,4af9f5d4',
  'info,registry,people,CE McConchie,d285acaf',
  'info,registry,people,LV van Beek,782fb776',
  'info,registry,people,MJ Henry,e84ac20c',
  'info,registry,people,TA Blundell,21e5f325',
  'info,registry,people,DI Stevens,bca21d18',
  'info,registry,people,JJ Weatherley,a05d0552',
  'info,registry,people,JL Pattinson,f752db61',
];
const FOUR_FIELDERS =
  'ball,2,49.4,Wellington Firebirds,LV van Beek,TA Blundell,AM Ellis,2,0,,,,,,run out,LV van Beek,49.4,,MJ Henry,CE McConchie,CD Fletcher,MJ Henry';
const TWO_DISMISSALS =
  'ball,3,56.6,Kent,JJ Weatherley,DI Stevens,JL Pattinson,0,0,,,,,,"bowled, retired hurt","JJ Weatherley, DI Stevens",56.6,,,,';

describe('tokenizeCsvLine', () => {
  it('handles quoted commas, escaped quotes and empty quoted fields', () => {
    expect(tokenizeCsvLine('info,venue,"Guyana National Stadium, Providence"')).toEqual([
      'info',
      'venue',
      'Guyana National Stadium, Providence',
    ]);
    expect(tokenizeCsvLine('a,"say ""hi""",""')).toEqual(['a', 'say "hi"', '']);
    expect(tokenizeCsvLine('a,,')).toEqual(['a', '', '']);
  });

  it('rejects an unterminated quote', () => {
    expect(() => tokenizeCsvLine('info,venue,"Lord\'s')).toThrow('unterminated');
  });
});

describe('CricsheetOriginalParser on real files', () => {
  it('parses a Test with a declaration and matches the official result margin', () => {
    const match = expectOk(parseFixture('1000851'));
    expect(match.matchType).toBe('Test');
    expect(match.dates).toHaveLength(5);
    expect(match.startDate).toBe('2016-11-03');
    expect(match.endDate).toBe('2016-11-07');
    expect(match.winner).toBe('South Africa');
    expect(match.winByRuns).toBe(177);

    const summary = match.innings.map((i) => [i.inningsNo, i.battingTeam, i.runs, i.wickets, i.declared]);
    expect(summary).toEqual([
      [1, 'South Africa', 242, 10, false],
      [2, 'Australia', 244, 10, false],
      [3, 'South Africa', 540, 8, true],
      [4, 'Australia', 361, 10, false],
    ]);
    const runsFor = (team: string) =>
      match.innings.filter((i) => i.battingTeam === team).reduce((sum, i) => sum + i.runs, 0);
    expect(runsFor('South Africa') - runsFor('Australia')).toBe(177);
    expect(match.players).toHaveLength(22);
    expect(match.deliveries.every((d) => d.batterId.length === 8 && d.bowlerId.length === 8)).toBe(true);
  });

  it('keeps a non-numeric match id, a quoted venue and an empty city', () => {
    const result = parseFixture('wi_201706');
    const match = expectOk(result);
    expect(match.cricsheetMatchId).toBe('wi_201706');
    expect(match.venue).toEqual({ name: 'Guyana National Stadium, Providence', city: null, cricsheetVenueId: null });
    expect(match.gender).toBe('female');
    expect(match.method).toBe('D/L');
    expect(match.officials.umpire).toEqual(['B Joseph', 'Ryan Willoughby']);
    expect(codes(result)).toContain('EMPTY_CITY');
    expect(match.winByWickets).toBe(7);
    expect(match.innings[1].wickets).toBe(3);
  });

  it('flags super-over innings and the eliminator of a tie', () => {
    const match = expectOk(parseFixture('1023647'));
    expect(match.outcome).toBe('TIE');
    expect(match.eliminator).toBe('Sydney Sixers');
    expect(match.hasSuperOver).toBe(true);
    expect(match.innings.map((i) => [i.inningsNo, i.isSuperOver])).toEqual([
      [1, false],
      [2, false],
      [3, true],
      [4, true],
    ]);
    expect(match.innings[0].runs).toBe(match.innings[1].runs);
  });

  it('adds post-innings penalty runs to the innings total', () => {
    const match = expectOk(parseFixture('1127532'));
    const first = match.innings[0];
    expect(first.penaltyPost).toBe(6);
    const fromBalls = match.deliveries.filter((d) => d.innings === 1).reduce((sum, d) => sum + d.totalRuns, 0);
    expect(first.runs).toBe(fromBalls + 6);
    expect(match.winByWickets).toBe(7);
    expect(match.innings[1].wickets).toBe(3);
  });

  it('keeps Unicode text and a 39-run margin consistent with the totals', () => {
    const match = expectOk(parseFixture('1299566'));
    expect(match.eventName).toBe('ICC Men\u2019s T20 World Cup Qualifier A');
    expect(match.winByRuns).toBe(39);
    expect(match.innings[0].runs - match.innings[1].runs).toBe(39);
  });

  it('supports five-ball overs (The Hundred)', () => {
    const match = expectOk(parseFixture('1252684'));
    expect(match.ballsPerOver).toBe(5);
    for (const innings of match.innings) expect(innings.legalBalls).toBeLessThanOrEqual(100);
    expect(match.deliveries[5]).toMatchObject({ overNo: 1, ballNo: 1, legalOverNo: 1, legalBallNo: 1 });
  });

  it('streams a file and hashes its exact bytes', async () => {
    const parsed = await readCricsheetFile(fixture('wi_201706'));
    expect(parsed.sizeBytes).toBe(readFileSync(fixture('wi_201706')).length);
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(expectOk(parsed.result).deliveries.length).toBe(
      expectOk(parseFixture('wi_201706')).deliveries.length,
    );
  });
});

describe('CricsheetOriginalParser on real edge-case rows', () => {
  it('keeps up to four fielders on a run out', () => {
    const match = expectOk(parseCricsheetCsv([...HEADER, FOUR_FIELDERS].join('\n')));
    const [wicket] = match.deliveries[0].wickets;
    expect(wicket).toMatchObject({ kind: 'run out', playerOutId: '782fb776', creditedToBowler: false });
    expect(wicket.fielderIds).toEqual(['e84ac20c', 'd285acaf', '4af9f5d4', 'e84ac20c']);
  });

  it('records two dismissals on one delivery with their own rules', () => {
    const result = parseCricsheetCsv([...HEADER, TWO_DISMISSALS].join('\n'));
    const match = expectOk(result);
    const wickets = match.deliveries[0].wickets;
    expect(wickets.map((w) => [w.kind, w.playerOutId, w.creditedToBowler, w.countsAsTeamWicket])).toEqual([
      ['bowled', 'a05d0552', true, true],
      ['retired hurt', 'bca21d18', false, false],
    ]);
    expect(match.innings[0].wickets).toBe(1);
  });

  it('applies pre-innings penalty runs and accepts the "players" alias', () => {
    const result = parseCricsheetCsv(
      [...HEADER, 'info,players,Kent,JJ Weatherley', 'penalty_runs,3,pre,5', TWO_DISMISSALS].join('\n'),
    );
    const match = expectOk(result);
    expect(match.players).toEqual([{ team: 'Kent', name: 'JJ Weatherley', personId: 'a05d0552' }]);
    expect(match.innings[0]).toMatchObject({ inningsNo: 3, penaltyPre: 5, runs: 5 });
    expect(codes(result)).toContain('PLAYERS_ALIAS');
  });

  it('links a misspelt caught batter to the striker and keeps the source name (1101737)', () => {
    const lines = [
      ...HEADER.slice(0, 2),
      'info,team,Austria',
      'info,team,Sweden',
      ...HEADER.slice(4, 12),
      'info,registry,people,I Asif,663ad386',
      'info,registry,people,LP Kasturiarachchige,82af7861',
      "info,registry,people,M O'Connor,60e35494",
      'info,registry,people,Usman Arif,af27f9e7',
      "ball,1,4.6,Austria,LP Kasturiarachchige,I Asif,Usman Arif,0,0,,,,,,caught,LK Arachchige,4.6,,M O'Connor,,",
    ];
    const result = parseCricsheetCsv(lines.join('\n'));
    const [wicket] = expectOk(result).deliveries[0].wickets;
    expect(wicket).toMatchObject({ playerOutId: '82af7861', playerOutName: 'LK Arachchige', fielderIds: ['60e35494'] });
    expect(codes(result)).toContain('DISMISSED_NAME_RESOLVED_TO_STRIKER');
  });

  it('keeps unknown info keys instead of dropping them', () => {
    const result = parseCricsheetCsv([...HEADER, 'info,new_key,a,b', FOUR_FIELDERS].join('\n'));
    expect(expectOk(result).extraInfo).toEqual({ new_key: [['a', 'b']] });
    expect(codes(result)).toContain('UNKNOWN_INFO_KEY');
  });
});

describe('CricsheetOriginalParser quarantine rules', () => {
  const quarantined = (lines: string[]) => {
    const result = parseCricsheetCsv(lines.join('\n'));
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.errors.map((e) => e.code);
  };

  it('rejects malformed lines, wrong extras and unknown names', () => {
    expect(quarantined([...HEADER, 'info,venue,"Basin'])).toContain('MALFORMED_LINE');
    expect(quarantined([...HEADER, FOUR_FIELDERS.replace(',2,0,,,,,,run out', ',2,3,,,,,,run out')])).toContain(
      'EXTRAS_MISMATCH',
    );
    expect(quarantined([...HEADER, FOUR_FIELDERS.replace('AM Ellis', 'Unknown Bowler')])).toContain(
      'NAME_NOT_IN_REGISTRY',
    );
    expect(quarantined([...HEADER, FOUR_FIELDERS.replace('Wellington Firebirds', 'Otago')])).toContain(
      'BATTING_TEAM_UNKNOWN',
    );
    expect(quarantined(['version,1.8.0', FOUR_FIELDERS])).toEqual(
      expect.arrayContaining(['MISSING_MATCH_ID', 'BAD_TEAMS', 'MISSING_DATE']),
    );
    expect(quarantined([...HEADER, 'mystery,row'])).toContain('UNKNOWN_ROW_TYPE');
  });
});
