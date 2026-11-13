import { AiTool, parseIntInRange } from './ai-tool.types';

/** "5.3" overs → 33 balls (six-ball overs). Null for invalid notation such as "5.7". */
export function oversToBalls(raw: unknown): number | null {
  // Numbers first — String(15.2) is fine, but float noise like 15.2000001 must not fail.
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    const rounded = Math.round(raw * 10) / 10;
    const whole = Math.trunc(rounded);
    const part = Math.round((rounded - whole) * 10);
    if (part < 0 || part > 5) return null;
    const balls = whole * 6 + part;
    return balls > 0 && balls <= 900 ? balls : null;
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  const match = /^(\d{1,3})(?:\.([0-5]))?$/.exec(text);
  if (!match) return null;
  const balls = Number(match[1]) * 6 + Number(match[2] ?? 0);
  return balls > 0 && balls <= 900 ? balls : null;
}

export function requiredRate(runsNeeded: number, ballsRemaining: number) {
  const perBall = runsNeeded / ballsRemaining;
  return {
    runsNeeded,
    ballsRemaining,
    oversRemaining: `${Math.floor(ballsRemaining / 6)}.${ballsRemaining % 6}`,
    requiredRunRate: Math.round(perBall * 6 * 100) / 100,
    runsPerBall: Math.round(perBall * 100) / 100,
    boundariesIfOnlyFours: Math.ceil(runsNeeded / 4),
    note: 'Arithmetic only (six-ball overs). This is not a win probability.',
  };
}

export const requiredRateTool: AiTool<{ runsNeeded: number; ballsRemaining: number }> = {
  definition: {
    name: 'calculate_required_rate',
    description:
      'Required run rate for a chase, e.g. "100 runs in 6 overs". Give runsNeeded and either ballsRemaining or oversRemaining (cricket notation, 5.3 = 5 overs 3 balls).',
    parameters: {
      type: 'object',
      properties: {
        runsNeeded: { type: 'integer', minimum: 1, maximum: 1000 },
        ballsRemaining: { type: 'integer', minimum: 1, maximum: 600 },
        oversRemaining: { type: 'string', description: 'Cricket notation, e.g. "6" or "5.3".' },
      },
      required: ['runsNeeded'],
      additionalProperties: false,
    },
  },
  parse: (raw) => {
    const runsNeeded = parseIntInRange(raw.runsNeeded, 1, 1000);
    if (runsNeeded === null) return 'runsNeeded must be an integer from 1 to 1000';
    const balls =
      raw.ballsRemaining !== undefined ? parseIntInRange(raw.ballsRemaining, 1, 600) : oversToBalls(raw.oversRemaining);
    return balls === null ? 'give ballsRemaining (1-600) or oversRemaining like "5.3"' : { runsNeeded, ballsRemaining: balls };
  },
  run: async ({ runsNeeded, ballsRemaining }) => requiredRate(runsNeeded, ballsRemaining),
  label: () => 'Run-rate calculation',
};
