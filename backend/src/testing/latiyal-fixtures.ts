import type { LatiyalRecord } from '../latiyal/latiyal.types';

/** Latiyal-shaped match JSON for tests: liveMatchList fields plus the liveMatch detail fields. */
export interface LatiyalMatchOptions {
  id?: number;
  status?: string;
  type?: string;
  result?: string | null;
  winnerTeamId?: number | null;
  /** [inning, teamId, score, wickets, overs] */
  runs?: Array<[number, number, number, number, number]>;
}

export const LOCAL_TEAM_ID = 101;
export const VISITOR_TEAM_ID = 202;
export const SERIES_ID = 3;

const DETAIL_ONLY_FIELDS = ['batsman', 'bolwer'];

export function latiyalMatch(options: LatiyalMatchOptions = {}): LatiyalRecord {
  const runs = options.runs ?? [
    [1, LOCAL_TEAM_ID, 180, 6, 20],
    [2, VISITOR_TEAM_ID, 120, 3, 15.2],
  ];
  const side = (teamId: number) => {
    const own = runs.filter((run) => run[1] === teamId);
    return {
      scores: own.map(([, , score, wickets]) => `${score}-${wickets}`).join(' & '),
      over: own.length > 0 ? String(own[own.length - 1][4]) : '',
    };
  };
  const a = side(LOCAL_TEAM_ID);
  const b = side(VISITOR_TEAM_ID);
  const battingTeam = runs.length > 0 ? runs[runs.length - 1][1] : null;

  return {
    match_id: options.id ?? 61521,
    series_id: SERIES_ID,
    series: 'Premier T20 2026',
    matchs: '12th Match',
    match_type: options.type ?? 'T20',
    match_status: options.status ?? 'Live',
    venue: 'Wankhede Stadium, Mumbai',
    date_wise: '01 Oct 2026, Thursday',
    match_time: '07:30 PM',
    team_a_id: LOCAL_TEAM_ID,
    team_a: 'Mumbai Strikers',
    team_a_short: 'MUM',
    team_a_img: 'https://cdn.example/mum.png',
    team_a_scores: a.scores,
    team_a_over: a.over,
    team_b_id: VISITOR_TEAM_ID,
    team_b: 'Delhi Royals',
    team_b_short: 'DEL',
    team_b_img: 'https://cdn.example/del.png',
    team_b_scores: b.scores,
    team_b_over: b.over,
    batting_team: battingTeam ?? '',
    result: options.result ?? '',
    winning_team_id: options.winnerTeamId ?? '',
    batsman:
      battingTeam === null
        ? []
        : [
            { player_id: 9002, name: 'Rohan Mehta', run: '54', ball: '38', fours: '5', sixes: '2', strike_rate: '142.11' },
            { player_id: 9003, name: 'Arjun Rao', run: '31', ball: '25', fours: '2', sixes: '1', strike_rate: '124.00' },
          ],
    bolwer:
      battingTeam === null
        ? null
        : { player_id: 7002, name: 'Kiran Patel', over: '3.2', maiden: '0', run: '24', wicket: '2', economy: '7.20' },
  };
}

/** The liveMatchList item for a match (no batsmen or bowler). */
export function listItem(match: LatiyalRecord): LatiyalRecord {
  const item = { ...match };
  for (const field of DETAIL_ONLY_FIELDS) {
    delete item[field];
  }
  return item;
}

export function latiyalScorecard(): LatiyalRecord {
  return {
    result: '',
    scorecard: {
      '1': {
        team: { team_id: LOCAL_TEAM_ID, name: 'Mumbai Strikers', short_name: 'MUM', score: '180-6', over: '20' },
        batsman: [
          { player_id: 8001, name: 'Opener One', run: '45', ball: '30', fours: '6', sixes: '1', strike_rate: '150.00', out_by: 'c Rao b Patel' },
          { player_id: 8002, name: 'Not Out Two', run: '60', ball: '40', fours: '4', sixes: '3', strike_rate: '150.00', out_by: 'not out' },
        ],
        bolwer: [{ player_id: 9101, name: 'Delhi Bowler', over: '4', maiden: '0', run: '30', wicket: '2', economy: '7.50', wide: '1', noball: '0' }],
        extras: { total: 9, wide: 4, noball: 1, bye: 2, legbye: 2, penalty: 0 },
      },
      '2': {
        team: { team_id: VISITOR_TEAM_ID, name: 'Delhi Royals', short_name: 'DEL', score: '120-3', over: '15.2' },
        batsman: [
          { player_id: 9001, name: 'Out Opener', run: '22', ball: '18', fours: '3', sixes: '0', strike_rate: '122.22', out_by: 'b Patel' },
          { player_id: 9002, name: 'Rohan Mehta', run: '54', ball: '38', fours: '5', sixes: '2', strike_rate: '142.11', out_by: 'batting' },
        ],
        bolwer: [{ player_id: 7002, name: 'Kiran Patel', over: '3.2', maiden: '0', run: '24', wicket: '2', economy: '7.20', wide: '1', noball: '0' }],
        extras: '6 (b 1, lb 2, w 3, nb 0)',
      },
    },
  };
}

export function latiyalCommentary(): LatiyalRecord[] {
  return [
    { id: 4410023, inning: 2, overs: '15.2', commentary: 'Kiran Patel to Rohan Mehta, FOUR', runs: '4', wicket: '0', batsman_name: 'Rohan Mehta', bowler_name: 'Kiran Patel' },
    { id: 4410022, inning: 2, overs: '15.1', commentary: 'Kiran Patel to Out Opener, OUT bowled', runs: '0', wicket: '1', batsman_name: 'Out Opener', bowler_name: 'Kiran Patel' },
    { id: 4410021, inning: 2, overs: '15.1', commentary: 'Kiran Patel to Rohan Mehta, wide', runs: '1', wicket: '0', batsman_name: 'Rohan Mehta', bowler_name: 'Kiran Patel' },
  ];
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function envelope(data: unknown, msg = 'Success'): Response {
  return jsonResponse({ status: true, msg, data });
}

export function refusal(msg: string): Response {
  return jsonResponse({ status: false, msg, data: [] });
}

/** Latiyal endpoint name of a request URL (`…/apiv5/<endpoint>/<token>`). */
export function endpointOf(url: URL): string {
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[parts.length - 2] ?? '';
}

export function matchIdOf(init?: RequestInit): number | null {
  const body = init?.body;
  if (body instanceof FormData) {
    const value = body.get('match_id');
    return value === null ? null : Number(value);
  }
  return null;
}

export type LatiyalResponder = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export interface ScriptOptions {
  scorecard?: (id: number) => Response;
  commentary?: (id: number) => Response;
}

/** Answers like Latiyal for the given matches: list, per-match detail, scorecard and commentary. */
export function latiyalApi(matches: LatiyalRecord[], options: ScriptOptions = {}): LatiyalResponder {
  return (url, init) => {
    const endpoint = endpointOf(url);
    if (endpoint === 'liveMatchList') {
      return envelope(matches.map(listItem));
    }
    const id = matchIdOf(init);
    if (endpoint === 'liveMatch') {
      const match = matches.find((candidate) => candidate.match_id === id);
      return match ? envelope(match) : refusal('Data not found');
    }
    if (endpoint === 'scorecardByMatchId' && id !== null) {
      return options.scorecard ? options.scorecard(id) : envelope(latiyalScorecard());
    }
    if (endpoint === 'commentary' && id !== null) {
      return options.commentary ? options.commentary(id) : envelope(latiyalCommentary());
    }
    return refusal('Unknown endpoint');
  };
}
