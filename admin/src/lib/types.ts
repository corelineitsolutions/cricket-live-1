/** Response shapes of the NestJS admin API (see Swagger at /api/docs). */

export type UpDown = 'up' | 'down';
export type WorkerHealth = 'up' | 'down' | 'disabled' | 'unknown';

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

export interface Dashboard {
  generatedAt: string;
  matches: { liveCount: number | null };
  realtime: { connectedClients: number; activeMatchRooms: number; subscriptions: number; instances: number };
  devices: { registered: number | null; active: number | null };
  ads: { total: number | null; enabled: number | null; visibleNow: number | null };
  sportmonks: {
    workerState: string | null;
    workerMessage: string | null;
    workerUpdatedAt: string | null;
    pollingIntervalMs: number | null;
    nextPollAt: string | null;
    configuredIntervalsMs: { idle: number; live: number; active: number };
    lastSuccessAt: string | null;
    lastSuccess: { at: string; durationMs: number; liveMatches: number } | null;
    lastError: { at: string; kind: string; status: number | null; message: string } | null;
    callsThisHour: number | null;
    hourlyLimit: number;
    remainingQuota: number | null;
    quotaSource: string | null;
    quotaResetsAt: string | null;
    onDemandCallsThisHour: number | null;
    onDemandHourlyLimit: number;
    count429: number | null;
    last429At: string | null;
    lastStatus: number | null;
  };
  dependencies: { api: 'up'; worker: WorkerHealth; redis: UpDown; mysql: UpDown };
}

export type MatchStatus =
  | 'SCHEDULED'
  | 'LIVE'
  | 'COMPLETED'
  | 'ABANDONED'
  | 'CANCELLED'
  | 'POSTPONED'
  | 'INTERRUPTED'
  | 'UNKNOWN';

export interface MatchTeam {
  sportmonksId: number | null;
  name: string | null;
  shortName: string | null;
  imageUrl: string | null;
}

export interface Match {
  matchId: number;
  source: 'live' | 'stored';
  league: { sportmonksId: number; name: string | null; code: string | null } | null;
  season: { sportmonksId: number; name: string | null } | null;
  matchType: string | null;
  round: string | null;
  status: MatchStatus;
  statusDetail: string | null;
  isLive: boolean;
  isFinished: boolean;
  note: string | null;
  startTime: string | null;
  venue: { name: string | null; city: string | null } | null;
  localTeam: MatchTeam;
  visitorTeam: MatchTeam;
  winnerTeamSportmonksId: number | null;
  innings: Array<{ inning: number; teamSportmonksId: number; score: number; wickets: number; overs: number }>;
  currentInning: number | null;
  battingTeamSportmonksId: number | null;
  score: number | null;
  wickets: number | null;
  overs: number | null;
  runRate: number | null;
  target: number | null;
  runsRequired: number | null;
  ballsRemaining: number | null;
  requiredRunRate: number | null;
  batsmen: Array<{ sportmonksId: number; name: string | null; runs: number; balls: number; fours: number; sixes: number; strikeRate: number | null }>;
  bowler: { sportmonksId: number; name: string | null; overs: number; maidens: number; runs: number; wickets: number; economy: number | null } | null;
  lastUpdatedAt: string;
  stale: boolean;
}

export interface AdminLiveMatch extends Match {
  internalId: string | null;
  subscribers: number;
}

export interface AdminLiveBoard {
  matches: AdminLiveMatch[];
  updatedAt: string | null;
  stale: boolean;
  workerState: string | null;
}

export interface CacheEntry {
  cached: boolean;
  cachedAt: string | null;
  expiresInSeconds: number | null;
}

export interface AdminMatchDetail {
  matchId: number;
  internalId: string | null;
  inLiveFeed: boolean;
  live: AdminLiveMatch | null;
  liveWrittenAt: string | null;
  stored: (Match & { internalId: string; createdAt: string; updatedAt: string }) | null;
  cache: { details: CacheEntry; scorecard: CacheEntry; commentary: CacheEntry } | null;
}

export type DevicePlatform = 'android' | 'ios';

export interface AdminDevice {
  id: string;
  deviceId: string;
  platform: DevicePlatform;
  appVersion: string | null;
  isActive: boolean;
  lastSeenAt: string;
  fcmTokenMasked: string;
  createdAt: string;
  updatedAt: string;
}

export const AD_PLACEMENTS = ['HOME_BANNER', 'MATCH_LIST', 'MATCH_DETAIL', 'SPLASH', 'INTERSTITIAL'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export interface Ad {
  id: string;
  title: string;
  imageUrl: string;
  clickUrl: string;
  placement: AdPlacement;
  priority: number;
  isActive: boolean;
  isVisibleNow: boolean;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdPayload {
  title: string;
  imageUrl: string;
  clickUrl: string;
  placement: AdPlacement;
  priority: number;
  isActive: boolean;
  startAt: string | null;
  endAt: string | null;
}
