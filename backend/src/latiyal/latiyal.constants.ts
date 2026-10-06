export const LATIYAL_FETCH = Symbol('LATIYAL_FETCH');

/**
 * Latiyal endpoint names. The full URL is `${LATIYAL_API_URL}/${endpoint}/${token}`.
 * List endpoints are GET; per-match endpoints are POST with a `match_id` form field.
 */
export const LatiyalEndpoint = {
  liveMatchList: 'liveMatchList',
  liveMatch: 'liveMatch',
  scorecard: 'scorecardByMatchId',
  commentary: 'commentary',
  matchInfo: 'matchInfo',
} as const;

export type LatiyalEndpointName = (typeof LatiyalEndpoint)[keyof typeof LatiyalEndpoint];

export const RETRY_BASE_DELAY_MS = 500;
