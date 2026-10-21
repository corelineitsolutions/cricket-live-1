import { HISTORY_COVERAGE_NOTE, HISTORY_FORMATS, HistoryFormat, HistoryQueryService, HistTeamSide } from '../../history/history-query.service';
import { splitTeamGender } from '../../identity/identity-matching';
import type { IdentityService } from '../../identity/identity.service';
import type { MatchDto } from '../../matches/dto/match.dto';
import type { MatchesService } from '../../matches/matches.service';
import { AiTool, parseIntInRange, parseMatchId, ToolArgs } from './ai-tool.types';

const PERSON_ID = /^[0-9a-f]{8}$/;
const MAX_NAME = 80;

const formatSchema = { type: 'string', enum: [...HISTORY_FORMATS], description: 'Optional: T20, ODI or Test (domestic included).' };

function text(raw: unknown, max = MAX_NAME): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/\s+/g, ' ');
  return value.length >= 2 && value.length <= max ? value : null;
}

function parseFormat(raw: unknown): HistoryFormat | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  const match = HISTORY_FORMATS.find((f) => typeof raw === 'string' && f.toLowerCase() === raw.trim().toLowerCase());
  return match ?? 'invalid';
}

function parseGender(raw: unknown): 'male' | 'female' | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  return raw === 'male' || raw === 'female' ? raw : 'invalid';
}

const unavailable = (what: string) => ({ found: false, note: `${what} is not in the Cricsheet archive or is not linked yet.`, coverage: HISTORY_COVERAGE_NOTE });

/** IPL archive rows are T20; default format when the user did not say ODI/Test. */
export function defaultEventFormat(event: string, format: HistoryFormat | null): HistoryFormat | null {
  if (format) return format;
  if (/indian\s*premier\s*league|\bipl\b/i.test(event)) return 'T20';
  return null;
}

/** Common misspellings / short forms users type in Ask. */
export function normalizePlayerQuery(name: string): string {
  let value = name.trim().replace(/\s+/g, ' ');
  const aliases: Record<string, string> = {
    'virat kohili': 'Virat Kohli',
    'virat kohli': 'Virat Kohli',
    'rohit sharam': 'Rohit Sharma',
    'rohit shrama': 'Rohit Sharma',
    'rohit sharma': 'Rohit Sharma',
    'ms dhoni': 'MS Dhoni',
    'm s dhoni': 'MS Dhoni',
    'jasprit bumrah': 'Jasprit Bumrah',
    'hardik pandya': 'Hardik Pandya',
    'suryakumar yadav': 'Suryakumar Yadav',
    'surya kumar yadav': 'Suryakumar Yadav',
    sky: 'Suryakumar Yadav',
    'kl rahul': 'KL Rahul',
  };
  const key = value.toLowerCase();
  if (aliases[key]) return aliases[key];
  value = value
    .replace(/\bkohili\b/gi, 'Kohli')
    .replace(/\bsharam\b/gi, 'Sharma')
    .replace(/\bshrama\b/gi, 'Sharma');
  return value;
}

/** Extra Cricsheet spellings to try when the app name does not hit hist_person_names directly. */
export function cricsheetNameFallbacks(name: string): string[] {
  const key = normalizePlayerQuery(name).toLowerCase();
  const map: Record<string, string[]> = {
    'rohit sharma': ['RG Sharma', 'Rohit Sharma'],
    'virat kohli': ['V Kohli', 'Virat Kohli'],
    'suryakumar yadav': ['SA Yadav', 'S Yadav', 'Suryakumar Yadav'],
    'ms dhoni': ['MS Dhoni', 'Mahendra Singh Dhoni'],
    'jasprit bumrah': ['JJ Bumrah', 'Jasprit Bumrah'],
    'kl rahul': ['KL Rahul', 'K Rahul'],
  };
  return map[key] ?? [];
}

export function createHistoryTools(history: HistoryQueryService, identity: IdentityService, matches: MatchesService): AiTool[] {
  const asGender = (g: string | null | undefined): 'male' | 'female' | null =>
    g === 'male' || g === 'female' ? g : null;

  /** Confirmed identity mapping first; otherwise an exact Cricsheet team name. */
  const resolveTeam = async (
    latiyalId: number | null,
    name: string | null,
    gender: 'male' | 'female' | null,
  ): Promise<HistTeamSide | null> => {
    if (latiyalId !== null) {
      const mapped = await identity.confirmedTeamsFor(latiyalId);
      if (mapped) {
        return {
          ids: mapped.histTeamIds,
          name: name ?? String(latiyalId),
          gender: gender ?? asGender(mapped.gender),
        };
      }
    }
    if (!name) return null;
    const split = splitTeamGender(name);
    const ids = await history.teamsByName(split.base);
    if (ids.length === 0) return null;
    return { ids, name, gender: gender ?? (split.gender === 'female' ? 'female' : null) };
  };

  const playerHistory: AiTool<{
    name: string | null;
    personId: string | null;
    format: HistoryFormat | null;
    event: string | null;
    gender: 'male' | 'female' | null;
    year: number | null;
  }> = {
    definition: {
      name: 'get_player_history',
      description:
        'Historical batting and bowling figures of one player from the Cricsheet archive (not official career totals). ' +
        'Give the player name as it appears in the app; if several players match, the result lists them with personId to choose from. ' +
        'For a tournament (e.g. World Cup centuries or wickets), pass event so totals are limited to matches with that event name. ' +
        'Pass year (e.g. 2023) to limit to that season. Pass format (ODI/T20/Test) and gender when the user specifies them. ' +
        'The result includes both battingByEvent and bowlingByEvent when event is set.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Player name, e.g. "Virat Kohli".' },
          personId: { type: 'string', description: 'Cricsheet personId from an earlier candidates list.' },
          format: formatSchema,
          event: { type: 'string', description: 'Optional tournament/event fragment, e.g. "World Cup" or "Asia Cup".' },
          gender: { type: 'string', enum: ['male', 'female'], description: 'Optional; use male for ICC men\'s events.' },
          year: { type: 'integer', description: 'Optional season year, e.g. 2023 for World Cup 2023.' },
        },
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const name = raw.name === undefined ? null : text(raw.name);
      const personId = typeof raw.personId === 'string' && PERSON_ID.test(raw.personId) ? raw.personId : null;
      const format = parseFormat(raw.format);
      if (format === 'invalid') return 'format must be T20, ODI or Test';
      if (raw.personId !== undefined && !personId) return 'personId must be an 8-character id';
      if (raw.name !== undefined && !name) return `name must be 2-${MAX_NAME} characters`;
      if (!name && !personId) return 'name or personId is required';
      const event = raw.event === undefined ? null : text(raw.event, 80);
      if (raw.event !== undefined && (!event || !/^[A-Za-z0-9][A-Za-z0-9 '&./-]{1,79}$/.test(event))) {
        return 'event must be 2-80 characters (letters, digits, spaces)';
      }
      const gender = parseGender(raw.gender);
      if (gender === 'invalid') return 'gender must be male or female';
      const yearRaw = raw.year === undefined || raw.year === null || raw.year === '' ? null : Number(raw.year);
      const year =
        yearRaw === null ? null : Number.isInteger(yearRaw) && yearRaw >= 1877 && yearRaw <= 2100 ? yearRaw : ('invalid' as const);
      if (year === 'invalid') return 'year must be an integer between 1877 and 2100';
      return { name, personId, format, event, gender, year };
    },
    run: async ({ name, personId, format, event, gender, year }) => {
      let id = personId;
      let resolvedFrom = name;
      if (!id) {
        const query = normalizePlayerQuery(name!);
        resolvedFrom = query;
        const byId = new Map<string, { personId: string; name: string }>();
        const addPeople = async (q: string) => {
          for (const p of await history.findPeople(q)) byId.set(p.personId, p);
        };
        await addPeople(query);
        if (query !== name) await addPeople(name!);
        for (const alt of cricsheetNameFallbacks(query)) await addPeople(alt);
        const people = [...byId.values()];
        if (people.length === 0) return unavailable(`"${name}"`);
        if (people.length > 1) {
          // Ambiguous surnames (e.g. many "Sharma"): pick the clear archive leader for this event / format.
          const eventFormat = event ? defaultEventFormat(event, format) : format ?? 'T20';
          const shortlist = people.slice(0, 5);
          const scored = await Promise.all(
            shortlist.map(async (p) => {
              if (event) {
                let rows = await history.playerBattingByEvent(p.personId, event, eventFormat, gender, year);
                if (rows.length === 0 && (eventFormat || gender || year)) {
                  rows = await history.playerBattingByEvent(p.personId, event, null, null, null);
                }
                return {
                  ...p,
                  runs: rows.reduce((s, r) => s + r.runs, 0),
                  hundreds: rows.reduce((s, r) => s + r.hundreds, 0),
                };
              }
              const stats = await history.playerStats(p.personId, eventFormat);
              const runs = (stats.batting as Array<{ runs: number }>).reduce((s, r) => s + r.runs, 0);
              const hundreds = (stats.batting as Array<{ hundreds: number }>).reduce((s, r) => s + r.hundreds, 0);
              return { ...p, runs, hundreds };
            }),
          );
          scored.sort((a, b) => b.runs - a.runs || b.hundreds - a.hundreds);
          const best = scored[0];
          const second = scored[1];
          const clear =
            best.runs > 0 && (!second || best.runs >= second.runs * 2 || best.runs >= second.runs + 500);
          if (!clear) {
            return {
              found: false,
              candidates: scored.map(({ personId: pid, name: n, runs, hundreds }) => ({
                personId: pid,
                name: n,
                runs,
                hundreds,
              })),
              note: 'Several players match this name. Ask the user which one, or retry with personId.',
            };
          }
          id = best.personId;
        } else {
          id = people[0].personId;
        }
      }
      const displayName = await history.personName(id);
      if (!displayName) return unavailable('This player');
      const eventFormat = event ? defaultEventFormat(event, format) : format;
      const stats = await history.playerStats(id, eventFormat);
      if (!event) {
        return {
          player: displayName,
          personId: id,
          queriedAs: resolvedFrom,
          format: format ?? 'all',
          ...stats,
          coverage: HISTORY_COVERAGE_NOTE,
        };
      }
      const loadEvent = (fmt: HistoryFormat | null, g: 'male' | 'female' | null, y: number | null) =>
        Promise.all([
          history.playerBattingByEvent(id!, event, fmt, g, y),
          history.playerBowlingByEvent(id!, event, fmt, g, y),
        ]);
      let [battingByEvent, bowlingByEvent] = await loadEvent(eventFormat, gender, year);
      // Broaden if filters were too tight (common for WC name/format mismatches).
      if (battingByEvent.length === 0 && bowlingByEvent.length === 0 && (eventFormat || gender || year)) {
        [battingByEvent, bowlingByEvent] = await loadEvent(eventFormat, gender, null);
      }
      if (battingByEvent.length === 0 && bowlingByEvent.length === 0 && (eventFormat || gender)) {
        [battingByEvent, bowlingByEvent] = await loadEvent(null, gender ?? 'male', year);
      }
      if (battingByEvent.length === 0 && bowlingByEvent.length === 0) {
        [battingByEvent, bowlingByEvent] = await loadEvent(null, null, null);
      }
      const hundredsInEvent = battingByEvent.reduce((sum, row) => sum + row.hundreds, 0);
      const wicketsInEvent = bowlingByEvent.reduce((sum, row) => sum + row.wickets, 0);
      const runsInEvent = battingByEvent.reduce((sum, row) => sum + row.runs, 0);
      return {
        player: displayName,
        personId: id,
        queriedAs: resolvedFrom,
        format: eventFormat ?? format ?? 'all',
        gender: gender ?? 'any',
        event,
        year: year ?? null,
        hundredsInEvent,
        wicketsInEvent,
        runsInEvent,
        battingByEvent,
        bowlingByEvent,
        // Keep old key for older mock builds; prefer battingByEvent.
        byEvent: battingByEvent,
        batting: stats.batting,
        bowling: stats.bowling,
        note:
          battingByEvent.length === 0 && bowlingByEvent.length === 0
            ? `No matches in the archive whose event name contains "${event}".`
            : `Event filter matches Cricsheet event_name containing "${event}"${year ? ` (year ${year})` : ''} (archive only; not official career totals).`,
        coverage: HISTORY_COVERAGE_NOTE,
      };
    },
    label: ({ name, personId, event, year }) =>
      `Cricsheet archive: ${name ?? personId}${event ? ` (${event}${year ? ` ${year}` : ''})` : ''}`,
  };

  const eventResults: AiTool<{
    event: string;
    year: number | null;
    format: HistoryFormat | null;
    gender: 'male' | 'female' | null;
  }> = {
    definition: {
      name: 'get_event_results',
      description:
        'Tournament or event results from the Cricsheet archive: who won IPL / World Cup / Asia Cup, finals and recent matches. ' +
        'For IPL pass event "Indian Premier League", year (e.g. 2019 or 2026), format T20. ' +
        'Never invent a tournament winner — use this tool. If empty, say the season is not in the archive yet.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Event name fragment, e.g. "Indian Premier League" or "World Cup".' },
          year: { type: 'integer', minimum: 1877, maximum: 2100, description: 'Optional calendar year or season year.' },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'] },
        },
        required: ['event'],
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const event = text(raw.event, 80);
      if (!event || !/^[A-Za-z0-9][A-Za-z0-9 '&./-]{1,79}$/.test(event)) {
        return 'event must be 2-80 characters (letters, digits, spaces)';
      }
      const year =
        raw.year === undefined || raw.year === null || raw.year === ''
          ? null
          : parseIntInRange(raw.year, 1877, 2100);
      if (raw.year !== undefined && raw.year !== null && raw.year !== '' && year === null) {
        return 'year must be an integer from 1877 to 2100';
      }
      const format = parseFormat(raw.format);
      if (format === 'invalid') return 'format must be T20, ODI or Test';
      const gender = parseGender(raw.gender);
      if (gender === 'invalid') return 'gender must be male or female';
      return { event, year, format, gender };
    },
    run: async ({ event, year, format, gender }) => {
      const result = await history.eventResults(event, { year, format: defaultEventFormat(event, format), gender });
      return { ...result, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ event, year }) => `Cricsheet archive: ${event}${year ? ` ${year}` : ''}`,
  };

  const eventLeaders: AiTool<{
    event: string;
    year: number | null;
    format: HistoryFormat | null;
    gender: 'male' | 'female' | null;
    kind: 'batting' | 'bowling' | 'runs_conceded' | 'sixes' | 'fours' | 'hundreds';
  }> = {
    definition: {
      name: 'get_event_leaders',
      description:
        'Tournament leaderboard from the Cricsheet archive (IPL Orange/Purple Cap, most hundreds/sixes/fours, most runs conceded). ' +
        'kind=batting|bowling|hundreds|sixes|fours|runs_conceded. For IPL use event "Indian Premier League", format T20.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Event name fragment, e.g. "Indian Premier League" or "World Cup".' },
          year: { type: 'integer', minimum: 1877, maximum: 2100 },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'] },
          kind: {
            type: 'string',
            enum: ['batting', 'bowling', 'runs_conceded', 'sixes', 'fours', 'hundreds'],
            description:
              'batting=most runs; bowling=most wickets; hundreds=most centuries; sixes/fours=most boundaries; runs_conceded=most runs given.',
          },
        },
        required: ['event', 'kind'],
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const event = text(raw.event, 80);
      if (!event || !/^[A-Za-z0-9][A-Za-z0-9 '&./-]{1,79}$/.test(event)) {
        return 'event must be 2-80 characters (letters, digits, spaces)';
      }
      const year =
        raw.year === undefined || raw.year === null || raw.year === '' ? null : parseIntInRange(raw.year, 1877, 2100);
      if (raw.year !== undefined && raw.year !== null && raw.year !== '' && year === null) {
        return 'year must be an integer from 1877 to 2100';
      }
      const format = parseFormat(raw.format);
      if (format === 'invalid') return 'format must be T20, ODI or Test';
      const gender = parseGender(raw.gender);
      if (gender === 'invalid') return 'gender must be male or female';
      const kind =
        raw.kind === 'bowling' ||
        raw.kind === 'batting' ||
        raw.kind === 'runs_conceded' ||
        raw.kind === 'sixes' ||
        raw.kind === 'fours' ||
        raw.kind === 'hundreds'
          ? raw.kind
          : null;
      if (!kind) return 'kind must be batting, bowling, runs_conceded, sixes, fours or hundreds';
      return { event, year, format, gender, kind };
    },
    run: async ({ event, year, format, gender, kind }) => {
      const result = await history.eventLeaders(event, {
        year,
        format: defaultEventFormat(event, format),
        gender,
        kind,
        limit: 10,
      });
      return { ...result, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ event, year, kind }) => `Cricsheet archive: ${kind} leaders ${event}${year ? ` ${year}` : ''}`,
  };

  const eventStandings: AiTool<{
    event: string;
    year: number | null;
    format: HistoryFormat | null;
    gender: 'male' | 'female' | null;
  }> = {
    definition: {
      name: 'get_event_standings',
      description:
        'League / points-table standings from the Cricsheet archive (played, won, lost, points, NRR). ' +
        'Use for "points table", "who topped the table", "net run rate", "how many wins/points". ' +
        'NRR is computed from innings (archive estimate, not official published table). For IPL: event "Indian Premier League", format T20.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Event name fragment, e.g. "Indian Premier League".' },
          year: { type: 'integer', minimum: 1877, maximum: 2100 },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'] },
        },
        required: ['event'],
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const event = text(raw.event, 80);
      if (!event || !/^[A-Za-z0-9][A-Za-z0-9 '&./-]{1,79}$/.test(event)) {
        return 'event must be 2-80 characters (letters, digits, spaces)';
      }
      const year =
        raw.year === undefined || raw.year === null || raw.year === '' ? null : parseIntInRange(raw.year, 1877, 2100);
      if (raw.year !== undefined && raw.year !== null && raw.year !== '' && year === null) {
        return 'year must be an integer from 1877 to 2100';
      }
      const format = parseFormat(raw.format);
      if (format === 'invalid') return 'format must be T20, ODI or Test';
      const gender = parseGender(raw.gender);
      if (gender === 'invalid') return 'gender must be male or female';
      return { event, year, format, gender };
    },
    run: async ({ event, year, format, gender }) => {
      const result = await history.eventStandings(event, { year, format: defaultEventFormat(event, format), gender });
      return { ...result, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ event, year }) => `Cricsheet archive: standings ${event}${year ? ` ${year}` : ''}`,
  };

  const eventTeamMatches: AiTool<{
    event: string;
    team1: string;
    team2: string;
    year: number | null;
    format: HistoryFormat | null;
    gender: 'male' | 'female' | null;
  }> = {
    definition: {
      name: 'get_event_team_matches',
      description:
        'List of matches between two teams in an event/season from the Cricsheet archive (scores, winner, margin, target). ' +
        'Use for "CSK vs MI result in IPL 2019", "what was the score / winning margin / target". For IPL pass event "Indian Premier League".',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Event fragment, e.g. "Indian Premier League".' },
          team1: { type: 'string', description: 'First team name, e.g. "Chennai Super Kings".' },
          team2: { type: 'string', description: 'Second team name, e.g. "Mumbai Indians".' },
          year: { type: 'integer', minimum: 1877, maximum: 2100 },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'] },
        },
        required: ['event', 'team1', 'team2'],
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const event = text(raw.event, 80);
      const team1 = text(raw.team1);
      const team2 = text(raw.team2);
      if (!event || !/^[A-Za-z0-9][A-Za-z0-9 '&./-]{1,79}$/.test(event)) {
        return 'event must be 2-80 characters (letters, digits, spaces)';
      }
      if (!team1 || !team2) return 'team1 and team2 are required (2-80 characters)';
      const year =
        raw.year === undefined || raw.year === null || raw.year === '' ? null : parseIntInRange(raw.year, 1877, 2100);
      if (raw.year !== undefined && raw.year !== null && raw.year !== '' && year === null) {
        return 'year must be an integer from 1877 to 2100';
      }
      const format = parseFormat(raw.format);
      if (format === 'invalid') return 'format must be T20, ODI or Test';
      const gender = parseGender(raw.gender);
      if (gender === 'invalid') return 'gender must be male or female';
      return { event, team1, team2, year, format, gender };
    },
    run: async ({ event, team1, team2, year, format, gender }) => {
      const a = await resolveTeam(null, team1, gender);
      const b = await resolveTeam(null, team2, gender);
      if (!a || !b) {
        return {
          found: false,
          note: !a ? `Team "${team1}" not found in archive.` : `Team "${team2}" not found in archive.`,
          coverage: HISTORY_COVERAGE_NOTE,
        };
      }
      const result = await history.eventTeamMatches(event, a.ids, b.ids, {
        year,
        format: defaultEventFormat(event, format),
        gender: gender ?? a.gender ?? b.gender,
      });
      return { team1: a.name, team2: b.name, ...result, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ event, team1, team2, year }) =>
      `Cricsheet archive: ${team1} vs ${team2}, ${event}${year ? ` ${year}` : ''}`,
  };

  const eventExtremes: AiTool<{
    event: string;
    year: number | null;
    format: HistoryFormat | null;
    gender: 'male' | 'female' | null;
  }> = {
    definition: {
      name: 'get_event_extremes',
      description:
        'Season extremes from the Cricsheet archive: highest team totals, lowest all-out totals, biggest win margins. ' +
        'Use for "highest team total in IPL 2019", "biggest winning margin", "lowest total". For IPL pass event "Indian Premier League".',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string' },
          year: { type: 'integer', minimum: 1877, maximum: 2100 },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'] },
        },
        required: ['event'],
        additionalProperties: false,
      },
    },
    parse: eventStandings.parse,
    run: async ({ event, year, format, gender }) => {
      const result = await history.eventExtremes(event, { year, format: defaultEventFormat(event, format), gender });
      return { ...result, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ event, year }) => `Cricsheet archive: extremes ${event}${year ? ` ${year}` : ''}`,
  };

  const headToHead: AiTool<{ matchId: string | null; team1: string | null; team2: string | null; format: HistoryFormat | null; gender: 'male' | 'female' | null }> = {
    definition: {
      name: 'get_head_to_head',
      description:
        'Historical results between two teams from the Cricsheet archive. Pass matchId to use the two teams of that match, or two team names.',
      parameters: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Numeric match id; uses its two teams.' },
          team1: { type: 'string', description: 'Team name, e.g. "India".' },
          team2: { type: 'string', description: 'Team name, e.g. "Australia".' },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'], description: 'Optional; women\'s teams are often named "<Team> Women".' },
        },
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const matchId = raw.matchId === undefined ? null : parseMatchId(raw.matchId);
      if (raw.matchId !== undefined && !matchId) return 'matchId must be a numeric id';
      const team1 = raw.team1 === undefined ? null : text(raw.team1);
      const team2 = raw.team2 === undefined ? null : text(raw.team2);
      if (!matchId && (!team1 || !team2)) return 'pass matchId, or team1 and team2 (2-80 characters each)';
      const format = parseFormat(raw.format);
      if (format === 'invalid') return 'format must be T20, ODI or Test';
      const gender = parseGender(raw.gender);
      if (gender === 'invalid') return 'gender must be male or female';
      return { matchId, team1, team2, format, gender };
    },
    run: async ({ matchId, team1, team2, format, gender }) => {
      let match: MatchDto | null = null;
      if (matchId) match = await matches.getMatch(matchId);
      const a = match
        ? await resolveTeam(match.localTeam.sportmonksId, match.localTeam.name, gender)
        : await resolveTeam(null, team1, gender);
      const b = match
        ? await resolveTeam(match.visitorTeam.sportmonksId, match.visitorTeam.name, gender)
        : await resolveTeam(null, team2, gender);
      if (!a || !b) return unavailable(!a ? `Team "${match?.localTeam.name ?? team1}"` : `Team "${match?.visitorTeam.name ?? team2}"`);
      const rows = await history.headToHead(a, b, format ?? (match ? formatOf(match.matchType) : null));
      return { teams: [a.name, b.name], results: rows, note: rows.length ? undefined : 'No meetings in the archive.', coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ matchId, team1, team2 }) => (matchId ? `Cricsheet archive: head-to-head, match ${matchId}` : `Cricsheet archive: ${team1} v ${team2}`),
  };

  const venueHistory: AiTool<{ matchId: string | null; venue: string | null; city: string | null; format: HistoryFormat | null }> = {
    definition: {
      name: 'get_venue_history',
      description:
        'Historical venue record from the Cricsheet archive: matches, average first-innings score, wins batting first and chasing, ' +
        'highest and lowest totals. Pass matchId for that match\'s venue, or a venue name.',
      parameters: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Numeric match id; uses its venue.' },
          venue: { type: 'string', description: 'Ground name, e.g. "Wankhede Stadium".' },
          city: { type: 'string', description: 'Optional city, e.g. "Mumbai".' },
          format: formatSchema,
        },
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const matchId = raw.matchId === undefined ? null : parseMatchId(raw.matchId);
      if (raw.matchId !== undefined && !matchId) return 'matchId must be a numeric id';
      const venue = raw.venue === undefined ? null : text(raw.venue, 191);
      const city = raw.city === undefined ? null : text(raw.city);
      if (!matchId && !venue) return 'pass matchId or venue';
      const format = parseFormat(raw.format);
      if (format === 'invalid') return 'format must be T20, ODI or Test';
      return { matchId, venue, city, format };
    },
    run: async ({ matchId, venue, city, format }) => {
      let name = venue;
      let place = city;
      let matchFormat: HistoryFormat | null = null;
      let ids: number[] = [];
      if (matchId) {
        const match = await matches.getMatch(matchId);
        name = match.venue?.name ?? null;
        place = match.venue?.city ?? null;
        matchFormat = formatOf(match.matchType);
        if (name) ids = await identity.confirmedVenuesFor(name, place);
      }
      if (!name) return unavailable('The venue');
      if (ids.length === 0) ids = await history.venuesByName(name, place);
      if (ids.length === 0) return unavailable(`Venue "${name}"`);
      return { ...(await history.venueStats(ids, format ?? matchFormat)), coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ matchId, venue }) => (matchId ? `Cricsheet archive: venue of match ${matchId}` : `Cricsheet archive: ${venue}`),
  };

  const teamPhases: AiTool<{ team: string; format: 'T20' | 'ODI'; gender: 'male' | 'female' | null }> = {
    definition: {
      name: 'get_team_phase_stats',
      description:
        'Career-style team batting by phase (powerplay/middle/death) across the whole archive for one team. ' +
        'For IPL-season / won-lost / playoffs phase questions prefer get_event_phase_stats.',
      parameters: {
        type: 'object',
        properties: {
          team: { type: 'string', description: 'Team name, e.g. "Mumbai Indians".' },
          format: { type: 'string', enum: ['T20', 'ODI'] },
          gender: { type: 'string', enum: ['male', 'female'] },
        },
        required: ['team', 'format'],
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const team = text(raw.team);
      if (!team) return `team must be 2-${MAX_NAME} characters`;
      const format = parseFormat(raw.format);
      if (format !== 'T20' && format !== 'ODI') return 'format must be T20 or ODI';
      const gender = parseGender(raw.gender);
      if (gender === 'invalid') return 'gender must be male or female';
      return { team, format, gender };
    },
    run: async ({ team, format, gender }) => {
      const side = await resolveTeam(null, team, gender);
      if (!side) return unavailable(`Team "${team}"`);
      const phases = await history.teamPhases(side.ids, side.gender, format);
      return { team, format, phases, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ team }) => `Cricsheet archive: ${team} by phase`,
  };

  const eventAwards: AiTool<{
    event: string;
    year: number | null;
    format: HistoryFormat | null;
    gender: 'male' | 'female' | null;
  }> = {
    definition: {
      name: 'get_event_awards',
      description:
        'Player of the Match award leaders in an event from Cricsheet (and closest proxy for Player of the Tournament = most POTMs). ' +
        'Use for "who won most Player of the Match", "Player of the Tournament". Official POT title is not stored.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string' },
          year: { type: 'integer', minimum: 1877, maximum: 2100 },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'] },
        },
        required: ['event'],
        additionalProperties: false,
      },
    },
    parse: eventStandings.parse,
    run: async ({ event, year, format, gender }) => {
      const result = await history.eventAwards(event, {
        year,
        format: defaultEventFormat(event, format),
        gender,
      });
      return { ...result, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ event, year }) => `Cricsheet archive: awards ${event}${year ? ` ${year}` : ''}`,
  };

  const eventPhaseStats: AiTool<{
    event: string;
    year: number | null;
    format: HistoryFormat | null;
    gender: 'male' | 'female' | null;
    phase: 'powerplay' | 'middle' | 'death' | 'all';
    resultFilter: 'all' | 'won' | 'lost';
    stage: 'all' | 'playoffs';
    subject: 'team' | 'batter';
    team: string | null;
  }> = {
    definition: {
      name: 'get_event_phase_stats',
      description:
        'Team or batter performance in powerplay / middle / death overs inside an event (e.g. IPL 2026), ' +
        'optionally filtered to matches won/lost or playoffs. Use for "best death-over batting", "powerplay in matches won", ' +
        '"which batter scored most in death overs". Home/away is not supported.',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'e.g. "Indian Premier League".' },
          year: { type: 'integer', minimum: 1877, maximum: 2100 },
          format: formatSchema,
          gender: { type: 'string', enum: ['male', 'female'] },
          phase: { type: 'string', enum: ['powerplay', 'middle', 'death', 'all'], description: 'Default all.' },
          resultFilter: { type: 'string', enum: ['all', 'won', 'lost'], description: 'Default all.' },
          stage: { type: 'string', enum: ['all', 'playoffs'], description: 'playoffs = Final/Qualifier/Eliminator.' },
          subject: { type: 'string', enum: ['team', 'batter'], description: 'team leaders or batter leaders. Default team.' },
          team: { type: 'string', description: 'Optional: limit to one batting team.' },
        },
        required: ['event'],
        additionalProperties: false,
      },
    },
    parse: (raw: ToolArgs) => {
      const base = eventStandings.parse(raw);
      if (typeof base === 'string') return base;
      const phase =
        raw.phase === undefined || raw.phase === null || raw.phase === ''
          ? 'all'
          : raw.phase === 'powerplay' || raw.phase === 'middle' || raw.phase === 'death' || raw.phase === 'all'
            ? raw.phase
            : null;
      if (!phase) return 'phase must be powerplay, middle, death or all';
      const resultFilter =
        raw.resultFilter === undefined || raw.resultFilter === null || raw.resultFilter === ''
          ? 'all'
          : raw.resultFilter === 'all' || raw.resultFilter === 'won' || raw.resultFilter === 'lost'
            ? raw.resultFilter
            : null;
      if (!resultFilter) return 'resultFilter must be all, won or lost';
      const stage =
        raw.stage === undefined || raw.stage === null || raw.stage === ''
          ? 'all'
          : raw.stage === 'all' || raw.stage === 'playoffs'
            ? raw.stage
            : null;
      if (!stage) return 'stage must be all or playoffs';
      const subject =
        raw.subject === undefined || raw.subject === null || raw.subject === ''
          ? 'team'
          : raw.subject === 'team' || raw.subject === 'batter'
            ? raw.subject
            : null;
      if (!subject) return 'subject must be team or batter';
      const team = raw.team === undefined ? null : text(raw.team);
      if (raw.team !== undefined && !team) return `team must be 2-${MAX_NAME} characters`;
      return { ...base, phase, resultFilter, stage, subject, team };
    },
    run: async ({ event, year, format, gender, phase, resultFilter, stage, subject, team }) => {
      let teamIds: number[] | null = null;
      if (team) {
        const side = await resolveTeam(null, team, gender);
        if (!side) return unavailable(`Team "${team}"`);
        teamIds = side.ids;
      }
      const result = await history.eventPhaseStats(event, {
        year,
        format: (defaultEventFormat(event, format) as 'T20' | 'ODI' | null) ?? 'T20',
        gender,
        phase,
        resultFilter,
        stage,
        subject,
        teamIds,
      });
      return { ...result, team: team ?? null, coverage: HISTORY_COVERAGE_NOTE };
    },
    label: ({ event, year, phase, subject }) =>
      `Cricsheet archive: ${subject} ${phase} ${event}${year ? ` ${year}` : ''}`,
  };

  return [
    playerHistory,
    eventResults,
    eventLeaders,
    eventStandings,
    eventAwards,
    eventPhaseStats,
    eventTeamMatches,
    eventExtremes,
    headToHead,
    venueHistory,
    teamPhases,
  ] as AiTool[];
}

/** Latiyal match types ("T20", "ODI", "Test", "T20I", ...) to an archive format. */
export function formatOf(matchType: string | null): HistoryFormat | null {
  const value = (matchType ?? '').toLowerCase();
  if (value.includes('test') || value.includes('first class')) return 'Test';
  if (value.includes('odi') || value.includes('one day') || value.includes('list a')) return 'ODI';
  if (value.includes('t20')) return 'T20';
  return null;
}
