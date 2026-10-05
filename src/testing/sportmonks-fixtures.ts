/** Raw Sportmonks v2 cricket fixture JSON, shaped like a /livescores item, for tests only. */
export interface RawFixtureOptions {
  id?: number;
  status?: string;
  live?: boolean;
  type?: string;
  note?: string | null;
  winnerTeamId?: number | null;
  /** [inning, teamId, score, wickets, overs] */
  runs?: Array<[number, number, number, number, number]>;
}

export const LOCAL_TEAM_ID = 101;
export const VISITOR_TEAM_ID = 202;

export function rawFixture(options: RawFixtureOptions = {}): Record<string, unknown> {
  const runs = options.runs ?? [
    [1, LOCAL_TEAM_ID, 180, 6, 20],
    [2, VISITOR_TEAM_ID, 120, 3, 15.2],
  ];

  return {
    resource: 'fixtures',
    id: options.id ?? 61521,
    league_id: 3,
    season_id: 1689,
    round: '12th Match',
    localteam_id: LOCAL_TEAM_ID,
    visitorteam_id: VISITOR_TEAM_ID,
    starting_at: '2026-10-01T14:00:00.000000Z',
    type: options.type ?? 'T20',
    live: options.live ?? true,
    status: options.status ?? '2nd Innings',
    note: options.note ?? null,
    winner_team_id: options.winnerTeamId ?? null,
    super_over: false,
    rpc_target: null,
    rpc_overs: null,
    localteam: { id: LOCAL_TEAM_ID, name: 'Mumbai Strikers', code: 'MUM', image_path: 'https://cdn.example/mum.png' },
    visitorteam: { id: VISITOR_TEAM_ID, name: 'Delhi Royals', code: 'DEL', image_path: 'https://cdn.example/del.png' },
    league: { id: 3, name: 'Premier T20', code: 'PT20', image_path: null, type: 'league' },
    season: { id: 1689, name: '2026' },
    venue: { id: 55, name: 'Wankhede Stadium', city: 'Mumbai' },
    runs: runs.map(([inning, teamId, score, wickets, overs]) => ({
      team_id: teamId,
      inning,
      score,
      wickets,
      overs,
    })),
    batting: [
      {
        team_id: VISITOR_TEAM_ID,
        player_id: 9001,
        scoreboard: 'S2',
        active: false,
        sort: 1,
        score: 22,
        ball: 18,
        four_x: 3,
        six_x: 0,
        rate: 122.22,
        bowling_player_id: 7002,
        batsman: { id: 9001, fullname: 'Out Opener', image_path: null },
      },
      {
        team_id: VISITOR_TEAM_ID,
        player_id: 9002,
        scoreboard: 'S2',
        active: true,
        sort: 2,
        score: 54,
        ball: 38,
        four_x: 5,
        six_x: 2,
        rate: 142.11,
        batsman: { id: 9002, fullname: 'Rohan Mehta', image_path: null },
      },
      {
        team_id: VISITOR_TEAM_ID,
        player_id: 9003,
        scoreboard: 'S2',
        active: true,
        sort: 4,
        score: 31,
        ball: 25,
        four_x: 2,
        six_x: 1,
        rate: 124,
        batsman: { id: 9003, fullname: 'Arjun Rao', image_path: null },
      },
    ],
    bowling: [
      {
        team_id: LOCAL_TEAM_ID,
        player_id: 7001,
        scoreboard: 'S2',
        active: false,
        sort: 1,
        updated_at: '2026-10-01T16:10:00.000000Z',
        overs: 4,
        medians: 0,
        runs: 31,
        wickets: 1,
        rate: 7.75,
        bowler: { id: 7001, fullname: 'Earlier Bowler', image_path: null },
      },
      {
        team_id: LOCAL_TEAM_ID,
        player_id: 7002,
        scoreboard: 'S2',
        active: true,
        sort: 2,
        updated_at: '2026-10-01T16:20:00.000000Z',
        overs: 3.2,
        medians: 0,
        runs: 24,
        wickets: 2,
        rate: 7.2,
        bowler: { id: 7002, fullname: 'Kiran Patel', image_path: null },
      },
    ],
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
