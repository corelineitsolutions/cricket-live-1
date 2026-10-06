import type { LatiyalRecord } from '../latiyal/latiyal.types';
import { asRecord, pick, pickNumber, pickText, toNumber, toText } from '../latiyal/latiyal.validation';
import { COMMENTARY_MAX_ITEMS, CommentaryItemDto, CommentaryPlayerDto, ExtraType } from './dto/commentary.dto';

const TEXT_KEYS = ['commentary', 'comment', 'text', 'title', 'description', 'data'] as const;
const OVER_KEYS = ['over', 'overs', 'ball_no', 'over_number', 'ball'] as const;
const MAX_DEPTH = 4;

function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isBall(record: LatiyalRecord): boolean {
  return typeof pick(record, TEXT_KEYS) === 'string' && toNumber(pick(record, OVER_KEYS)) !== null;
}

/** Ball-like records anywhere in the payload, tagged with the innings they were nested under. */
function collectBalls(value: unknown, inning: number | null, depth: number, out: Array<[LatiyalRecord, number | null]>): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectBalls(item, inning, depth + 1, out));
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  if (isBall(record)) {
    out.push([record, inning]);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    const keyInning = /^\d+$/.test(key) ? Number(key) : (toNumber(/inn\w*[_\s]?(\d+)/i.exec(key)?.[1]) ?? inning);
    collectBalls(child, keyInning, depth + 1, out);
  }
}

function player(value: unknown, record: LatiyalRecord, nameKeys: readonly string[], idKeys: readonly string[]): CommentaryPlayerDto {
  const nested = asRecord(value);
  const id = nested ? pickNumber(nested, ['player_id', 'id']) : pickNumber(record, idKeys);
  return {
    sportmonksId: id !== null && id > 0 ? id : null,
    name: nested ? pickText(nested, ['name', 'player_name']) : (toText(value) ?? pickText(record, nameKeys)),
  };
}

function extraOf(text: string, record: LatiyalRecord): { type: ExtraType | null; runs: number } {
  const runs = pickNumber(record, ['extra_runs', 'extras']) ?? 0;
  if (/\bwide\b/i.test(text)) return { type: 'wide', runs: Math.max(1, runs) };
  if (/no[\s-]?ball/i.test(text)) return { type: 'noball', runs: Math.max(1, runs) };
  if (/leg[\s-]?bye/i.test(text)) return { type: 'legbye', runs };
  if (/\bbyes?\b/i.test(text)) return { type: 'bye', runs };
  return { type: null, runs: 0 };
}

/** Latest balls first, capped to what the API can return. */
export function buildCommentary(data: unknown): CommentaryItemDto[] {
  const balls: Array<[LatiyalRecord, number | null]> = [];
  collectBalls(data, null, 0, balls);

  return balls
    .map(([record, nestedInning], index): CommentaryItemDto => {
      const text = pickText(record, TEXT_KEYS)!;
      const result = pickText(record, ['result', 'event', 'type', 'ball_result']);
      const runs = pickNumber(record, ['runs', 'run', 'score']) ?? 0;
      const extra = extraOf(`${result ?? ''} ${text}`, record);
      const wicketFlag = pick(record, ['wicket', 'is_wicket', 'isWicket']);
      return {
        id: pickNumber(record, ['id', 'commentary_id', 'ball_id']) ?? index + 1,
        inning: pickNumber(record, ['inning', 'innings', 'inning_no']) ?? nestedInning,
        over: toNumber(pick(record, OVER_KEYS)) ?? 0,
        teamSportmonksId: pickNumber(record, ['team_id', 'batting_team_id']),
        batsman: player(pick(record, ['batsman', 'striker']), record, ['batsman_name', 'striker_name'], ['batsman_id', 'striker_id']),
        bowler: player(pick(record, ['bowler']), record, ['bowler_name'], ['bowler_id']),
        runs,
        isFour: isTruthy(pick(record, ['is_four', 'four'])) || (runs === 4 && /\bfour\b/i.test(text)) || result === '4',
        isSix: isTruthy(pick(record, ['is_six', 'six'])) || (runs === 6 && /\bsix\b/i.test(text)) || result === '6',
        isWicket:
          wicketFlag !== undefined
            ? isTruthy(wicketFlag)
            : result?.toUpperCase() === 'W' || (/\bout\b|\bwicket\b/i.test(text) && !/not out/i.test(text)),
        extraType: extra.type,
        extraRuns: extra.runs,
        result,
        text,
      };
    })
    .sort((a, b) => (b.inning ?? 0) - (a.inning ?? 0) || b.over - a.over || b.id - a.id)
    .slice(0, COMMENTARY_MAX_ITEMS);
}
