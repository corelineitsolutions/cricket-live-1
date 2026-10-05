export const SPORTMONKS_FETCH = Symbol('SPORTMONKS_FETCH');

export const SportmonksPath = {
  livescores: '/livescores',
  fixture: (id: number) => `/fixtures/${id}`,
} as const;

/**
 * Includes needed for the live scorecard summary. Ball-by-ball, commentary,
 * lineups and full scoreboards are deliberately excluded from the polling payload.
 */
export const LIVE_FIXTURE_INCLUDES = [
  'localteam',
  'visitorteam',
  'league',
  'season',
  'venue',
  'runs',
  'batting.batsman',
  'bowling.bowler',
] as const;

/** Full scorecard for one fixture. Requested on demand and cached, never polled. */
export const SCORECARD_INCLUDES = [
  'localteam',
  'visitorteam',
  'runs',
  'scoreboards',
  'batting.batsman',
  'batting.bowler',
  'batting.catchstump',
  'batting.runoutby',
  'batting.result',
  'bowling.bowler',
] as const;

/** Ball-by-ball feed used as commentary. Requested on demand and cached, never polled. */
export const COMMENTARY_INCLUDES = ['balls.batsman', 'balls.bowler', 'balls.score'] as const;

export const RETRY_BASE_DELAY_MS = 500;
