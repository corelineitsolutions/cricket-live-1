/**
 * Conservative name matching between Latiyal (live) entities and the Cricsheet history.
 * Everything produced here is only a proposal; an admin confirms or rejects it.
 */

export type MatchMethod = 'exact_name' | 'initials_surname' | 'exact_venue';

export interface Proposal<L, H> {
  latiyal: L;
  hist: H;
  method: MatchMethod;
  confidence: number;
  evidence: Record<string, unknown>;
}

const SURNAME_PARTICLES = new Set(['de', 'da', 'di', 'du', 'van', 'von', 'der', 'den', 'le', 'la', 'ten', 'ter', 'st']);
/** A Latiyal player with more equally good candidates than this is left for manual mapping. */
export const MAX_PLAYER_CANDIDATES = 3;

function fold(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** Lowercase, accents removed, punctuation dropped, single spaces. */
export function normalizeText(value: string): string {
  return fold(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface NameParts {
  full: string;
  surname: string;
  initials: string;
}

/** "RG Sharma" -> initials "rg", surname "sharma"; "Quinton de Kock" -> "q", "de kock". */
export function nameParts(name: string): NameParts | null {
  const tokens = fold(name)
    .replace(/['’.]/g, '')
    .split(/[^A-Za-z]+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  let start = tokens.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(tokens[start - 1].toLowerCase())) start--;
  const given = tokens.slice(0, start);
  const initials = given
    .map((token) => (token.length <= 4 && token === token.toUpperCase() ? token : token[0]))
    .join('')
    .toLowerCase();
  return {
    full: tokens.join(' ').toLowerCase(),
    surname: tokens.slice(start).join(' ').toLowerCase(),
    initials,
  };
}

/** "Rohit Sharma" and "RG Sharma" are compatible (same surname, initials agree); "RS Sharma" is not. */
export function compareNames(a: NameParts, b: NameParts): MatchMethod | null {
  if (a.full === b.full) return 'exact_name';
  if (a.surname !== b.surname || !a.initials || !b.initials) return null;
  return a.initials.startsWith(b.initials) || b.initials.startsWith(a.initials) ? 'initials_surname' : null;
}

export interface LatiyalPlayer {
  latiyalId: number;
  name: string;
  country: string | null;
}

export interface HistPersonNames {
  personId: string;
  names: string[];
}

interface Scored {
  personId: string;
  method: MatchMethod;
  score: number;
  countryMatch: boolean;
}

export function proposePlayers(
  latiyalPlayers: LatiyalPlayer[],
  people: HistPersonNames[],
  internationalTeamsByPerson: Map<string, Set<string>>,
): { proposals: Proposal<number, string>[]; ambiguous: number; unmatched: number } {
  const bySurname = new Map<string, Array<{ personId: string; parts: NameParts }>>();
  for (const person of people) {
    for (const name of person.names) {
      const parts = nameParts(name);
      if (!parts) continue;
      const list = bySurname.get(parts.surname) ?? [];
      list.push({ personId: person.personId, parts });
      bySurname.set(parts.surname, list);
    }
  }

  const proposals: Proposal<number, string>[] = [];
  let ambiguous = 0;
  let unmatched = 0;
  for (const player of latiyalPlayers) {
    const parts = nameParts(player.name);
    const country = player.country ? normalizeText(player.country) : null;
    const best = new Map<string, Scored>();
    for (const candidate of parts ? (bySurname.get(parts.surname) ?? []) : []) {
      const method = compareNames(parts!, candidate.parts);
      if (!method) continue;
      let score = method === 'exact_name' ? 90 : 60;
      const countryMatch = !!country && (internationalTeamsByPerson.get(candidate.personId)?.has(country) ?? false);
      if (countryMatch) score += 10;
      const previous = best.get(candidate.personId);
      if (!previous || previous.score < score) best.set(candidate.personId, { personId: candidate.personId, method, score, countryMatch });
    }

    let candidates = [...best.values()];
    if (candidates.some((c) => c.countryMatch)) candidates = candidates.filter((c) => c.countryMatch);
    const top = Math.max(0, ...candidates.map((c) => c.score));
    candidates = candidates.filter((c) => c.score === top);
    if (candidates.length === 0) {
      unmatched++;
      continue;
    }
    if (candidates.length > MAX_PLAYER_CANDIDATES) {
      ambiguous++;
      continue;
    }
    for (const c of candidates) {
      proposals.push({
        latiyal: player.latiyalId,
        hist: c.personId,
        method: c.method,
        confidence: candidates.length > 1 ? Math.max(30, c.score - 20) : c.score,
        evidence: { countryMatch: c.countryMatch, candidates: candidates.length },
      });
    }
  }
  return { proposals, ambiguous, unmatched };
}

export type Gender = 'male' | 'female';

/** Latiyal marks women's sides in the name ("India Women", "India W"). */
export function splitTeamGender(name: string): { base: string; gender: Gender } {
  const match = /^(.*?)\s+(women'?s?|w)$/i.exec(name.trim());
  return match ? { base: match[1], gender: 'female' } : { base: name, gender: 'male' };
}

export interface LatiyalTeam {
  latiyalId: number;
  name: string;
}

export interface HistTeamRef {
  id: number;
  name: string;
  teamType: string;
}

export function proposeTeams(
  latiyalTeams: LatiyalTeam[],
  histTeams: HistTeamRef[],
): { proposals: Array<Proposal<number, number> & { gender: Gender }>; unmatched: number } {
  const byName = new Map<string, HistTeamRef[]>();
  for (const team of histTeams) {
    const key = normalizeText(team.name);
    byName.set(key, [...(byName.get(key) ?? []), team]);
  }
  const proposals: Array<Proposal<number, number> & { gender: Gender }> = [];
  let unmatched = 0;
  for (const team of latiyalTeams) {
    const { base, gender } = splitTeamGender(team.name);
    const matches = byName.get(normalizeText(base)) ?? [];
    if (matches.length === 0) {
      unmatched++;
      continue;
    }
    for (const hist of matches) {
      proposals.push({
        latiyal: team.latiyalId,
        hist: hist.id,
        gender,
        method: 'exact_name',
        confidence: matches.length === 1 ? 90 : 50,
        evidence: { teamType: hist.teamType, candidates: matches.length },
      });
    }
  }
  return { proposals, unmatched };
}

export interface VenueRef {
  name: string;
  city: string | null;
}

/** "Wankhede Stadium, Mumbai" + city "Mumbai" -> { name: "wankhede stadium", city: "mumbai" }. */
export function venueParts(venue: VenueRef): { name: string; city: string | null } {
  let name = venue.name.trim();
  let city = venue.city?.trim() || null;
  const comma = name.lastIndexOf(',');
  if (comma > 0) {
    const tail = name.slice(comma + 1).trim();
    if (!city) {
      city = tail;
      name = name.slice(0, comma);
    } else if (normalizeText(tail) === normalizeText(city)) {
      name = name.slice(0, comma);
    }
  }
  return { name: normalizeText(name), city: city ? normalizeText(city) : null };
}

export interface HistVenueRef extends VenueRef {
  id: number;
}

/** Every Cricsheet spelling of the same ground is proposed; differing cities never match. */
export function proposeVenues(
  liveVenues: VenueRef[],
  histVenues: HistVenueRef[],
): { proposals: Proposal<VenueRef, number>[]; unmatched: number } {
  const byName = new Map<string, Array<{ venue: HistVenueRef; city: string | null }>>();
  for (const venue of histVenues) {
    const parts = venueParts(venue);
    byName.set(parts.name, [...(byName.get(parts.name) ?? []), { venue, city: parts.city }]);
  }
  const proposals: Proposal<VenueRef, number>[] = [];
  let unmatched = 0;
  for (const live of liveVenues) {
    const parts = venueParts(live);
    const matches = (byName.get(parts.name) ?? []).filter((m) => !parts.city || !m.city || m.city === parts.city);
    if (matches.length === 0) {
      unmatched++;
      continue;
    }
    for (const m of matches) {
      const cityMatch = !!parts.city && m.city === parts.city;
      proposals.push({
        latiyal: live,
        hist: m.venue.id,
        method: 'exact_venue',
        confidence: cityMatch ? 90 : 75,
        evidence: { cityMatch },
      });
    }
  }
  return { proposals, unmatched };
}
