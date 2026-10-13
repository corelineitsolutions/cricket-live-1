import { CsvLineError, tokenizeCsvLine } from './csv-line.tokenizer';
import {
  HistMatchOutcome,
  ParsedDelivery,
  ParsedInnings,
  ParsedMatch,
  ParsedPlayer,
  ParsedWicket,
  ParseIssue,
  ParseResult,
} from './parsed-match.types';

const BALL_COLUMNS = 21;
const MAX_FIELDERS = 4;
const OVER_BALL = /^(\d+)\.(\d+)$/;
const NON_NEGATIVE_INT = /^\d+$/;
const DATE = /^(\d{4})[/-](\d{2})[/-](\d{2})$/;

const BOWLER_CREDITED = new Set(['bowled', 'caught', 'caught and bowled', 'lbw', 'stumped', 'hit wicket']);
const NOT_TEAM_WICKET = new Set(['retired hurt', 'retired not out']);
const KNOWN_WICKET_KINDS = new Set([
  ...BOWLER_CREDITED,
  ...NOT_TEAM_WICKET,
  'run out',
  'retired out',
  'obstructing the field',
  'handled the ball',
  'hit the ball twice',
  'timed out',
]);
const FIELDING_KINDS = new Set(['caught', 'run out', 'stumped']);

const OFFICIAL_KEYS = ['umpire', 'tv_umpire', 'reserve_umpire', 'match_referee'];
const KNOWN_INFO_KEYS = new Set([
  'balls_per_over',
  'team',
  'team_type',
  'gender',
  'season',
  'date',
  'event',
  'match_id',
  'match_type',
  'match_type_number',
  'match_number',
  'overs',
  'venue',
  'city',
  'neutralvenue',
  'neutral_venue',
  'toss_winner',
  'toss_decision',
  'toss_uncontested',
  'winner',
  'winner_runs',
  'winner_wickets',
  'winner_innings',
  'outcome',
  'method',
  'eliminator',
  'bowl_out',
  'player_of_match',
  'player',
  'players',
  'registry',
  'declared',
  'forfeited',
  'super_over',
  'target_overs',
  'target_runs',
  ...OFFICIAL_KEYS,
]);

interface RawBall {
  line: number;
  fields: string[];
}

interface RawPenalty {
  line: number;
  innings: number;
  when: 'pre' | 'post';
  runs: number;
}

/** True when a Cricsheet wicket kind is credited to the bowler. */
export function isBowlerCredited(kind: string): boolean {
  return BOWLER_CREDITED.has(kind);
}

/** True when a wicket kind ends a batter's innings as "out" (retired hurt / not out do not). */
export function countsAsTeamWicket(kind: string): boolean {
  return !NOT_TEAM_WICKET.has(kind);
}

/**
 * Streaming parser for one Cricsheet classic CSV file. Feed lines with `push()` in file
 * order, then call `finish()`. Fatal problems quarantine the file; recoverable quirks are
 * returned as warnings and the source value is kept.
 */
export class CricsheetOriginalParser {
  private version: string | null = null;
  private readonly info = new Map<string, string[][]>();
  private readonly people = new Map<string, string>();
  private readonly venueRegistry = new Map<string, string>();
  private readonly players: Array<{ team: string; name: string; line: number }> = [];
  private readonly balls: RawBall[] = [];
  private readonly penalties: RawPenalty[] = [];
  private readonly errors: ParseIssue[] = [];
  private readonly warnings: ParseIssue[] = [];
  private lineNo = 0;

  push(rawLine: string): void {
    this.lineNo++;
    let line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (this.lineNo === 1 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    if (line === '') return;

    let fields: string[];
    try {
      fields = tokenizeCsvLine(line);
    } catch (error) {
      const message = error instanceof CsvLineError ? error.message : 'unreadable line';
      this.error('MALFORMED_LINE', message);
      return;
    }

    switch (fields[0]) {
      case 'version':
        this.version = fields[1] ?? null;
        return;
      case 'info':
        this.pushInfo(fields);
        return;
      case 'ball':
        this.balls.push({ line: this.lineNo, fields });
        return;
      case 'penalty_runs':
        this.pushPenalty(fields);
        return;
      default:
        this.error('UNKNOWN_ROW_TYPE', `unknown row type "${fields[0].slice(0, 32)}"`);
    }
  }

  finish(): ParseResult {
    const match = this.errors.length === 0 ? this.build() : null;
    if (match && this.errors.length === 0) return { ok: true, match, warnings: this.warnings };
    return { ok: false, errors: this.errors, warnings: this.warnings };
  }

  private pushInfo(fields: string[]): void {
    const key = fields[1] ?? '';
    const values = fields.slice(2);
    if (key === 'registry') {
      const [kind, name, id] = values;
      if (!name || !id) {
        this.error('BAD_REGISTRY_ROW', 'registry row without name or id');
      } else if (kind === 'people') {
        const existing = this.people.get(name);
        if (existing && existing !== id) this.error('REGISTRY_CONFLICT', `registry name maps to two ids`);
        this.people.set(name, id);
      } else if (kind === 'venues') {
        this.venueRegistry.set(name, id);
      } else {
        this.addExtraInfo(key, values);
      }
      return;
    }
    if (key === 'player' || key === 'players') {
      if (key === 'players') this.warnOnce('PLAYERS_ALIAS', 'info key "players" used instead of "player"');
      const [team, name] = values;
      if (!team || !name) this.error('BAD_PLAYER_ROW', 'player row without team or name');
      else this.players.push({ team, name, line: this.lineNo });
      return;
    }
    if (!KNOWN_INFO_KEYS.has(key)) {
      this.addExtraInfo(key, values);
      return;
    }
    const list = this.info.get(key) ?? [];
    list.push(values);
    this.info.set(key, list);
  }

  private addExtraInfo(key: string, values: string[]): void {
    this.warn('UNKNOWN_INFO_KEY', `unmodelled info key "${key.slice(0, 40)}" kept in extra_info`);
    const list = this.info.get(`extra:${key}`) ?? [];
    list.push(values);
    this.info.set(`extra:${key}`, list);
  }

  private pushPenalty(fields: string[]): void {
    const [, inningsRaw, when, runsRaw] = fields;
    if (!NON_NEGATIVE_INT.test(inningsRaw ?? '') || !NON_NEGATIVE_INT.test(runsRaw ?? '') || (when !== 'pre' && when !== 'post')) {
      this.error('BAD_PENALTY_ROW', 'penalty_runs row is malformed');
      return;
    }
    this.penalties.push({ line: this.lineNo, innings: Number(inningsRaw), when, runs: Number(runsRaw) });
  }

  private build(): ParsedMatch | null {
    if (!this.version) this.error('MISSING_VERSION', 'missing version row');
    const matchId = this.single('match_id');
    const matchType = this.single('match_type');
    const teams = this.all('team').map((v) => v[0]).filter(Boolean);
    const dates = this.all('date').map((v) => v[0]);
    const venueName = this.single('venue');
    if (!matchId) this.error('MISSING_MATCH_ID', 'missing info match_id');
    if (!matchType) this.error('MISSING_MATCH_TYPE', 'missing info match_type');
    if (teams.length !== 2 || teams[0] === teams[1]) this.error('BAD_TEAMS', 'expected exactly two distinct teams');
    if (dates.length === 0) this.error('MISSING_DATE', 'missing info date');
    if (!venueName) this.error('MISSING_VENUE', 'missing info venue');

    const isoDates: string[] = [];
    for (const date of dates) {
      const m = DATE.exec(date ?? '');
      if (!m) this.error('BAD_DATE', 'unparseable date');
      else isoDates.push(`${m[1]}-${m[2]}-${m[3]}`);
    }

    const ballsPerOverRaw = this.single('balls_per_over') ?? '6';
    const ballsPerOver = Number(ballsPerOverRaw);
    if (!NON_NEGATIVE_INT.test(ballsPerOverRaw) || ballsPerOver < 1) this.error('BAD_BALLS_PER_OVER', 'invalid balls_per_over');
    if (!this.single('balls_per_over')) this.warn('MISSING_BALLS_PER_OVER', 'balls_per_over missing, assumed 6');

    if (this.errors.length > 0) return null;
    const [team1, team2] = teams as [string, string];
    const teamSet = new Set(teams);

    const players: ParsedPlayer[] = [];
    const seenPlayers = new Set<string>();
    for (const p of this.players) {
      const personId = this.people.get(p.name);
      if (!teamSet.has(p.team)) {
        this.error('PLAYER_TEAM_UNKNOWN', 'player listed for a team not in the match', p.line);
        continue;
      }
      if (!personId) {
        this.error('PLAYER_NOT_IN_REGISTRY', 'player name missing from registry', p.line);
        continue;
      }
      if (seenPlayers.has(personId)) {
        this.warn('DUPLICATE_PLAYER', 'player listed more than once; first entry kept', p.line);
        continue;
      }
      seenPlayers.add(personId);
      players.push({ team: p.team, name: p.name, personId });
    }

    const deliveries = this.buildDeliveries(teamSet);
    if (this.errors.length > 0) return null;

    const declared = this.inningsSet('declared');
    const forfeited = this.inningsSet('forfeited');
    const superOvers = this.inningsSet('super_over');
    const innings = this.buildInnings(deliveries, [team1, team2], { declared, forfeited, superOvers });

    const playerOfMatchIds: string[] = [];
    for (const [name] of this.all('player_of_match')) {
      const id = name ? this.people.get(name) : undefined;
      if (id) playerOfMatchIds.push(id);
      else this.warn('POM_NOT_IN_REGISTRY', 'player_of_match name missing from registry');
    }

    const officials: Record<string, string[]> = {};
    for (const key of OFFICIAL_KEYS) {
      const names = this.all(key).map((v) => v[0]).filter(Boolean);
      if (names.length > 0) officials[key] = names;
    }
    const extraInfo: Record<string, string[][]> = {};
    for (const [key, values] of this.info) {
      if (key.startsWith('extra:')) extraInfo[key.slice(6)] = values;
    }

    const city = this.single('city') || null;
    if (!city) this.warnOnce('EMPTY_CITY', 'city is empty');
    if (this.info.has('neutralvenue') && !this.info.has('neutral_venue')) {
      this.warnOnce('NEUTRALVENUE_ALIAS', 'info key "neutralvenue" used instead of "neutral_venue"');
    }

    const result = this.buildResult(teamSet);
    const tossWinner = this.single('toss_winner') || null;
    if (tossWinner && !teamSet.has(tossWinner)) this.warn('TOSS_WINNER_UNKNOWN', 'toss winner is not a match team');

    const sortedDates = [...isoDates].sort();
    return {
      cricsheetMatchId: matchId!,
      formatVersion: this.version!,
      ballsPerOver,
      teams: [team1, team2],
      teamType: this.single('team_type') ?? 'unknown',
      gender: this.single('gender') ?? 'unknown',
      season: this.single('season') ?? '',
      dates: isoDates,
      startDate: sortedDates[0],
      endDate: sortedDates[sortedDates.length - 1],
      eventName: this.single('event') || null,
      matchNumber: this.single('match_number') || null,
      matchTypeNumber: this.optionalInt('match_type_number'),
      matchType: matchType!,
      oversLimit: this.optionalInt('overs'),
      venue: { name: venueName!, city, cricsheetVenueId: this.venueRegistry.get(venueName!) ?? null },
      neutralVenue: this.flag('neutralvenue') || this.flag('neutral_venue'),
      tossWinner,
      tossDecision: this.single('toss_decision') || null,
      tossUncontested: this.flag('toss_uncontested'),
      ...result,
      hasSuperOver: innings.some((i) => i.isSuperOver),
      officials,
      extraInfo,
      playerOfMatchIds,
      people: [...this.people].map(([name, id]) => ({ id, name })),
      players,
      innings,
      deliveries,
    };
  }

  private buildDeliveries(teamSet: Set<string>): ParsedDelivery[] {
    const deliveries: ParsedDelivery[] = [];
    const seqByInnings = new Map<number, number>();
    let lastInnings = 0;

    for (const { line, fields } of this.balls) {
      if (fields.length < BALL_COLUMNS) {
        this.error('SHORT_BALL_ROW', `ball row has ${fields.length} fields`, line);
        continue;
      }
      const innings = Number(fields[1]);
      const over = OVER_BALL.exec(fields[2]);
      const legal = OVER_BALL.exec(fields[16]);
      if (!NON_NEGATIVE_INT.test(fields[1]) || innings < 1 || !over || !legal) {
        this.error('BAD_BALL_POSITION', 'invalid innings or over.ball', line);
        continue;
      }
      if (innings < lastInnings) this.warn('INNINGS_OUT_OF_ORDER', 'ball rows go back to an earlier innings', line);
      lastInnings = innings;

      const numbers: number[] = [];
      for (let i = 7; i <= 13; i++) {
        const value = fields[i].trim();
        if (value !== '' && !NON_NEGATIVE_INT.test(value)) {
          this.error('BAD_RUNS', 'non-numeric runs or extras', line);
          break;
        }
        numbers.push(value === '' ? 0 : Number(value));
      }
      if (numbers.length !== 7) continue;
      const [runsBatter, extras, wides, noballs, byes, legbyes, penalty] = numbers;
      if (extras !== wides + noballs + byes + legbyes + penalty) {
        this.error('EXTRAS_MISMATCH', 'extras total differs from its breakdown', line);
        continue;
      }

      const battingTeam = fields[3];
      if (!teamSet.has(battingTeam)) {
        this.error('BATTING_TEAM_UNKNOWN', 'batting team is not a match team', line);
        continue;
      }
      const batterId = this.people.get(fields[4]);
      const nonStrikerId = this.people.get(fields[5]);
      const bowlerId = this.people.get(fields[6]);
      if (!batterId || !nonStrikerId || !bowlerId) {
        this.error('NAME_NOT_IN_REGISTRY', 'batter, non-striker or bowler missing from registry', line);
        continue;
      }

      const fielders = fields.slice(18).map((f) => f.trim()).filter(Boolean);
      if (fields.length > BALL_COLUMNS) this.warn('EXTRA_FIELDER_COLUMNS', `ball row has ${fields.length} fields`, line);
      const wickets = this.buildWickets(fields[14], fields[15], fielders, batterId, line);
      if (!wickets) continue;

      const seq = (seqByInnings.get(innings) ?? 0) + 1;
      seqByInnings.set(innings, seq);
      deliveries.push({
        innings,
        seq,
        overNo: Number(over[1]),
        ballNo: Number(over[2]),
        legalOverNo: Number(legal[1]),
        legalBallNo: Number(legal[2]),
        battingTeam,
        batterId,
        nonStrikerId,
        bowlerId,
        runsBatter,
        extras,
        wides,
        noballs,
        byes,
        legbyes,
        penalty,
        totalRuns: runsBatter + extras,
        isLegal: wides === 0 && noballs === 0,
        nonBoundary: fields[17].trim().toLowerCase() === 'true',
        wickets,
      });
    }
    return deliveries;
  }

  private buildWickets(
    kindsRaw: string,
    playersRaw: string,
    fielders: string[],
    strikerId: string,
    line: number,
  ): ParsedWicket[] | null {
    const kinds = splitList(kindsRaw);
    const outNames = splitList(playersRaw);
    if (kinds.length === 0) {
      if (outNames.length > 0 || fielders.length > 0) {
        this.error('ORPHAN_DISMISSAL_DATA', 'dismissed player or fielder without a wicket kind', line);
        return null;
      }
      return [];
    }
    if (kinds.length !== outNames.length) {
      this.warn('DISMISSAL_COUNT_MISMATCH', 'number of wicket kinds and dismissed players differ', line);
    }
    if (kinds.length > 2) this.warn('MANY_DISMISSALS_ON_BALL', `${kinds.length} dismissals recorded on one delivery`, line);

    if (fielders.length > MAX_FIELDERS) this.warn('TOO_MANY_FIELDERS', 'more than four fielders; extras kept as unresolved', line);
    const fielderIds: Array<string | null> = [];
    const unresolvedFielders: string[] = [];
    fielders.forEach((name, index) => {
      const id = this.people.get(name);
      if (index < MAX_FIELDERS && id) fielderIds.push(id);
      else {
        if (index < MAX_FIELDERS) fielderIds.push(null);
        unresolvedFielders.push(name);
      }
    });
    if (unresolvedFielders.length > 0) this.warn('FIELDER_NOT_IN_REGISTRY', 'fielder name kept as text', line);

    let fieldingIndex = kinds.findIndex((k) => FIELDING_KINDS.has(k));
    if (fieldingIndex < 0) fieldingIndex = 0;
    if (fielders.length > 0 && kinds.length > 1) {
      this.warn('FIELDER_ATTRIBUTION_AMBIGUOUS', 'fielders attached to the first fielding dismissal on the delivery', line);
    }

    const wickets: ParsedWicket[] = [];
    for (let i = 0; i < Math.max(kinds.length, outNames.length); i++) {
      const kind = kinds[i] ?? 'unknown';
      if (!KNOWN_WICKET_KINDS.has(kind)) this.warn('UNKNOWN_WICKET_KIND', `unknown wicket kind "${kind.slice(0, 40)}"`, line);
      const playerOutName = outNames[i] ?? null;
      const registryId = playerOutName ? (this.people.get(playerOutName) ?? null) : null;
      let playerOutId = registryId;
      if (playerOutName && !registryId) {
        // Only the striker can be bowled, caught, lbw, stumped or out hit wicket.
        if (isBowlerCredited(kind)) {
          playerOutId = strikerId;
          this.warn('DISMISSED_NAME_RESOLVED_TO_STRIKER', 'dismissed name not in registry; striker used, name kept', line);
        } else {
          this.warn('DISMISSED_NOT_IN_REGISTRY', 'dismissed player kept as text', line);
        }
      }
      wickets.push({
        ordinal: i + 1,
        kind,
        playerOutName: registryId ? null : playerOutName,
        playerOutId,
        creditedToBowler: isBowlerCredited(kind),
        countsAsTeamWicket: KNOWN_WICKET_KINDS.has(kind) ? countsAsTeamWicket(kind) : true,
        fielderIds: i === fieldingIndex ? fielderIds : [],
        unresolvedFielders: i === fieldingIndex ? unresolvedFielders : [],
      });
    }
    return wickets;
  }

  private buildInnings(
    deliveries: ParsedDelivery[],
    teams: [string, string],
    flags: { declared: Set<number>; forfeited: Set<number>; superOvers: Set<number> },
  ): ParsedInnings[] {
    const { declared, forfeited, superOvers } = flags;
    const byNo = new Map<number, ParsedInnings>();
    const isMultiDay = ['Test', 'MDM'].includes(this.single('match_type') ?? '');
    const regularInnings = isMultiDay ? 4 : 2;
    const ensure = (inningsNo: number): ParsedInnings => {
      let innings = byNo.get(inningsNo);
      if (!innings) {
        innings = {
          inningsNo,
          battingTeam: null,
          bowlingTeam: null,
          isSuperOver: superOvers.has(inningsNo) || inningsNo > regularInnings,
          declared: declared.has(inningsNo),
          forfeited: forfeited.has(inningsNo),
          runs: 0,
          wickets: 0,
          legalBalls: 0,
          deliveries: 0,
          extras: 0,
          wides: 0,
          noballs: 0,
          byes: 0,
          legbyes: 0,
          penaltyInDeliveries: 0,
          penaltyPre: 0,
          penaltyPost: 0,
          targetRuns: null,
          targetOvers: null,
        };
        byNo.set(inningsNo, innings);
      }
      return innings;
    };

    for (const d of deliveries) {
      const innings = ensure(d.innings);
      if (innings.battingTeam && innings.battingTeam !== d.battingTeam) {
        this.warn('BATTING_TEAM_CHANGED', 'batting team changes within an innings');
      }
      innings.battingTeam ??= d.battingTeam;
      innings.bowlingTeam ??= teams[0] === d.battingTeam ? teams[1] : teams[0];
      innings.deliveries++;
      innings.runs += d.totalRuns;
      innings.extras += d.extras;
      innings.wides += d.wides;
      innings.noballs += d.noballs;
      innings.byes += d.byes;
      innings.legbyes += d.legbyes;
      innings.penaltyInDeliveries += d.penalty;
      if (d.isLegal) innings.legalBalls++;
      innings.wickets += d.wickets.filter((w) => w.countsAsTeamWicket).length;
    }
    for (const p of this.penalties) {
      const innings = ensure(p.innings);
      if (p.when === 'pre') innings.penaltyPre += p.runs;
      else innings.penaltyPost += p.runs;
      innings.runs += p.runs;
    }
    for (const no of [...declared, ...forfeited]) ensure(no);
    for (const [inningsRaw, value] of this.all('target_runs')) {
      const no = Number(inningsRaw);
      if (Number.isInteger(no) && no > 0 && NON_NEGATIVE_INT.test(value ?? '')) ensure(no).targetRuns = Number(value);
      else this.warn('BAD_TARGET', 'target_runs row is malformed');
    }
    for (const [inningsRaw, value] of this.all('target_overs')) {
      const no = Number(inningsRaw);
      if (Number.isInteger(no) && no > 0 && value) ensure(no).targetOvers = value.slice(0, 8);
      else this.warn('BAD_TARGET', 'target_overs row is malformed');
    }
    return [...byNo.values()].sort((a, b) => a.inningsNo - b.inningsNo);
  }

  private buildResult(teamSet: Set<string>): Pick<
    ParsedMatch,
    'outcome' | 'winner' | 'winByRuns' | 'winByWickets' | 'winByInnings' | 'method' | 'eliminator' | 'bowlOut'
  > {
    const winner = this.single('winner') || null;
    const outcomeRaw = (this.single('outcome') ?? '').toLowerCase();
    const eliminator = this.single('eliminator') || null;
    const bowlOut = this.single('bowl_out') || null;
    if (winner && !teamSet.has(winner)) this.warn('WINNER_UNKNOWN', 'winner is not a match team');

    let outcome: HistMatchOutcome = 'UNKNOWN';
    if (winner) outcome = 'WIN';
    else if (outcomeRaw === 'tie') outcome = 'TIE';
    else if (outcomeRaw === 'draw') outcome = 'DRAW';
    else if (outcomeRaw === 'no result') outcome = 'NO_RESULT';
    else if (outcomeRaw) this.warn('UNKNOWN_OUTCOME', `unknown outcome "${outcomeRaw.slice(0, 40)}"`);
    else this.warn('NO_RESULT_RECORDED', 'neither winner nor outcome recorded');

    return {
      outcome,
      winner,
      winByRuns: this.optionalInt('winner_runs'),
      winByWickets: this.optionalInt('winner_wickets'),
      winByInnings: this.info.has('winner_innings'),
      method: this.single('method') || null,
      eliminator,
      bowlOut,
    };
  }

  private inningsSet(key: string): Set<number> {
    const set = new Set<number>();
    for (const [value] of this.all(key)) {
      if (NON_NEGATIVE_INT.test(value ?? '')) set.add(Number(value));
      else this.warn('BAD_INNINGS_FLAG', `${key} value is not an innings number`);
    }
    return set;
  }

  private all(key: string): string[][] {
    return this.info.get(key) ?? [];
  }

  private single(key: string): string | undefined {
    const values = this.info.get(key);
    if (!values) return undefined;
    if (values.length > 1) this.warnOnce(`REPEATED_${key.toUpperCase()}`, `info ${key} repeated; first value used`);
    return values[0][0]?.trim();
  }

  private optionalInt(key: string): number | null {
    const value = this.single(key);
    if (!value) return null;
    if (!NON_NEGATIVE_INT.test(value)) {
      this.warn('BAD_NUMBER', `info ${key} is not an integer`);
      return null;
    }
    return Number(value);
  }

  private flag(key: string): boolean {
    const value = this.single(key);
    return value !== undefined && value.toLowerCase() !== 'false' && value !== '0';
  }

  private error(code: string, message: string, line = this.lineNo): void {
    this.errors.push({ code, message, line });
  }

  private warn(code: string, message: string, line?: number): void {
    this.warnings.push(line === undefined ? { code, message } : { code, message, line });
  }

  private warnOnce(code: string, message: string): void {
    if (!this.warnings.some((w) => w.code === code)) this.warn(code, message);
  }
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Parses a whole file's text (tests and small inputs). Production code streams lines. */
export function parseCricsheetCsv(text: string): ParseResult {
  const parser = new CricsheetOriginalParser();
  for (const line of text.split('\n')) parser.push(line);
  return parser.finish();
}
