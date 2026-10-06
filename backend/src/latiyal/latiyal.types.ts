/**
 * Latiyal responses are loosely typed (numbers often arrive as strings, field names vary
 * between endpoints), so payloads stay as plain records and are read through the
 * tolerant helpers in latiyal.validation.ts.
 */
export type LatiyalRecord = Record<string, unknown>;

/** One match from liveMatchList, optionally merged with its liveMatch detail. */
export interface LatiyalMatch {
  id: number;
  raw: LatiyalRecord;
}
