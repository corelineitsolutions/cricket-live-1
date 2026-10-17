import type { MatchDto } from '../matches/dto/match.dto';
import { isChasePhase, matchPhase } from './tools/live-tools';

export type SuggestionLanguage = 'en' | 'hi';
export type SuggestionFormat = 'T20' | 'ODI' | 'Test' | 'other';
export type SuggestionPhase = 'pre_match' | 'first_innings' | 'chase' | 'finished' | 'general';

export interface SuggestionItem {
  id: string;
  question: string;
}

export interface SuggestionsResult {
  language: SuggestionLanguage;
  format: SuggestionFormat;
  phase: SuggestionPhase;
  matchId: string | null;
  battingTeam: string | null;
  teams: string[];
  questions: SuggestionItem[];
}

function teamLabel(team: MatchDto['localTeam']): string {
  return team.shortName?.trim() || team.name?.trim() || 'Team';
}

function battingLabel(match: MatchDto): string | null {
  const id = match.battingTeamSportmonksId;
  if (id === null) return null;
  if (id === match.localTeam.sportmonksId) return teamLabel(match.localTeam);
  if (id === match.visitorTeam.sportmonksId) return teamLabel(match.visitorTeam);
  return null;
}

export function classifyFormat(matchType: string | null | undefined): SuggestionFormat {
  const t = (matchType ?? '').toUpperCase();
  if (/TEST|FC|FIRST.?CLASS/.test(t)) return 'Test';
  if (/ODI|LIST.?A|ONE.?DAY/.test(t)) return 'ODI';
  if (/T20|IT20|T20I|BLAST|IPL|HUNDRED/.test(t)) return 'T20';
  return 'other';
}

function q(id: string, en: string, hi: string, language: SuggestionLanguage): SuggestionItem {
  return { id, question: language === 'hi' ? hi : en };
}

/** Chip questions when the user is not on a match screen. */
export function generalSuggestions(language: SuggestionLanguage): SuggestionsResult {
  const questions = [
    q('g-ipl-2019', 'Who won IPL 2019?', 'IPL 2019 कौन जीता?', language),
    q('g-odi-wc-2019', 'Who won the ICC ODI World Cup 2019?', 'ICC ODI विश्व कप 2019 कौन जीता?', language),
    q('g-t20-wc', 'Who won the T20 World Cup 2024?', 'T20 विश्व कप 2024 कौन जीता?', language),
    q('g-kohli-ipl', 'How many hundreds has Virat Kohli scored in the IPL?', 'विराट कोहली ने IPL में कितने शतक लगाए?', language),
    q('g-orange', 'Who won the Orange Cap in IPL 2023?', 'IPL 2023 में ऑरेंज कैप किसने जीता?', language),
    q('g-live', 'Which matches are live right now?', 'अभी कौन से मैच लाइव हैं?', language),
  ];
  return {
    language,
    format: 'other',
    phase: 'general',
    matchId: null,
    battingTeam: null,
    teams: [],
    questions,
  };
}

/** Chip questions for a match screen — format + innings phase aware. */
export function matchSuggestions(match: MatchDto, language: SuggestionLanguage): SuggestionsResult {
  const format = classifyFormat(match.matchType);
  const phase = matchPhase(match);
  const a = teamLabel(match.localTeam);
  const b = teamLabel(match.visitorTeam);
  const bat = battingLabel(match) ?? a;
  const chase = isChasePhase(match);
  const questions: SuggestionItem[] = [];

  if (phase === 'finished') {
    questions.push(
      q('m-result', `Who won ${a} vs ${b}?`, `${a} बनाम ${b} कौन जीता?`, language),
      q('m-top', 'Who was the top scorer on the scorecard?', 'स्कोरकार्ड पर सबसे ज्यादा रन किसके?', language),
      q('m-h2h', `What is the head-to-head between ${a} and ${b}?`, `${a} और ${b} का हेड-टू-हेड क्या है?`, language),
      q('m-venue', "Show this ground's record from the Cricsheet archive", 'इस मैदान का Cricsheet रिकॉर्ड दिखाओ', language),
    );
  } else if (chase || phase === 'chase') {
    if (chase) {
      questions.push(
        q('m-rrr', `How many runs per over does ${bat} need?`, `${bat} को प्रति ओवर कितने रन चाहिए?`, language),
        q('m-need', `How many runs does ${bat} still need?`, `${bat} को अभी कितने रन और चाहिए?`, language),
      );
      if (format !== 'Test') {
        questions.push(q('m-target', `What is the target for ${bat}?`, `${bat} का target क्या है?`, language));
      }
    }
    questions.push(
      q('m-win', `What is the win chance for ${a} vs ${b}?`, `${a} बनाम ${b} की जीत संभावना क्या है?`, language),
      q('m-next', 'How many runs in the next 6 overs?', 'अगले 6 ओवर में कितने रन?', language),
      q('m-batter', 'How is the current batter performing?', 'मौजूदा बल्लेबाज कैसा खेल रहा है?', language),
    );
  } else if (phase === 'first_innings') {
    questions.push(
      q('m-proj', `What is the projected score for ${bat}?`, `${bat} का अनुमानित स्कोर क्या है?`, language),
      q(
        'm-est-target',
        `What target might ${bat} set?`,
        `${bat} कितना target दे सकता है?`,
        language,
      ),
      q('m-next', 'How many runs in the next 6 overs?', 'अगले 6 ओवर में कितने रन?', language),
      q('m-batter', 'How is the current batter performing?', 'मौजूदा बल्लेबाज कैसा खेल रहा है?', language),
      q('m-win', `What is the win chance for ${a} vs ${b}?`, `${a} बनाम ${b} की जीत संभावना क्या है?`, language),
    );
    if (format === 'ODI') {
      questions.push(
        q('m-50', `What score might ${bat} reach in 50 overs?`, `${bat} 50 ओवर में कितना स्कोर कर सकता है?`, language),
      );
    }
    if (format === 'T20') {
      questions.push(
        q('m-20', `What score might ${bat} reach in 20 overs?`, `${bat} 20 ओवर में कितना स्कोर कर सकता है?`, language),
      );
    }
  } else {
    questions.push(
      q('m-start', `When does ${a} vs ${b} start?`, `${a} बनाम ${b} कब शुरू होगा?`, language),
      q('m-h2h', `What is the head-to-head between ${a} and ${b}?`, `${a} और ${b} का हेड-टू-हेड क्या है?`, language),
      q('m-venue', "Show this ground's record from the Cricsheet archive", 'इस मैदान का Cricsheet रिकॉर्ड दिखाओ', language),
    );
  }

  questions.push(
    q('m-h2h-extra', `What is the head-to-head between ${a} and ${b}?`, `${a} और ${b} का हेड-टू-हेड?`, language),
    q('m-scorecard', 'Who is the top scorer on the scorecard?', 'स्कोरकार्ड पर टॉप स्कोरर कौन है?', language),
  );

  // Dedupe by question text while keeping order.
  const seen = new Set<string>();
  const unique = questions.filter((item) => {
    const key = item.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    language,
    format,
    phase,
    matchId: String(match.matchId),
    battingTeam: bat,
    teams: [a, b],
    questions: unique.slice(0, 8),
  };
}
