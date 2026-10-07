/**
 * Every Latiyal "Cricket Live Line" V4/V5 endpoint, as listed in the provider's Postman
 * collection. Endpoints without params are GET; the rest are POST with form-data fields.
 *
 * `ttlSeconds` follows the refresh rate Latiyal recommends for each endpoint (their notes
 * ask clients to cache and not call per app request). The plan has no call limit, so the
 * live endpoints use the shortest sensible cache.
 */

export const FEED_PARAM_NAMES = [
  'match_id',
  'series_id',
  'news_id',
  'player_id',
  'venue_id',
  'team_id',
  'team_a_id',
  'team_b_id',
  'match_type',
  'type',
  'sub_type',
  'paginate',
] as const;

export type FeedParamName = (typeof FEED_PARAM_NAMES)[number];

export interface FeedParam {
  name: FeedParamName;
  required: boolean;
  /** Sent when the caller omits the param. */
  default?: string;
}

export type FeedGroup = 'home' | 'series' | 'matches' | 'live' | 'news' | 'rankings' | 'players' | 'teams' | 'venues';

export interface FeedDefinition {
  endpoint: string;
  group: FeedGroup;
  summary: string;
  params: FeedParam[];
  ttlSeconds: number;
  /** Only available on the V5 plan. */
  v5Only?: boolean;
}

const MINUTE = 60;
const HOUR = 3_600;
const SIX_HOURS = 6 * HOUR;
const DAY = 24 * HOUR;

const req = (name: FeedParamName): FeedParam => ({ name, required: true });
const opt = (name: FeedParamName): FeedParam => ({ name, required: false });

const MATCH = [req('match_id')];
const SERIES = [req('series_id')];
const PLAYER = [req('player_id')];
const VENUE = [req('venue_id')];
const NEWS = [req('news_id')];
const TEAMS = [req('team_a_id'), req('team_b_id'), req('match_type')];

export const LATIYAL_FEEDS: readonly FeedDefinition[] = [
  { endpoint: 'homeList', group: 'home', summary: 'Home screen list (live, upcoming and recent matches)', params: [], ttlSeconds: MINUTE },

  { endpoint: 'seriesList', group: 'series', summary: 'Current series', params: [], ttlSeconds: SIX_HOURS },
  { endpoint: 'allSeriesList', group: 'series', summary: 'All series', params: [], ttlSeconds: SIX_HOURS },
  { endpoint: 'upcomingMatchesBySeriesId', group: 'series', summary: 'Upcoming matches of a series', params: SERIES, ttlSeconds: HOUR },
  { endpoint: 'recentMatchesBySeriesId', group: 'series', summary: 'Recent matches of a series', params: SERIES, ttlSeconds: HOUR },
  { endpoint: 'pointsTable', group: 'series', summary: 'Points table of a series', params: SERIES, ttlSeconds: 30 * MINUTE },
  { endpoint: 'groupPointsTable', group: 'series', summary: 'Group-wise points table of a series', params: SERIES, ttlSeconds: 30 * MINUTE },
  { endpoint: 'pointMatchesList', group: 'series', summary: 'Points-table matches of a team in a series', params: [req('series_id'), opt('team_id')], ttlSeconds: SIX_HOURS },
  { endpoint: 'manOfTheSeriesV1', group: 'series', summary: 'Man of the series', params: SERIES, ttlSeconds: SIX_HOURS },
  { endpoint: 'venuesBySeriesId', group: 'series', summary: 'Venues of a series', params: SERIES, ttlSeconds: SIX_HOURS },
  { endpoint: 'newsBySeriesId', group: 'series', summary: 'News of a series', params: SERIES, ttlSeconds: HOUR },
  { endpoint: 'seriesStatsBySeriesId', group: 'series', summary: 'Series stats (type 1 = batting, 2 = bowling; sub_type = stat)', params: [req('series_id'), req('type'), req('sub_type')], ttlSeconds: SIX_HOURS },
  { endpoint: 'squadsBySeriesId', group: 'series', summary: 'Squads of a series', params: SERIES, ttlSeconds: SIX_HOURS },
  { endpoint: 'squadsBySeriesIdV1', group: 'series', summary: 'Squads of a series (V1 format)', params: SERIES, ttlSeconds: SIX_HOURS },
  { endpoint: 'topThreePlayersBySeriesId', group: 'series', summary: 'Top three players of a series', params: SERIES, ttlSeconds: SIX_HOURS },
  { endpoint: 'trackerBySeriesId', group: 'series', summary: 'Series tracker', params: SERIES, ttlSeconds: 10 * MINUTE },

  { endpoint: 'upcomingMatches', group: 'matches', summary: 'Upcoming matches', params: [], ttlSeconds: 30 * MINUTE },
  { endpoint: 'recentMatches', group: 'matches', summary: 'Recent matches', params: [], ttlSeconds: 10 * MINUTE },
  { endpoint: 'matchInfo', group: 'matches', summary: 'Match info (venue, toss, umpires, is_impact)', params: MATCH, ttlSeconds: 10 * MINUTE },
  { endpoint: 'squadsByMatchId', group: 'matches', summary: 'Squads of a match', params: MATCH, ttlSeconds: 15 * MINUTE },
  { endpoint: 'squadsByMatchIdV1', group: 'matches', summary: 'Squads of a match (V1 format)', params: MATCH, ttlSeconds: 15 * MINUTE },
  { endpoint: 'groupSquadsByMatchId', group: 'matches', summary: 'Grouped squads of a match', params: MATCH, ttlSeconds: 15 * MINUTE },
  { endpoint: 'manOfTheMatch', group: 'matches', summary: 'Man of the match', params: MATCH, ttlSeconds: 10 * MINUTE },
  { endpoint: 'trackerByMatchId', group: 'matches', summary: 'Match tracker', params: MATCH, ttlSeconds: MINUTE },

  { endpoint: 'liveMatchList', group: 'live', summary: 'Matches that are live now', params: [], ttlSeconds: 5 },
  { endpoint: 'liveMatch', group: 'live', summary: 'Live score, batsmen and bowler of a match', params: MATCH, ttlSeconds: 0.5 },
  { endpoint: 'commentary', group: 'live', summary: 'Ball-by-ball commentary of a match', params: MATCH, ttlSeconds: 1 },
  { endpoint: 'scorecardByMatchId', group: 'live', summary: 'Full scorecard of a match', params: MATCH, ttlSeconds: 15 },
  { endpoint: 'matchOverHistory', group: 'live', summary: 'Over-by-over history of a match', params: MATCH, ttlSeconds: 30 },
  { endpoint: 'matchProbHistory', group: 'live', summary: 'Win-probability history of a match', params: MATCH, ttlSeconds: 30 },
  { endpoint: 'playingXiByMatchId', group: 'live', summary: 'Playing XI of a match', params: MATCH, ttlSeconds: MINUTE },
  { endpoint: 'benchPlayersByMatchId', group: 'live', summary: 'Bench players of a match', params: MATCH, ttlSeconds: MINUTE },
  { endpoint: 'impactPlayersByMatchId', group: 'live', summary: 'Impact players of a match (when matchInfo is_impact = 2)', params: MATCH, ttlSeconds: MINUTE },

  { endpoint: 'news', group: 'news', summary: 'Latest news', params: [], ttlSeconds: HOUR },
  { endpoint: 'newsDetail', group: 'news', summary: 'News article', params: NEWS, ttlSeconds: SIX_HOURS },
  { endpoint: 'seriesNewsDetail', group: 'news', summary: 'Series news article', params: NEWS, ttlSeconds: SIX_HOURS },
  { endpoint: 'newsByPlayerId', group: 'news', summary: 'News about a player', params: PLAYER, ttlSeconds: HOUR },
  { endpoint: 'newsByVenueId', group: 'news', summary: 'News about a venue', params: VENUE, ttlSeconds: HOUR },

  { endpoint: 'playerRanking', group: 'rankings', summary: 'Player rankings by type', params: [req('type')], ttlSeconds: SIX_HOURS },
  { endpoint: 'teamRanking', group: 'rankings', summary: 'Team rankings by type', params: [req('type')], ttlSeconds: SIX_HOURS },

  { endpoint: 'playerList', group: 'players', summary: 'All players (paginated)', params: [{ ...opt('paginate'), default: '0' }], ttlSeconds: DAY, v5Only: true },
  { endpoint: 'playerInfo', group: 'players', summary: 'Player profile and career stats', params: PLAYER, ttlSeconds: SIX_HOURS },
  { endpoint: 'playerMatchList', group: 'players', summary: 'Matches of a player', params: [req('player_id'), opt('type')], ttlSeconds: SIX_HOURS },

  { endpoint: 'teamList', group: 'teams', summary: 'All teams', params: [], ttlSeconds: DAY, v5Only: true },
  { endpoint: 'teamFormByTeamId', group: 'teams', summary: 'Recent form of two teams', params: TEAMS, ttlSeconds: SIX_HOURS },
  { endpoint: 'headToHeadByTeamId', group: 'teams', summary: 'Head to head of two teams', params: TEAMS, ttlSeconds: SIX_HOURS },
  { endpoint: 'teamComparisonByTeamId', group: 'teams', summary: 'Comparison of two teams', params: TEAMS, ttlSeconds: SIX_HOURS },
  { endpoint: 'tossComparisonByTeamId', group: 'teams', summary: 'Toss comparison of two teams', params: TEAMS, ttlSeconds: SIX_HOURS },

  { endpoint: 'venuesDetail', group: 'venues', summary: 'Venue detail', params: VENUE, ttlSeconds: DAY },
  { endpoint: 'recentMatchesByVenueId', group: 'venues', summary: 'Recent matches at a venue', params: VENUE, ttlSeconds: SIX_HOURS },
  { endpoint: 'venueScoringPattern', group: 'venues', summary: 'Scoring pattern at a venue by match type', params: [req('venue_id'), req('match_type')], ttlSeconds: DAY },
];

const FEEDS_BY_NAME = new Map(LATIYAL_FEEDS.map((feed) => [feed.endpoint.toLowerCase(), feed]));

/** Case-insensitive lookup so `/feeds/livematch` and `/feeds/liveMatch` both work. */
export function findFeed(endpoint: string): FeedDefinition | null {
  return FEEDS_BY_NAME.get(endpoint.toLowerCase()) ?? null;
}
