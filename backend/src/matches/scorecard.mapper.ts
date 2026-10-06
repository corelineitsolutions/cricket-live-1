import type { LatiyalRecord } from '../latiyal/latiyal.types';
import { asRecord, pick, pickNumber, pickRecord, pickText, toNumber, toRecords, toText } from '../latiyal/latiyal.validation';
import type { PlayerSeed } from '../live-score/match-persistence.service';
import { parseScoreLines, syntheticId } from '../live-score/live-match.normalizer';
import type { MatchTeamDto } from './dto/match.dto';
import type { ExtrasDto, ScorecardBattingDto, ScorecardBowlingDto, ScorecardInningsDto } from './dto/scorecard.dto';

const BATTING_KEYS = ['batsman', 'batsmen', 'batting', 'batters'] as const;
const BOWLING_KEYS = ['bolwer', 'bowler', 'bowling', 'bowlers'] as const;
const NOT_OUT = /not out|batting|^\s*$/i;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function playerId(row: LatiyalRecord, name: string | null, keys: readonly string[]): number {
  const id = pickNumber(row, keys);
  return id !== null && id > 0 ? id : syntheticId(name ?? JSON.stringify(row));
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function toBatting(row: LatiyalRecord): ScorecardBattingDto {
  const name = pickText(row, ['name', 'batsman_name', 'player_name']);
  const runs = pickNumber(row, ['run', 'runs', 'r']) ?? 0;
  const balls = pickNumber(row, ['ball', 'balls', 'b']) ?? 0;
  const outText = pickText(row, ['out_by', 'how_out', 'dismissal', 'wicket_by', 'out_desc']);
  const isOut = outText !== null && !NOT_OUT.test(outText);
  return {
    sportmonksId: playerId(row, name, ['player_id', 'batsman_id', 'id']),
    name,
    imageUrl: pickText(row, ['image', 'img', 'player_img', 'player_image']),
    runs,
    balls,
    fours: pickNumber(row, ['fours', 'four', '4s']) ?? 0,
    sixes: pickNumber(row, ['sixes', 'six', '6s']) ?? 0,
    strikeRate: pickNumber(row, ['strike_rate', 'sr', 'strikerate']) ?? (balls > 0 ? round2((runs * 100) / balls) : null),
    isOut,
    atCrease: !isOut && (isTruthy(pick(row, ['is_batting', 'on_strike', 'active'])) || /batting/i.test(outText ?? '')),
    dismissal: isOut ? { type: outText, bowlerName: null, fielderName: null } : null,
    fallOfWicket: null,
  };
}

function toBowling(row: LatiyalRecord): ScorecardBowlingDto {
  const name = pickText(row, ['name', 'bowler_name', 'player_name']);
  return {
    sportmonksId: playerId(row, name, ['player_id', 'bowler_id', 'id']),
    name,
    imageUrl: pickText(row, ['image', 'img', 'player_img', 'player_image']),
    overs: pickNumber(row, ['over', 'overs', 'o']) ?? 0,
    maidens: pickNumber(row, ['maiden', 'maidens', 'm']) ?? 0,
    runs: pickNumber(row, ['run', 'runs', 'r']) ?? 0,
    wickets: pickNumber(row, ['wicket', 'wickets', 'w']) ?? 0,
    wides: pickNumber(row, ['wide', 'wides', 'wd']) ?? 0,
    noBalls: pickNumber(row, ['noball', 'no_ball', 'noballs', 'nb']) ?? 0,
    economy: pickNumber(row, ['economy', 'eco', 'er', 'econ']),
    active: isTruthy(pick(row, ['is_bowling', 'active'])),
  };
}

/** `{ total, wide, … }`, a bare total, or text such as "12 (b 2, lb 4, w 5, nb 1)". */
function toExtras(value: unknown): ExtrasDto | null {
  const record = asRecord(value);
  if (record) {
    const part = (keys: readonly string[]) => pickNumber(record, keys) ?? 0;
    const extras = {
      wides: part(['wide', 'wides', 'wd', 'w']),
      noBalls: part(['noball', 'no_ball', 'noballs', 'nb']),
      byes: part(['bye', 'byes', 'b']),
      legByes: part(['legbye', 'leg_bye', 'legbyes', 'lb']),
      penalty: part(['penalty', 'p']),
    };
    const sum = extras.wides + extras.noBalls + extras.byes + extras.legByes + extras.penalty;
    return { total: pickNumber(record, ['total', 'extras', 'extra']) ?? sum, ...extras };
  }
  const text = toText(value);
  if (!text) {
    return null;
  }
  const part = (label: string) => toNumber(new RegExp(`\\b${label}\\s*(\\d+)`, 'i').exec(text)?.[1]) ?? 0;
  const total = toNumber(/^\s*(\d+)/.exec(text)?.[1]);
  if (total === null) {
    return null;
  }
  return { total, wides: part('w'), noBalls: part('nb'), byes: part('b'), legByes: part('lb'), penalty: part('p') };
}

function inningsRecords(data: unknown): LatiyalRecord[] {
  const root = asRecord(data);
  const container = root ? (pick(root, ['scorecard', 'innings', 'scorecards', 'score_card']) ?? root) : data;
  return toRecords(container).filter((record) => BATTING_KEYS.some((key) => key in record));
}

function resolveTeam(info: LatiyalRecord | null, teams: MatchTeamDto[]): MatchTeamDto {
  const id = pickNumber(info, ['team_id', 'id']);
  const name = pickText(info, ['name', 'team_name', 'team']);
  const shortName = pickText(info, ['short_name', 'team_short', 'short']);
  const labels = [name, shortName].filter(Boolean).map((label) => label!.toLowerCase());
  const known = teams.find(
    (team) =>
      (id !== null && team.sportmonksId === id) ||
      [team.name, team.shortName].some((label) => label && labels.includes(label.toLowerCase())),
  );
  return {
    sportmonksId: id !== null && id > 0 ? id : (known?.sportmonksId ?? (name ? syntheticId(name) : 0)),
    name: name ?? known?.name ?? null,
    shortName: shortName ?? known?.shortName ?? null,
    imageUrl: pickText(info, ['flag', 'img', 'logo', 'image']) ?? known?.imageUrl ?? null,
  };
}

/** One entry per innings from a Latiyal scorecardByMatchId payload, oldest innings first. */
export function buildScorecardInnings(data: unknown, teams: MatchTeamDto[] = []): ScorecardInningsDto[] {
  return inningsRecords(data).map((record, index) => {
    const info = pickRecord(record, ['team', 'batting_team']) ?? record;
    const line = parseScoreLines(pick(info, ['score', 'scores']), pick(info, ['over', 'overs'])).at(-1);
    return {
      inning: pickNumber(record, ['inning', 'innings', 'inning_no']) ?? index + 1,
      team: resolveTeam(info, teams),
      score: line?.score ?? 0,
      wickets: pickNumber(info, ['wicket', 'wickets']) ?? line?.wickets ?? 0,
      overs: line?.overs ?? pickNumber(info, ['over', 'overs']) ?? 0,
      extras: toExtras(pick(record, ['extras', 'extra']) ?? pick(info, ['extras', 'extra'])),
      batting: toRecords(pick(record, BATTING_KEYS)).map(toBatting),
      bowling: toRecords(pick(record, BOWLING_KEYS)).map(toBowling),
    };
  });
}

/** Every distinct player with a real Latiyal id, for one-time storage. */
export function scorecardPlayers(innings: ScorecardInningsDto[]): PlayerSeed[] {
  const players = new Map<number, PlayerSeed>();
  for (const inning of innings) {
    for (const row of [...inning.batting, ...inning.bowling]) {
      if (row.sportmonksId > 0) {
        players.set(row.sportmonksId, { sportmonksId: row.sportmonksId, name: row.name, imageUrl: row.imageUrl });
      }
    }
  }
  return [...players.values()];
}
