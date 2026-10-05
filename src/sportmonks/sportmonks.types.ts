/** Validated subset of the Sportmonks Cricket v2 fixture payload. Field names follow the API. */

export interface SmTeam {
  id: number;
  name: string | null;
  code: string | null;
  image_path: string | null;
}

export interface SmLeague {
  id: number;
  name: string | null;
  code: string | null;
  image_path: string | null;
  type: string | null;
}

export interface SmSeason {
  id: number;
  name: string | null;
}

export interface SmVenue {
  id: number;
  name: string | null;
  city: string | null;
}

export interface SmPlayer {
  id: number;
  fullname: string | null;
  image_path: string | null;
}

export interface SmRun {
  team_id: number;
  inning: number;
  score: number;
  wickets: number;
  overs: number;
}

export interface SmBatting {
  team_id: number;
  player_id: number;
  scoreboard: string | null;
  active: boolean | null;
  dismissed: boolean;
  sort: number | null;
  score: number;
  ball: number;
  four_x: number;
  six_x: number;
  rate: number | null;
  batsman: SmPlayer | null;
}

export interface SmBowling {
  team_id: number;
  player_id: number;
  scoreboard: string | null;
  active: boolean | null;
  sort: number | null;
  updated_at: string | null;
  overs: number;
  medians: number;
  runs: number;
  wickets: number;
  rate: number | null;
  bowler: SmPlayer | null;
}

export interface SmDismissalResult {
  name: string | null;
  is_wicket: boolean | null;
}

export interface SmBattingDetail extends SmBatting {
  fow_score: number | null;
  fow_balls: number | null;
  bowler: SmPlayer | null;
  catchstump: SmPlayer | null;
  runoutby: SmPlayer | null;
  result: SmDismissalResult | null;
}

export interface SmBowlingDetail extends SmBowling {
  wide: number;
  noball: number;
}

export interface SmScoreboard {
  scoreboard: string | null;
  team_id: number | null;
  type: string | null;
  wide: number;
  noball_runs: number;
  bye: number;
  leg_bye: number;
  penalty: number;
  total: number;
  overs: number;
  wickets: number;
}

export interface SmScorecard {
  id: number;
  status: string | null;
  live: boolean | null;
  localteam: SmTeam | null;
  visitorteam: SmTeam | null;
  runs: SmRun[];
  scoreboards: SmScoreboard[];
  batting: SmBattingDetail[];
  bowling: SmBowlingDetail[];
}

export interface SmBallScore {
  name: string | null;
  runs: number;
  four: boolean;
  six: boolean;
  bye: number;
  leg_bye: number;
  noball: number;
  noball_runs: number;
  is_wicket: boolean;
  out: boolean;
  /** False for deliveries that do not count as a legal ball (wides and no-balls). */
  ball: boolean | null;
}

export interface SmBall {
  id: number;
  team_id: number | null;
  ball: number;
  scoreboard: string | null;
  updated_at: string | null;
  batsman: SmPlayer | null;
  bowler: SmPlayer | null;
  score: SmBallScore | null;
}

export interface SmFixture {
  id: number;
  league_id: number | null;
  season_id: number | null;
  round: string | null;
  localteam_id: number | null;
  visitorteam_id: number | null;
  starting_at: string | null;
  type: string | null;
  live: boolean | null;
  status: string | null;
  note: string | null;
  winner_team_id: number | null;
  super_over: boolean | null;
  rpc_target: number | null;
  rpc_overs: number | null;
  localteam: SmTeam | null;
  visitorteam: SmTeam | null;
  league: SmLeague | null;
  season: SmSeason | null;
  venue: SmVenue | null;
  runs: SmRun[];
  batting: SmBatting[];
  bowling: SmBowling[];
}
