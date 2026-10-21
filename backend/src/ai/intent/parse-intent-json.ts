import {
  AI_INTENT_SET,
  AiIntentName,
  AiIntentParameters,
  AiIntentResult,
  EVENT_LEADER_KINDS,
  EventLeaderKind,
} from './ai-intent.types';

const PLAYER_NAME = /^[A-Za-z][A-Za-z .'-]{1,79}$/;
const TEAM_NAME = /^[A-Za-z0-9][A-Za-z0-9 .'-]{1,59}$/;
const EVENT_NAME = /^[A-Za-z0-9][A-Za-z0-9 '&./-]{1,79}$/;

/** Strip Qwen thinking / markdown fences and extract the first JSON object. */
export function extractJsonObject(raw: string): string | null {
  let text = raw.trim();
  // Qwen3 thinking blocks (llama.cpp may still emit them).
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return Math.min(1, n / 100);
  return Math.max(0, Math.min(1, n));
}

function parseOptionalInt(raw: unknown, min: number, max: number): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

function parseOptionalString(raw: unknown, re: RegExp): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().replace(/\s+/g, ' ');
  return re.test(value) ? value : undefined;
}

function parseParameters(raw: unknown): AiIntentParameters {
  const obj = asRecord(raw) ?? {};
  const params: AiIntentParameters = {};
  const overs = parseOptionalInt(obj.overs ?? obj.oversAhead, 1, 20);
  if (overs !== undefined) params.overs = overs;
  const playerName = parseOptionalString(obj.playerName ?? obj.player ?? obj.name, PLAYER_NAME);
  if (playerName) params.playerName = playerName;
  const event = parseOptionalString(obj.event, EVENT_NAME);
  if (event) params.event = event;
  const year = parseOptionalInt(obj.year, 1877, 2100);
  if (year !== undefined) params.year = year;
  const formatRaw = typeof obj.format === 'string' ? obj.format.trim().toUpperCase() : '';
  if (formatRaw === 'T20' || formatRaw === 'ODI' || formatRaw === 'TEST') {
    params.format = formatRaw === 'TEST' ? 'Test' : (formatRaw as 'T20' | 'ODI');
  }
  if (obj.gender === 'male' || obj.gender === 'female') params.gender = obj.gender;
  const kind = typeof obj.leaderKind === 'string' ? obj.leaderKind : typeof obj.kind === 'string' ? obj.kind : '';
  if ((EVENT_LEADER_KINDS as readonly string[]).includes(kind)) params.leaderKind = kind as EventLeaderKind;
  const team1 = parseOptionalString(obj.team1, TEAM_NAME);
  const team2 = parseOptionalString(obj.team2, TEAM_NAME);
  if (team1) params.team1 = team1;
  if (team2) params.team2 = team2;
  const runsNeeded = parseOptionalInt(obj.runsNeeded ?? obj.runs, 1, 2000);
  if (runsNeeded !== undefined) params.runsNeeded = runsNeeded;
  const oversRemaining = parseOptionalInt(obj.oversRemaining, 1, 100);
  if (oversRemaining !== undefined) params.oversRemaining = oversRemaining;
  const ballsRemaining = parseOptionalInt(obj.ballsRemaining, 1, 600);
  if (ballsRemaining !== undefined) params.ballsRemaining = ballsRemaining;
  return params;
}

/**
 * Validate classifier JSON. Rejects unknown intents and strips unsafe fields
 * (never accepts matchId / personId / tool names from the model).
 */
export function parseIntentPayload(raw: string): AiIntentResult | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const obj = asRecord(parsed);
  if (!obj) return null;

  const intentRaw = typeof obj.intent === 'string' ? obj.intent.trim() : '';
  if (!AI_INTENT_SET.has(intentRaw)) return null;
  const intent = intentRaw as AiIntentName;

  const domainRaw = typeof obj.domain === 'string' ? obj.domain.trim().toLowerCase() : '';
  const domain: 'cricket' | 'other' =
    domainRaw === 'other' || intent === 'out_of_domain' ? 'other' : domainRaw === 'cricket' || !domainRaw ? 'cricket' : 'other';

  const needsMatch =
    obj.needs_match === true ||
    obj.needsMatch === true ||
    obj.needs_match === 'true' ||
    obj.needsMatch === 'true';

  return {
    domain: intent === 'out_of_domain' ? 'other' : domain,
    intent,
    parameters: parseParameters(obj.parameters),
    needsMatch: needsMatch || intent === 'needs_match',
    confidence: clampConfidence(obj.confidence),
  };
}
