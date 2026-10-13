import { HISTORY_COVERAGE_NOTE, HISTORY_FORMATS, HistoryFormat, HistoryQueryService, HistTeamSide } from '../../history/history-query.service';
import { splitTeamGender } from '../../identity/identity-matching';
import type { IdentityService } from '../../identity/identity.service';
import type { MatchDto } from '../../matches/dto/match.dto';
import type { MatchesService } from '../../matches/matches.service';
import { AiTool, parseMatchId, ToolArgs } from './ai-tool.types';

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

export function createHistoryTools(history: HistoryQueryService, identity: IdentityService, matches: MatchesService): AiTool[] {
  /** Confirmed identity mapping first; otherwise an exact Cricsheet team name. */
  const resolveTeam = async (latiyalId: number | null, name: string | null, gender: string | null): Promise<HistTeamSide | null> => {
    if (latiyalId !== null) {
      const mapped = await identity.confirmedTeamsFor(latiyalId);
      if (mapped) return { ids: mapped.histTeamIds, name: name ?? String(latiyalId), gender: gender ?? mapped.gender };
    }
    if (!name) return null;
    const split = splitTeamGender(name);
    const ids = await history.teamsByName(split.base);
    if (ids.length === 0) return null;
    return { ids, name, gender: gender ?? (split.gender === 'female' ? 'female' : null) };
  };

  const playerHistory: AiTool<{ name: string | null; personId: string | null; format: HistoryFormat | null; event: string | null }> = {
    definition: {
      name: 'get_player_history',
      description:
        'Historical batting and bowling figures of one player from the Cricsheet archive (not official career totals). ' +
        'Give the player name as it appears in the app; if several players match, the result lists them with personId to choose from. ' +
        'For a tournament (e.g. World Cup centuries), pass event so totals are limited to matches with that event name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Player name, e.g. "Virat Kohli".' },
          personId: { type: 'string', description: 'Cricsheet personId from an earlier candidates list.' },
          format: formatSchema,
          event: { type: 'string', description: 'Optional tournament/event fragment, e.g. "World Cup" or "Asia Cup".' },
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
      return { name, personId, format, event };
    },
    run: async ({ name, personId, format, event }) => {
      let id = personId;
      if (!id) {
        const people = await history.findPeople(name!);
        if (people.length === 0) return unavailable(`"${name}"`);
        if (people.length > 1) {
          return { found: false, candidates: people, note: 'Several players match this name. Ask the user which one, or retry with personId.' };
        }
        id = people[0].personId;
      }
      const displayName = await history.personName(id);
      if (!displayName) return unavailable('This player');
      const stats = await history.playerStats(id, format);
      if (!event) {
        return { player: displayName, personId: id, format: format ?? 'all', ...stats, coverage: HISTORY_COVERAGE_NOTE };
      }
      const byEvent = await history.playerBattingByEvent(id, event);
      const hundreds = byEvent.reduce((sum, row) => sum + row.hundreds, 0);
      return {
        player: displayName,
        personId: id,
        format: format ?? 'all',
        event,
        hundredsInEvent: hundreds,
        byEvent,
        batting: stats.batting,
        bowling: stats.bowling,
        note:
          byEvent.length === 0
            ? `No matches in the archive whose event name contains "${event}".`
            : `Event filter matches Cricsheet event_name containing "${event}" (archive only).`,
        coverage: HISTORY_COVERAGE_NOTE,
      };
    },
    label: ({ name, personId, event }) => `Cricsheet archive: ${name ?? personId}${event ? ` (${event})` : ''}`,
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
        'How a team bats in each phase (powerplay, middle, death) of T20 or ODI cricket in the Cricsheet archive: run rate, wickets and dot balls per phase.',
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

  return [playerHistory, headToHead, venueHistory, teamPhases] as AiTool[];
}

/** Latiyal match types ("T20", "ODI", "Test", "T20I", ...) to an archive format. */
export function formatOf(matchType: string | null): HistoryFormat | null {
  const value = (matchType ?? '').toLowerCase();
  if (value.includes('test') || value.includes('first class')) return 'Test';
  if (value.includes('odi') || value.includes('one day') || value.includes('list a')) return 'ODI';
  if (value.includes('t20')) return 'T20';
  return null;
}
