import { estimateTokens, LlmChatRequest, LlmChatResponse, LlmMessage, LlmProvider, LlmToolCall } from './llm.types';

export const MOCK_NOTE = {
  en: '(Demo answer built from app data without an AI model.)',
  hi: '(डेमो उत्तर: बिना AI मॉडल के ऐप डेटा से बनाया गया।)',
} as const;

const RUNS_THEN_OVERS = /(\d{1,4})\s*(?:runs?|रन)\D{0,24}?(\d{1,3}(?:\.[0-5])?)\s*(overs?|balls?|ओवर|गेंद)/i;
const OVERS_THEN_RUNS = /(\d{1,3}(?:\.[0-5])?)\s*(overs?|balls?|ओवर|गेंद)\D{0,24}?(\d{1,4})\s*(?:runs?|रन)/i;

function rateQuestion(question: string): { runs: number; amount: string; unit: string } | null {
  const a = RUNS_THEN_OVERS.exec(question);
  if (a) return { runs: Number(a[1]), amount: a[2], unit: a[3] };
  const b = OVERS_THEN_RUNS.exec(question);
  return b ? { runs: Number(b[3]), amount: b[1], unit: b[2] } : null;
}
const SCORECARD_WORDS = /scorecard|batting|bowling|top scorer|highest|wickets? taken|स्कोरकार्ड|बल्लेबाज|गेंदबाज/i;
const BATTER_WORDS = /current batter|batter(?:s)? performing|batsman|how is .+ batting|on strike|creases?|कैसे\s*खेल|बल्लेबाज/i;
const COMMENTARY_WORDS = /last (?:over|ball)|recent|commentary|just happened|कमेंट्री|पिछल|आखिरी/i;
const HEAD_TO_HEAD_WORDS = /head[\s-]?to[\s-]?head|h2h|record (?:against|vs)|आमने[\s-]?सामने/i;
const VENUE_WORDS = /venue|ground|stadium|pitch|मैदान|पिच|स्टेडियम/i;
const REQUIRED_RATE_LIVE =
  /runs?\s*per\s*over|required\s*(?:run\s*)?rate|\brrr\b|need(?:s)?\s+(?:to\s+)?(?:score|get|make)|how\s+many\s+runs.+\bneed|कितने\s*रन\s*प्रति\s*ओवर/i;
const PLAYER_HISTORY_WORDS =
  /career|record|stats|statistics|average|strike rate|centur(?:y|ies)|hundreds?|\b100s?\b|\b50s?\b|fifties|wickets?|bowling|economy|how many|करियर|रिकॉर्ड|आंकड़े|औसत|शतक|विकेट|गेंदबाज/i;
const EVENT_WORDS = /world\s*cup|\bwc\b|asia\s*cup|champions\s*trophy|ashes|ipl|t20\s*world\s*cup/i;
const EVENT_WINNER_WORDS =
  /who\s+won|who\s+win|which\s+team\s+won|winner\s+of|won\s+the|how\s+win|who\s+lifted|champion\s+of|ipl\s+\d{4}\s+title|title\b|runner[\s-]?up|जीता|विजेता/i;
const EVENT_LEADER_RUNS =
  /most\s+runs?|top\s+scorer|highest\s+runs?|orange\s*cap|hit\s+the\s+most\s+run|कौन\s*ने\s*सबसे\s*ज्यादा\s*रन|सर्वाधिक\s*रन/i;
const EVENT_LEADER_WICKETS =
  /most\s+wickets?|top\s+wicket|purple\s*cap|take\s+the\s+most\s+wicket|कौन\s*ने\s*सबसे\s*ज्यादा\s*विकेट|सर्वाधिक\s*विकेट/i;
const EVENT_LEADER_CONCEDED =
  /most\s+runs?\s+conceded|most\s+(?:runs?\s+)?given|runs?\s+conceded|सबसे\s*ज्यादा\s*रन\s*दिए/i;
const EVENT_LEADER_SIXES = /most\s+sixes?|hit\s+the\s+most\s+six|सर्वाधिक\s*छक्के|सबसे\s*ज्यादा\s*छक्के/i;
const EVENT_LEADER_FOURS = /most\s+fours?|hit\s+the\s+most\s+four|सर्वाधिक\s*चौके|सबसे\s*ज्यादा\s*चौके/i;
const EVENT_LEADER_HUNDREDS =
  /most\s+hundreds?|most\s+centur(?:y|ies)|hit\s+the\s+most\s+hundred|who\s+hit\s+the\s+most\s+hundred|सर्वाधिक\s*शतक|सबसे\s*ज्यादा\s*शतक/i;
const EVENT_EXTREMES_WORDS =
  /highest\s+(?:team\s+)?total|lowest\s+(?:team\s+)?total|biggest\s+winn(?:ing)?\s+margin|smallest\s+margin|highest\s+successful\s+chase/i;
const EVENT_MATCH_WORDS =
  /(?:result|score|target|winning\s+margin|margin)\s+.*(?:vs\.?|versus|against)|(?:vs\.?|versus|against).*(?:result|score|target|margin)|what\s+score\s+did|how\s+many\s+overs\s+did\s+.+\s+take\s+to\s+chase/i;
const EVENT_STANDINGS_WORDS =
  /points?\s*table|league\s*table|standings?|topped\s+the\s+(?:league\s+)?table|how\s+many\s+(?:matches?\s+)?(?:did\s+)?.+\s+win|how\s+many\s+points|net\s*run\s*rate|\bnrr\b|qualify(?:ied)?\s+for\s+(?:the\s+)?playoffs?|पॉइंट(?:्स)?\s*टेबल/i;
const EVENT_AWARDS_WORDS =
  /player\s+of\s+the\s+(?:match|tournament)|most\s+player\s+of\s+the\s+match|potm|\bpot\b|मैन\s*ऑफ\s*द\s*मैच|प्लेयर\s*ऑफ\s*द\s*टूर्नामेंट/i;
const EVENT_PHASE_WORDS =
  /powerplay|death[\s-]?overs?|middle[\s-]?overs?|phase|best\s+(?:batting|bowling)\s+performance|which\s+(?:team|batter|bowler)\s+had\s+the\s+best/i;
const TOSS_WORDS =
  /\btoss\b|टॉस|toss\s+kon|kon\s+.*\btoss|toss\s+jit|jit\s+.*\btoss|who\s+(?:will\s+)?win\s+the\s+toss|toss\s+kon\s+jit/i;
const WIN_PROB_WORDS =
  /win\s*chance|win\s*prob|probability|who\s+will\s+win|who\s+wins|who\s+do\s+you\s+think\s+will\s+win|what\s+do\s+you\s+think\s+who\s+win|match\s+kon\s+jit|kon\s+jit\s+sakt|jit\s+sakt[ae]|favourites?|जीत(?:ने)?\s*की\s*संभावना|कौन\s*जीतेगा|मैच\s*कौन\s*जीत|कौन\s*जीत\s*सक/i;
const PROJECT_SCORE_WORDS = /project(?:ed)?\s*score|projected\s*total|final\s*score\s*predict|अनुमानित\s*स्कोर/i;
/** Target / "kitna target" — 1st innings → project_score; chase → get_match. Never invent score+1 as the official target. */
const TARGET_WORDS =
  /\btarget\b|लक्ष्य|kitn[ae]\s+(?:ka\s+)?target|target\s+kitn|de\s+shakt|दे\s*सक|जीतने\s*के\s*लिए|jeetne\s*ke\s*liye/i;
const NEXT_OVERS_WORDS = /(?:next|coming|next)\s*\d+\s*overs?|runs?\s+in\s+(?:the\s+)?(?:next\s+)?\d+\s*overs?|अगले\s*\d+\s*ओवर/i;
const TEAMS_VS = /([A-Z][\w']*(?:\s+[A-Z][\w']*){0,3})\s+(?:vs\.?|v|versus|बनाम)\s+([A-Z][\w']*(?:\s+[A-Z][\w']*){0,3})/;
const NAME_PARTICLES = new Set(['de', 'van', 'du', 'der', 'la', 'le', 'da']);
const NOT_A_NAME = new Set([
  'what', 'how', 'tell', 'show', 'give', 'is', 'does', 'who', 'which', 'career', 'record', 'stats', 'statistics',
  'odi', 't20', 'test', 'ipl', 'me', 'the', 'in', 'of', 'a', 'an', 'to', 'for', 'from', 'with', 'this', 'that',
  'there', 'many', 'much', 'his', 'her', 'their', 'has', 'have', 'had', 'was', 'were', 'are', 'been', 'icc',
  'men', 'mens', "men's", 'women', 'womens', "women's", 'world', 'cup', 'wc', 'asia', 'champions', 'trophy', 'ashes',
  'century', 'centuries', 'hundred', 'hundreds', 'fifty', 'fifties', 'runs', 'wicket', 'wickets', 'average', 'strike',
  'rate', 'match', 'matches', 'tournament', 'event', 'please', 'about', 'player', 'batting', 'bowling', 'economy',
  'win', 'won', 'winner', 'winning', 'lifted', 'champion', 'final', 'chance', 'probability', 'projected', 'project',
  'will', 'vs', 'versus', 'per', 'over', 'overs', 'need', 'needs', 'needed', 'score', 'scoring', 'make', 'get',
  'current', 'batter', 'batters', 'batsman', 'batsmen', 'performing', 'performance', 'wa', 'ql', 'team',
]);

const titleCase = (word: string) => {
  const lower = word.toLowerCase();
  if (NAME_PARTICLES.has(lower)) return lower;
  if (word.length <= 3 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

/** First 2+ word run that looks like a player name ("Virat Kohli" or lowercase "rohit sharma"). */
export function guessPlayerName(question: string): string | null {
  const tokens = question.split(/[\s,?!:;'"()]+/).filter(Boolean);
  const runs: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const particle = NAME_PARTICLES.has(lower);
    const nameLike = /^[A-Za-z][A-Za-z'.-]{0,24}$/.test(token) && !NOT_A_NAME.has(lower);
    if (nameLike || (particle && current.length > 0)) current.push(token);
    else {
      if (current.length) runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  const candidates = runs
    .map((run) => run.filter((w) => !NOT_A_NAME.has(w.toLowerCase())))
    .filter((run) => run.filter((w) => !NAME_PARTICLES.has(w.toLowerCase())).length >= 2)
    .sort((a, b) => b.length - a.length);
  return candidates[0] ? candidates[0].slice(0, 4).map(titleCase).join(' ') : null;
}

export function guessEvent(question: string): string | null {
  if (/t20\s*world\s*cup|world\s*t20/i.test(question)) return 'World Cup';
  if (/world\s*cup|\bwc\b/i.test(question)) return 'World Cup';
  if (/asia\s*cup/i.test(question)) return 'Asia Cup';
  if (/champions\s*trophy/i.test(question)) return 'Champions Trophy';
  if (/\bashes\b/i.test(question)) return 'The Ashes';
  if (/\bipl\b/i.test(question)) return 'Indian Premier League';
  return null;
}

export function guessFormat(question: string): 'T20' | 'ODI' | 'Test' | null {
  if (/\btests?\b|ashes/i.test(question)) return 'Test';
  if (/\bt20\s*world\s*cup|world\s*t20|t20i|\bt20\b|ipl/i.test(question)) return 'T20';
  // Bare "WC" / "world cup" without T20 → treat as ODI World Cup in demo routing.
  if (/\bodi\b|one[\s-]?day|world\s*cup|\bwc\b|asia\s*cup|champions\s*trophy/i.test(question)) return 'ODI';
  return null;
}

export function guessYear(question: string): number | null {
  const match = /\b(19|20)\d{2}\b/.exec(question);
  if (!match) return null;
  const year = Number(match[0]);
  return year >= 1877 && year <= 2100 ? year : null;
}

export function guessGender(question: string): 'male' | 'female' | null {
  if (/women'?s|female|\bwomen\b/i.test(question)) return 'female';
  if (/men'?s|\bmale\b|\bmen\b/i.test(question)) return 'male';
  return null;
}

function wantsLiveRequiredRate(question: string): boolean {
  return REQUIRED_RATE_LIVE.test(question);
}

function wantsPlayerHistory(question: string): boolean {
  if (wantsLiveRequiredRate(question)) return false;
  const name = guessPlayerName(question);
  if (!name) return false;
  return PLAYER_HISTORY_WORDS.test(question) || EVENT_WORDS.test(question) || /centur|hundred|\b100\b|wickets?/i.test(question);
}

function wantsEventResults(question: string): boolean {
  return EVENT_WINNER_WORDS.test(question) && !!guessEvent(question) && !EVENT_LEADER_RUNS.test(question) && !EVENT_LEADER_WICKETS.test(question);
}

function wantsEventLeaders(
  question: string,
): 'batting' | 'bowling' | 'runs_conceded' | 'sixes' | 'fours' | 'hundreds' | null {
  if (!guessEvent(question) && !EVENT_WORDS.test(question)) return null;
  if (EVENT_LEADER_HUNDREDS.test(question)) return 'hundreds';
  if (EVENT_LEADER_CONCEDED.test(question)) return 'runs_conceded';
  if (EVENT_LEADER_SIXES.test(question)) return 'sixes';
  if (EVENT_LEADER_FOURS.test(question)) return 'fours';
  if (EVENT_LEADER_WICKETS.test(question)) return 'bowling';
  if (EVENT_LEADER_RUNS.test(question)) return 'batting';
  return null;
}

function wantsEventStandings(question: string): boolean {
  return EVENT_STANDINGS_WORDS.test(question) && (!!guessEvent(question) || EVENT_WORDS.test(question));
}

function iplArgs(question: string): Record<string, unknown> {
  const event = guessEvent(question) ?? 'Indian Premier League';
  const args: Record<string, unknown> = { event };
  const year = guessYear(question);
  const format = guessFormat(question) ?? (/indian premier league|\bipl\b/i.test(event) ? 'T20' : null);
  const gender = guessGender(question);
  if (year) args.year = year;
  if (format) args.format = format;
  if (gender) args.gender = gender;
  return args;
}

function guessNextOvers(question: string): number | null {
  const m = /(?:next|coming)?\s*(\d{1,2})\s*overs?|अगले\s*(\d{1,2})\s*ओवर/i.exec(question);
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return n >= 1 && n <= 20 ? n : null;
}

function wantsBowlingStats(question: string): boolean {
  return /wickets?|bowling|economy|spell|विकेट|गेंदबाज/i.test(question);
}

function wantsHundredStats(question: string): boolean {
  return /centur(?:y|ies)|hundreds?|\b100s?\b|शतक/i.test(question);
}

type Lang = 'en' | 'hi';

interface Parsed {
  question: string;
  matchId: string | null;
  lang: Lang;
  toolMessages: Array<{ name: string; data: Record<string, unknown> }>;
}

function parse(messages: LlmMessage[]): Parsed {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content as string).join('\n');
  const user = [...messages].reverse().find((m) => m.role === 'user');
  const matchId = /viewing match (\d{1,10})/.exec(system)?.[1] ?? null;
  const toolMessages = messages
    .filter((m): m is Extract<LlmMessage, { role: 'tool' }> => m.role === 'tool')
    .map((m) => {
      try {
        return { name: m.name, data: JSON.parse(m.content) as Record<string, unknown> };
      } catch {
        return { name: m.name, data: { error: 'unreadable' } };
      }
    });
  return {
    question: (user?.content as string) ?? '',
    matchId,
    lang: /Reply language: Hindi/.test(system) ? 'hi' : 'en',
    toolMessages,
  };
}

function planHistory(p: Parsed, available: Set<string>): LlmToolCall[] {
  const call = (name: string, args: Record<string, unknown>): LlmToolCall[] =>
    available.has(name) ? [{ id: 'mock_1', name, arguments: JSON.stringify(args) }] : [];
  const leaderKind = wantsEventLeaders(p.question);
  if (leaderKind) {
    return call('get_event_leaders', { ...iplArgs(p.question), kind: leaderKind });
  }
  if (EVENT_AWARDS_WORDS.test(p.question) && available.has('get_event_awards') && (guessEvent(p.question) || EVENT_WORDS.test(p.question))) {
    return call('get_event_awards', iplArgs(p.question));
  }
  if (EVENT_PHASE_WORDS.test(p.question) && available.has('get_event_phase_stats') && (guessEvent(p.question) || EVENT_WORDS.test(p.question))) {
    const q = p.question;
    const phase = /death/i.test(q) ? 'death' : /powerplay/i.test(q) ? 'powerplay' : /middle/i.test(q) ? 'middle' : 'all';
    const resultFilter = /matches?\s+won|while\s+winning|in\s+wins/i.test(q)
      ? 'won'
      : /matches?\s+lost|while\s+losing|in\s+losses/i.test(q)
        ? 'lost'
        : 'all';
    const stage = /playoffs?|knockout|final|qualifier|eliminator/i.test(q) ? 'playoffs' : 'all';
    const subject = /batter|batsman|bowler|player/i.test(q) && !/which\s+team/i.test(q) ? 'batter' : 'team';
    return call('get_event_phase_stats', { ...iplArgs(q), phase, resultFilter, stage, subject });
  }
  if (EVENT_EXTREMES_WORDS.test(p.question) && available.has('get_event_extremes') && (guessEvent(p.question) || EVENT_WORDS.test(p.question))) {
    return call('get_event_extremes', iplArgs(p.question));
  }
  if (EVENT_MATCH_WORDS.test(p.question) && available.has('get_event_team_matches')) {
    const teams = TEAMS_VS.exec(p.question);
    const against = /([A-Z][\w']*(?:\s+[A-Z][\w']*){0,4})\s+(?:against|vs\.?|versus)\s+([A-Z][\w']*(?:\s+[A-Z][\w']*){0,4})/i.exec(
      p.question,
    );
    const pair = teams ?? against;
    if (pair) {
      const clean = (team: string) =>
        team.replace(/\s+(?:'s|IPL|in|match|the|of).*$/i, '').replace(/\s+'s$/i, '').trim();
      return call('get_event_team_matches', {
        ...iplArgs(p.question),
        team1: clean(pair[1]),
        team2: clean(pair[2]),
      });
    }
  }
  if (wantsEventStandings(p.question) && available.has('get_event_standings')) {
    return call('get_event_standings', iplArgs(p.question));
  }
  if (wantsEventResults(p.question)) {
    const event = guessEvent(p.question);
    if (event) {
      const args = iplArgs(p.question);
      if (/icc|men|odi|wc/i.test(p.question) && !args.gender && !/\bipl\b/i.test(p.question)) args.gender = 'male';
      return call('get_event_results', args);
    }
  }
  if (HEAD_TO_HEAD_WORDS.test(p.question)) {
    const teams = TEAMS_VS.exec(p.question);
    const clean = (team: string) => team.replace(/\s+(?:T20I?|ODI|Tests?|Head|H2H)$/i, '').trim();
    if (teams) return call('get_head_to_head', { team1: clean(teams[1]), team2: clean(teams[2]) });
    if (p.matchId) return call('get_head_to_head', { matchId: p.matchId });
  }
  if (VENUE_WORDS.test(p.question) && p.matchId) return call('get_venue_history', { matchId: p.matchId });
  if (wantsPlayerHistory(p.question)) {
    const name = guessPlayerName(p.question);
    if (name) {
      const args: Record<string, unknown> = { name };
      const format = guessFormat(p.question);
      const event = guessEvent(p.question);
      const gender = guessGender(p.question) ?? (event && /icc|men/i.test(p.question) ? 'male' : null);
      if (format) args.format = format;
      if (event) args.event = event;
      if (gender) args.gender = gender;
      return call('get_player_history', args);
    }
  }
  return [];
}

/**
 * Deterministic tool plan for a question. Used by the mock provider and as a safety net
 * when a real LLM returns no tool calls (common with Groq + many tools).
 * When `strict`, never falls back to get_live_matches — returns [] if nothing matches.
 */
export function planAskTools(
  question: string,
  matchId: string | null,
  available: Set<string>,
  opts: { strict?: boolean } = {},
): LlmToolCall[] {
  const p: Parsed = { question, matchId, lang: 'en', toolMessages: [] };
  const rate = rateQuestion(p.question);
  if (rate) {
    const unit = rate.unit.toLowerCase();
    const isBalls = unit.startsWith('ball') || unit.startsWith('गेंद');
    const args = isBalls
      ? { runsNeeded: rate.runs, ballsRemaining: Number(rate.amount) }
      : { runsNeeded: rate.runs, oversRemaining: rate.amount };
    return [{ id: 'mock_1', name: 'calculate_required_rate', arguments: JSON.stringify(args) }];
  }
  // Live chase RR ("how many runs per over does WA need?") before history name guessing.
  if (p.matchId && wantsLiveRequiredRate(p.question)) {
    return [{ id: 'mock_1', name: 'get_match', arguments: JSON.stringify({ matchId: p.matchId }) }];
  }
  // "Target kitna / de shakta" during 1st innings → projected total (not current score + 1).
  if (p.matchId && TARGET_WORDS.test(p.question) && available.has('project_score')) {
    return [{ id: 'mock_1', name: 'project_score', arguments: JSON.stringify({ matchId: p.matchId }) }];
  }
  if (p.matchId && TARGET_WORDS.test(p.question) && available.has('get_match')) {
    return [{ id: 'mock_1', name: 'get_match', arguments: JSON.stringify({ matchId: p.matchId }) }];
  }
  const history = planHistory(p, available);
  if (history.length > 0) return history;
  // Do not fall back to the live match for archive player / tournament questions.
  if (
    wantsPlayerHistory(p.question) ||
    wantsEventResults(p.question) ||
    wantsEventLeaders(p.question) ||
    wantsEventStandings(p.question)
  ) {
    return [];
  }
  // Toss before match-win (both phrases contain "win" / "jit").
  if (p.matchId && TOSS_WORDS.test(p.question) && available.has('get_toss_prediction')) {
    return [{ id: 'mock_1', name: 'get_toss_prediction', arguments: JSON.stringify({ matchId: p.matchId }) }];
  }
  if (p.matchId && available.has('get_win_probability') && WIN_PROB_WORDS.test(p.question) && !TOSS_WORDS.test(p.question)) {
    return [{ id: 'mock_1', name: 'get_win_probability', arguments: JSON.stringify({ matchId: p.matchId }) }];
  }
  const nextOvers = guessNextOvers(p.question);
  if (p.matchId && available.has('project_next_overs') && (NEXT_OVERS_WORDS.test(p.question) || nextOvers)) {
    return [
      {
        id: 'mock_1',
        name: 'project_next_overs',
        arguments: JSON.stringify({ matchId: p.matchId, overs: nextOvers ?? 6 }),
      },
    ];
  }
  if (p.matchId && available.has('project_score') && PROJECT_SCORE_WORDS.test(p.question)) {
    return [{ id: 'mock_1', name: 'project_score', arguments: JSON.stringify({ matchId: p.matchId }) }];
  }
  if (p.matchId) {
    if (opts.strict) {
      // Only force live match tools when the question clearly asks about this match.
      if (
        !SCORECARD_WORDS.test(p.question) &&
        !BATTER_WORDS.test(p.question) &&
        !COMMENTARY_WORDS.test(p.question) &&
        !/\b(score|this match|current|live)\b/i.test(p.question)
      ) {
        return [];
      }
    }
    const calls: LlmToolCall[] = [{ id: 'mock_1', name: 'get_match', arguments: JSON.stringify({ matchId: p.matchId }) }];
    if (SCORECARD_WORDS.test(p.question) || BATTER_WORDS.test(p.question)) {
      calls.push({ id: 'mock_2', name: 'get_scorecard', arguments: JSON.stringify({ matchId: p.matchId }) });
    }
    if (COMMENTARY_WORDS.test(p.question)) {
      calls.push({ id: 'mock_3', name: 'get_recent_commentary', arguments: JSON.stringify({ matchId: p.matchId, limit: 6 }) });
    }
    return calls;
  }
  if (opts.strict) return [];
  return [{ id: 'mock_1', name: 'get_live_matches', arguments: '{}' }];
}

function plan(p: Parsed, available: Set<string>): LlmToolCall[] {
  return planAskTools(p.question, p.matchId, available);
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function describeMatch(m: Record<string, unknown>, lang: Lang, focus: 'summary' | 'rate' | 'batters' = 'summary'): string {
  const teams = (m.teams as unknown[] | undefined)?.map(str).filter(Boolean) ?? [];
  const vs = teams.join(lang === 'hi' ? ' बनाम ' : ' vs ');
  const innings = (m.innings as Array<Record<string, unknown>> | undefined) ?? [];
  const scores = innings.map((i) => `${str(i.team)} ${str(i.score)} (${str(i.overs)})`).join(', ');
  const current = m.current as Record<string, unknown> | null;
  const batsmen = (m.batsmen as Array<Record<string, unknown>> | undefined) ?? [];
  const parts: string[] = [];
  const chaseActive = m.chaseActive === true || (current?.runsRequired != null && current?.requiredRunRate != null);
  if (focus === 'rate') {
    if (chaseActive && current?.runsRequired != null && current?.requiredRunRate != null) {
      parts.push(
        lang === 'hi'
          ? `${str(current.battingTeam)} को ${str(current.ballsRemaining)} गेंदों में ${str(current.runsRequired)} रन चाहिए — आवश्यक रन रेट ${str(current.requiredRunRate)} प्रति ओवर.`
          : `${str(current.battingTeam)} need ${str(current.runsRequired)} runs from ${str(current.ballsRemaining)} balls — required rate ${str(current.requiredRunRate)} runs per over.`,
      );
      return parts.join(' ');
    }
    parts.push(
      lang === 'hi'
        ? `अभी पहली पारी है — chase target / RRR नहीं है। स्कोर ${str(current?.battingTeam)} ${str(current?.score)}/${str(current?.wickets)} (${str(current?.overs)} ov).`
        : `Still first innings — no chase target/RRR yet. ${str(current?.battingTeam)} ${str(current?.score)}/${str(current?.wickets)} (${str(current?.overs)} ov).`,
    );
    return parts.join(' ');
  }
  if (focus === 'batters') {
    if (batsmen.length === 0) {
      parts.push(lang === 'hi' ? 'अभी क्रिज़ पर बल्लेबाजों का विवरण उपलब्ध नहीं है।' : 'No current batters are listed for this match right now.');
    } else {
      parts.push(lang === 'hi' ? 'क्रिज़ पर:' : 'At the crease:');
      for (const b of batsmen.slice(0, 2)) {
        parts.push(
          lang === 'hi'
            ? `${str(b.name)} ${str(b.runs)} (${str(b.balls)} गेंद, ${str(b.fours)} चौके, ${str(b.sixes)} छक्के).`
            : `${str(b.name)} ${str(b.runs)} (${str(b.balls)} balls, ${str(b.fours)} fours, ${str(b.sixes)} sixes).`,
        );
      }
    }
    if (scores) parts.push(lang === 'hi' ? `स्कोर: ${scores}.` : `Score: ${scores}.`);
    return parts.join(' ');
  }
  parts.push(`${vs}${m.statusDetail ? ` - ${str(m.statusDetail)}` : ''}.`);
  if (scores) parts.push(lang === 'hi' ? `स्कोर: ${scores}.` : `Score: ${scores}.`);
  if (chaseActive && current?.runsRequired != null && current.ballsRemaining) {
    parts.push(
      lang === 'hi'
        ? `${str(current.battingTeam)} को ${str(current.ballsRemaining)} गेंदों में ${str(current.runsRequired)} रन चाहिए (आवश्यक रन रेट ${str(current.requiredRunRate)}).`
        : `${str(current.battingTeam)} need ${str(current.runsRequired)} runs from ${str(current.ballsRemaining)} balls (required rate ${str(current.requiredRunRate)}).`,
    );
  } else if (m.note) {
    parts.push(`${str(m.note)}.`);
  }
  if (m.stale) parts.push(lang === 'hi' ? 'डेटा में देरी हो सकती है।' : 'Data may be delayed.');
  return parts.join(' ').replace(/\.\./g, '.');
}

const HISTORY_TOOLS = new Set([
  'get_player_history',
  'get_event_results',
  'get_event_leaders',
  'get_event_standings',
  'get_event_team_matches',
  'get_event_extremes',
  'get_event_awards',
  'get_event_phase_stats',
  'get_head_to_head',
  'get_venue_history',
  'get_team_phase_stats',
]);
const ARCHIVE_NOTE = {
  en: 'Source: Cricsheet archive (cricsheet.org) - not official career totals.',
  hi: 'स्रोत: Cricsheet संग्रह (cricsheet.org) - ये आधिकारिक करियर आंकड़े नहीं हैं।',
} as const;

function describeHistory(name: string, data: Record<string, unknown>, lang: Lang, question: string): string[] {
  const hi = lang === 'hi';
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
  if (candidates?.length) {
    const list = candidates.map((c) => str(c.name)).join(', ');
    return [hi ? `कई खिलाड़ी मिले: ${list}। आप किसके बारे में पूछ रहे हैं?` : `Several players match: ${list}. Which one do you mean?`];
  }
  if (data.found === false) return [hi ? 'यह संग्रह में नहीं मिला।' : `Not found in the archive. ${str(data.note)}`.trim()];
  const lines: string[] = [];
  if (name === 'get_player_history') {
    const battingByEvent =
      (data.battingByEvent as Array<Record<string, unknown>> | undefined) ??
      (data.byEvent as Array<Record<string, unknown>> | undefined) ??
      [];
    const bowlingByEvent = (data.bowlingByEvent as Array<Record<string, unknown>> | undefined) ?? [];
    if (data.event) {
      const bowlingFocus = wantsBowlingStats(question) && !wantsHundredStats(question);
      if (bowlingFocus) {
        if (bowlingByEvent.length === 0) {
          lines.push(
            hi
              ? `${str(data.player)} के लिए "${str(data.event)}" में गेंदबाजी आंकड़े संग्रह में नहीं मिले।`
              : `${str(data.player)}: no bowling figures in archive matches whose event contains "${str(data.event)}".`,
          );
        } else {
          const wickets = Number(data.wicketsInEvent ?? bowlingByEvent.reduce((s, r) => s + Number(r.wickets ?? 0), 0));
          lines.push(
            hi
              ? `${str(data.player)} के Cricsheet संग्रह में "${str(data.event)}" से मेल खाते मैचों में ${wickets} विकेट हैं।`
              : `${str(data.player)} has ${wickets} wicket(s) in Cricsheet archive matches whose event name contains "${str(data.event)}".`,
          );
          for (const row of bowlingByEvent.slice(0, 4)) {
            lines.push(
              hi
                ? `- ${str(row.event)} (${str(row.matchType)}): ${str(row.wickets)} विकेट, ${str(row.overs)} ओवर, इकॉनमी ${str(row.economy ?? '-')}, औसत ${str(row.average ?? '-')}.`
                : `- ${str(row.event)} (${str(row.matchType)}): ${str(row.wickets)} wickets, ${str(row.overs)} overs, economy ${str(row.economy ?? '-')}, average ${str(row.average ?? '-')}.`,
            );
          }
        }
      } else if (battingByEvent.length === 0) {
        lines.push(hi ? `${str(data.player)} के लिए "${str(data.event)}" से मेल खाते मैच संग्रह में नहीं मिले।` : `${str(data.player)}: no archive matches whose event contains "${str(data.event)}".`);
      } else {
        const hundreds = Number(data.hundredsInEvent ?? battingByEvent.reduce((s, r) => s + Number(r.hundreds ?? 0), 0));
        lines.push(
          hi
            ? `${str(data.player)} के Cricsheet संग्रह में "${str(data.event)}" से मेल खाते मैचों में कुल ${hundreds} शतक हैं।`
            : `${str(data.player)} has ${hundreds} hundred(s) in total in Cricsheet archive matches whose event name contains "${str(data.event)}".`,
        );
        for (const row of battingByEvent.slice(0, 4)) {
          lines.push(
            hi
              ? `- ${str(row.event)} (${str(row.matchType)}): ${str(row.hundreds)} शतक, ${str(row.runs)} रन, सर्वोच्च ${str(row.highest)} (${str(row.innings)} पारी).`
              : `- ${str(row.event)} (${str(row.matchType)}): ${str(row.hundreds)} hundreds, ${str(row.runs)} runs, highest ${str(row.highest)} (${str(row.innings)} innings).`,
          );
        }
      }
    } else {
      const batting = (data.batting as Array<Record<string, unknown>> | undefined) ?? [];
      const bowling = (data.bowling as Array<Record<string, unknown>> | undefined) ?? [];
      const bat =
        batting.find((b) => b.teamType === 'international' && (b.matchType === 'ODI' || b.matchType === 'IT20' || b.matchType === 'Test')) ?? batting[0];
      const bowl =
        bowling.find((b) => b.teamType === 'international' && (b.matchType === 'ODI' || b.matchType === 'IT20' || b.matchType === 'Test')) ?? bowling[0];
      if (wantsBowlingStats(question) && !wantsHundredStats(question)) {
        if (bowl && Number(bowl.wickets) > 0) {
          lines.push(
            hi
              ? `${str(data.player)} गेंदबाजी (${str(bowl.matchType)}, ${str(bowl.teamType)}): ${str(bowl.wickets)} विकेट, इकॉनमी ${str(bowl.economy)}, सर्वश्रेष्ठ ${str(bowl.best)}.`
              : `${str(data.player)} bowling (${str(bowl.matchType)}, ${str(bowl.teamType)}): ${str(bowl.wickets)} wickets, economy ${str(bowl.economy)}, best ${str(bowl.best)}.`,
          );
        } else {
          lines.push(hi ? `${str(data.player)} के गेंदबाजी आंकड़े संग्रह में नहीं मिले।` : `No bowling figures found in the archive for ${str(data.player)}.`);
        }
      } else {
        if (bat) {
          lines.push(
            hi
              ? `${str(data.player)} (${str(bat.matchType)}, ${str(bat.teamType)}): ${str(bat.innings)} पारियों में ${str(bat.runs)} रन, ${str(bat.hundreds)} शतक, औसत ${str(bat.average ?? '-')}, सर्वोच्च ${str(bat.highest)}.`
              : `${str(data.player)} (${str(bat.matchType)}, ${str(bat.teamType)}): ${str(bat.runs)} runs in ${str(bat.innings)} innings, ${str(bat.hundreds)} hundreds, average ${str(bat.average ?? '-')}, highest ${str(bat.highest)}.`,
          );
        }
        if (bowl && Number(bowl.wickets) > 0) {
          lines.push(
            hi
              ? `गेंदबाजी (${str(bowl.matchType)}): ${str(bowl.wickets)} विकेट, इकॉनमी ${str(bowl.economy)}, सर्वश्रेष्ठ ${str(bowl.best)}.`
              : `Bowling (${str(bowl.matchType)}): ${str(bowl.wickets)} wickets, economy ${str(bowl.economy)}, best ${str(bowl.best)}.`,
          );
        }
      }
    }
  } else if (name === 'get_head_to_head') {
    const [a, b] = ((data.teams as unknown[]) ?? []).map(str);
    const rows = (data.results as Array<Record<string, unknown>> | undefined) ?? [];
    if (rows.length === 0) lines.push(hi ? `${a} और ${b} का संग्रह में कोई मुकाबला नहीं मिला।` : `No ${a} v ${b} matches in the archive.`);
    for (const r of rows.slice(0, 2)) {
      lines.push(
        hi
          ? `${a} बनाम ${b} (${str(r.matchType)}): ${str(r.matches)} मैच, ${a} ${str(r[`${a} wins`])} जीते, ${b} ${str(r[`${b} wins`])} जीते.`
          : `${a} v ${b} (${str(r.matchType)}): ${str(r.matches)} matches, ${a} won ${str(r[`${a} wins`])}, ${b} won ${str(r[`${b} wins`])}.`,
      );
    }
  } else if (name === 'get_venue_history') {
    for (const r of ((data.formats as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 2)) {
      lines.push(
        hi
          ? `${str(data.venue)} (${str(r.matchType)}): ${str(r.matches)} मैच, पहली पारी का औसत स्कोर ${str(r.averageFirstInningsScore ?? '-')}; पहले बल्लेबाजी करके ${str(r.batFirstWins)} और लक्ष्य का पीछा करके ${str(r.chasingWins)} जीत.`
          : `${str(data.venue)} (${str(r.matchType)}): ${str(r.matches)} matches, average first-innings score ${str(r.averageFirstInningsScore ?? '-')}; batting first won ${str(r.batFirstWins)}, chasing won ${str(r.chasingWins)}.`,
      );
    }
  } else if (name === 'get_team_phase_stats') {
    for (const r of ((data.phases as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 3)) {
      lines.push(
        hi
          ? `${str(data.team)} ${str(r.phase)}: रन रेट ${str(r.runRate)}, प्रति पारी ${str(r.wicketsPerInnings)} विकेट.`
          : `${str(data.team)} ${str(r.phase)}: run rate ${str(r.runRate)}, ${str(r.wicketsPerInnings)} wickets per innings.`,
      );
    }
  } else if (name === 'get_event_leaders') {
    const top = data.top as Record<string, unknown> | undefined;
    if (!top) {
      lines.push(
        hi
          ? `"${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''} के लिए लीडरबोर्ड नहीं मिला (सीजन संग्रह में अधूरा हो सकता है)।`
          : `No leaders found for "${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''} (season may not be finished in the archive).`,
      );
    } else if (data.kind === 'bowling') {
      lines.push(
        hi
          ? `Cricsheet संग्रह के अनुसार ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} में सबसे अधिक विकेट: ${str(top.player)} — ${str(top.wickets)} विकेट (${str(top.matches)} मैच).`
          : `In the Cricsheet archive, most wickets in ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}: ${str(top.player)} — ${str(top.wickets)} wickets (${str(top.matches)} matches).`,
      );
    } else if (data.kind === 'runs_conceded') {
      lines.push(
        hi
          ? `Cricsheet संग्रह: ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} में सबसे अधिक रन दिए: ${str(top.player)} — ${str(top.runsConceded)} रन.`
          : `In the Cricsheet archive, most runs conceded in ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}: ${str(top.player)} — ${str(top.runsConceded)} runs.`,
      );
    } else if (data.kind === 'sixes') {
      lines.push(
        hi
          ? `Cricsheet संग्रह: ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} में सबसे अधिक छक्के: ${str(top.player)} — ${str(top.sixes)}.`
          : `In the Cricsheet archive, most sixes in ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}: ${str(top.player)} — ${str(top.sixes)}.`,
      );
    } else if (data.kind === 'hundreds') {
      lines.push(
        hi
          ? `Cricsheet संग्रह: ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} में सबसे अधिक शतक: ${str(top.player)} — ${str(top.hundreds)} शतक (${str(top.runs)} रन).`
          : `In the Cricsheet archive, most hundreds in ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}: ${str(top.player)} — ${str(top.hundreds)} hundreds (${str(top.runs)} runs).`,
      );
    } else {
      lines.push(
        hi
          ? `Cricsheet संग्रह के अनुसार ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} में सबसे अधिक रन: ${str(top.player)} — ${str(top.runs)} रन (${str(top.matches)} मैच, सर्वोच्च ${str(top.highest)}).`
          : `In the Cricsheet archive, most runs in ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}: ${str(top.player)} — ${str(top.runs)} runs (${str(top.matches)} matches, highest ${str(top.highest)}).`,
      );
    }
    for (const row of ((data.leaders as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 5)) {
      if (data.kind === 'bowling') lines.push(`- ${str(row.rank)}. ${str(row.player)}: ${str(row.wickets)} wickets`);
      else if (data.kind === 'runs_conceded') lines.push(`- ${str(row.rank)}. ${str(row.player)}: ${str(row.runsConceded)} conceded`);
      else if (data.kind === 'sixes') lines.push(`- ${str(row.rank)}. ${str(row.player)}: ${str(row.sixes)} sixes`);
      else if (data.kind === 'fours') lines.push(`- ${str(row.rank)}. ${str(row.player)}: ${str(row.fours)} fours`);
      else if (data.kind === 'hundreds') lines.push(`- ${str(row.rank)}. ${str(row.player)}: ${str(row.hundreds)} hundreds`);
      else lines.push(`- ${str(row.rank)}. ${str(row.player)}: ${str(row.runs)} runs`);
    }
  } else if (name === 'get_event_team_matches') {
    const matches = (data.matches as Array<Record<string, unknown>> | undefined) ?? [];
    if (matches.length === 0) {
      lines.push(
        hi
          ? `${str(data.team1)} बनाम ${str(data.team2)} के लिए ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} में मैच नहीं मिले।`
          : `No archive matches for ${str(data.team1)} vs ${str(data.team2)} in ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}.`,
      );
    } else {
      lines.push(
        hi
          ? `Cricsheet संग्रह: ${str(data.team1)} बनाम ${str(data.team2)} (${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}):`
          : `Cricsheet archive: ${str(data.team1)} vs ${str(data.team2)} (${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}):`,
      );
      for (const m of matches.slice(0, 5)) {
        const inns = ((m.innings as Array<Record<string, unknown>> | undefined) ?? [])
          .map((i) => `${str(i.team)} ${str(i.score)}`)
          .join(', ');
        const margin =
          m.winByRuns != null ? `by ${str(m.winByRuns)} runs` : m.winByWickets != null ? `by ${str(m.winByWickets)} wickets` : '';
        lines.push(`- ${str(m.date)}: ${inns || (m.teams as string[] | undefined)?.join(' vs ')}; winner ${str(m.winner)}${margin ? ` ${margin}` : ''}.`);
      }
    }
  } else if (name === 'get_event_extremes') {
    const high = (data.highestTotals as Array<Record<string, unknown>> | undefined) ?? [];
    if (high.length === 0) {
      lines.push(
        hi
          ? `"${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''} के लिए एक्सट्रीम नहीं मिले।`
          : `No extremes in the archive for "${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''}.`,
      );
    } else {
      const top = high[0];
      lines.push(
        hi
          ? `Cricsheet: ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} में सर्वोच्च टीम स्कोर ${str(top.team)} ${str(top.score)}.`
          : `Cricsheet archive: highest team total in ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''}: ${str(top.team)} ${str(top.score)}.`,
      );
      const low = (data.lowestAllOutTotals as Array<Record<string, unknown>> | undefined)?.[0];
      if (low) lines.push(hi ? `सबसे कम ऑल-आउट: ${str(low.team)} ${str(low.score)}.` : `Lowest all-out: ${str(low.team)} ${str(low.score)}.`);
      const win = (data.biggestWins as Array<Record<string, unknown>> | undefined)?.[0];
      if (win) {
        const margin =
          win.winByRuns != null ? `${str(win.winByRuns)} runs` : win.winByWickets != null ? `${str(win.winByWickets)} wickets` : '';
        lines.push(hi ? `बड़ी जीत: ${str(win.winner)} (${margin}).` : `Biggest win: ${str(win.winner)} (${margin}).`);
      }
    }
  } else if (name === 'get_event_standings') {
    const rows = (data.standings as Array<Record<string, unknown>> | undefined) ?? [];
    if (rows.length === 0) {
      lines.push(
        hi
          ? `"${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''} के लिए स्टैंडिंग नहीं मिली।`
          : `No standings in the archive for "${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''}.`,
      );
    } else {
      lines.push(
        hi
          ? `Cricsheet संग्रह स्टैंडिंग ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} (2 अंक जीत + NRR):`
          : `Cricsheet archive standings for ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} (2 pts/win + NRR):`,
      );
      for (const row of rows.slice(0, 8)) {
        lines.push(
          `- ${str(row.team)}: ${str(row.played)} played, ${str(row.won)} won, ${str(row.points)} pts, NRR ${str(row.nrr ?? '-')}`,
        );
      }
      if (data.note) lines.push(str(data.note));
    }
  } else if (name === 'get_event_awards') {
    const top = data.top as Record<string, unknown> | undefined;
    if (!top) {
      lines.push(
        hi
          ? `Player of the Match अवॉर्ड नहीं मिले।`
          : `No Player of the Match awards found in the archive.`,
      );
    } else {
      lines.push(
        hi
          ? `Cricsheet: सबसे अधिक Player of the Match — ${str(top.player)} (${str(top.playerOfMatchAwards)}). आधिकारिक Player of the Tournament संग्रह में नहीं है; यह निकटतम अनुमान है।`
          : `Cricsheet archive: most Player of the Match awards — ${str(top.player)} (${str(top.playerOfMatchAwards)}). Official Player of the Tournament is not stored; this is the closest proxy.`,
      );
      for (const row of ((data.leaders as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 5)) {
        lines.push(`- ${str(row.rank)}. ${str(row.player)}: ${str(row.playerOfMatchAwards)}`);
      }
    }
  } else if (name === 'get_event_phase_stats') {
    const top = data.top as Record<string, unknown> | undefined;
    if (!top) {
      lines.push(
        hi
          ? `इस फिल्टर के लिए फेज़ आंकड़े नहीं मिले।`
          : `No phase figures for this filter in the archive.`,
      );
    } else if (data.subject === 'batter') {
      lines.push(
        hi
          ? `Cricsheet ${str(data.phase)}: ${str(top.player)} — ${str(top.runs)} रन (SR ${str(top.strikeRate)}).`
          : `Cricsheet ${str(data.phase)}: ${str(top.player)} — ${str(top.runs)} runs (SR ${str(top.strikeRate)}).`,
      );
    } else {
      lines.push(
        hi
          ? `Cricsheet ${str(top.phase ?? data.phase)}: ${str(top.team)} — रन रेट ${str(top.runRate)}.`
          : `Cricsheet ${str(top.phase ?? data.phase)}: ${str(top.team)} — run rate ${str(top.runRate)}.`,
      );
    }
    if (data.note) lines.push(str(data.note));
  } else if (name === 'get_event_results') {
    if (!data.tournamentWinner && !data.final) {
      lines.push(
        hi
          ? `"${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''} के लिए संग्रह में परिणाम नहीं मिले — सीजन अभी अधूरा हो सकता है।`
          : `No archive results for "${str(data.event)}"${data.year ? ` ${str(data.year)}` : ''} — the season may not be finished in the archive yet.`,
      );
    } else {
      const final = data.final as Record<string, unknown> | undefined;
      const winner = str(data.tournamentWinner);
      lines.push(
        hi
          ? `Cricsheet संग्रह के अनुसार ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} का विजेता: ${winner || 'अज्ञात'}.`
          : `In the Cricsheet archive, ${str(data.event)}${data.year ? ` ${str(data.year)}` : ''} winner: ${winner || 'unknown'}.`,
      );
      if (final) {
        const margin =
          final.winByRuns != null
            ? hi
              ? `${str(final.winByRuns)} रनों से`
              : `by ${str(final.winByRuns)} runs`
            : final.winByWickets != null
              ? hi
                ? `${str(final.winByWickets)} विकेट से`
                : `by ${str(final.winByWickets)} wickets`
              : final.eliminator
                ? hi
                  ? `एलिमिनेटर: ${str(final.eliminator)}`
                  : `eliminator ${str(final.eliminator)}`
                : '';
        lines.push(
          hi
            ? `${str(final.matchNumber) || 'हाइलाइट'}: ${(final.teams as string[] | undefined)?.join(' बनाम ') ?? ''} (${str(final.date)})${margin ? `, ${margin}` : ''}.`
            : `${str(final.matchNumber) || 'Highlight'}: ${(final.teams as string[] | undefined)?.join(' vs ') ?? ''} (${str(final.date)})${margin ? `, ${margin}` : ''}.`,
        );
      }
      if (data.note) lines.push(str(data.note));
    }
  }
  return lines;
}

/** Build a plain answer from tool results (mock templates). Used when a real LLM returns empty. */
export function composeAskAnswer(messages: LlmMessage[], language: 'en' | 'hi' = 'en'): string {
  const parsed = parse(messages);
  parsed.lang = language;
  const content = compose(parsed);
  // Strip the demo note when used as a real-provider safety net.
  return content
    .replace(/\n?\(Demo answer built from app data without an AI model\.\)\s*$/i, '')
    .replace(/\n?\(डेमो उत्तर: बिना AI मॉडल के ऐप डेटा से बनाया गया।\)\s*$/i, '')
    .trim();
}

function compose(p: Parsed): string {
  const { lang } = p;
  const lines: string[] = [];
  let usedHistory = false;
  for (const { name, data } of p.toolMessages) {
    if (data.error) {
      lines.push(lang === 'hi' ? `यह जानकारी अभी उपलब्ध नहीं है (${str(data.error)}).` : `That information is not available right now (${str(data.error)}).`);
      continue;
    }
    if (name === 'calculate_required_rate') {
      lines.push(
        lang === 'hi'
          ? `${str(data.ballsRemaining)} गेंदों (${str(data.oversRemaining)} ओवर) में ${str(data.runsNeeded)} रन के लिए ${str(data.requiredRunRate)} रन प्रति ओवर (${str(data.runsPerBall)} प्रति गेंद) चाहिए। यह केवल गणना है, जीत की संभावना नहीं।`
          : `${str(data.runsNeeded)} runs from ${str(data.ballsRemaining)} balls (${str(data.oversRemaining)} overs) needs ${str(data.requiredRunRate)} runs per over (${str(data.runsPerBall)} per ball). This is arithmetic only, not a win probability.`,
      );
    } else if (name === 'get_win_probability') {
      const teams = (data.teams as Array<Record<string, unknown>> | undefined) ?? [];
      if (!data.available || (teams.length === 0 && !data.favouriteTeam)) {
        lines.push(lang === 'hi' ? 'जीत संभावना अभी उपलब्ध नहीं है।' : 'Win chance not available yet.');
      } else if (teams.length > 0) {
        const parts = teams.map((t) => `${str(t.team)} ${str(t.probabilityPercent)}%`);
        lines.push(
          lang === 'hi' ? `अनुमानित जीत संभावना: ${parts.join(', ')}.` : `Estimated win chance: ${parts.join(', ')}.`,
        );
      } else if (data.favouriteTeam) {
        lines.push(lang === 'hi' ? `फेवरेट: ${str(data.favouriteTeam)}.` : `Favourite: ${str(data.favouriteTeam)}.`);
      }
    } else if (name === 'get_toss_prediction') {
      if (data.tossComplete && data.tossWinner) {
        lines.push(
          lang === 'hi'
            ? `टॉस: ${str(data.tossWinner)} जीता${data.tossDecision ? ` (${str(data.tossDecision)})` : ''}.`
            : `Toss: ${str(data.tossWinner)} won${data.tossDecision ? ` (${str(data.tossDecision)})` : ''}.`,
        );
      } else if (!data.available) {
        lines.push(lang === 'hi' ? 'टॉस अनुमान उपलब्ध नहीं — सिक्का किसी का भी हो सकता है।' : 'No toss outlook — coin toss could go either way.');
      } else {
        lines.push(
          lang === 'hi'
            ? `टॉस बाकी है। पुराने फॉर्म से रुझान: ${str(data.lean ?? 'साफ नहीं')}. गारंटी नहीं।`
            : `Toss pending. Historical lean: ${str(data.lean ?? 'unclear')}. Not a guarantee.`,
        );
      }
    } else if (name === 'project_score') {
      if (!data.available) {
        lines.push(lang === 'hi' ? 'अनुमानित स्कोर नहीं मिल सका।' : 'Could not project a score.');
      } else if (data.chaseActive) {
        lines.push(
          lang === 'hi'
            ? `Target ${str(data.target)}. अभी ${str(data.currentScore)}, RR ${str(data.runRate)}.`
            : `Target ${str(data.target)}. Now ${str(data.currentScore)} at RR ${str(data.runRate)}.`,
        );
      } else if (TARGET_WORDS.test(p.question)) {
        const estTarget = data.estimatedChaseTargetIfFinishNearProjection ?? data.projectedScore;
        lines.push(
          lang === 'hi'
            ? `अनुमानित target लगभग ${str(estTarget)} (अभी ${str(data.currentScore)}/${str(data.wickets ?? '-')}, RR ${str(data.runRate)}). केवल अनुमान।`
            : `Estimated target about ${str(estTarget)} (now ${str(data.currentScore)}/${str(data.wickets ?? '-')}, RR ${str(data.runRate)}). Estimate only.`,
        );
      } else {
        lines.push(
          lang === 'hi'
            ? `अनुमानित स्कोर लगभग ${str(data.projectedScore)} (अभी ${str(data.currentScore)}/${str(data.wickets ?? '-')}, RR ${str(data.runRate)}).`
            : `Projected score about ${str(data.projectedScore)} (now ${str(data.currentScore)}/${str(data.wickets ?? '-')}, RR ${str(data.runRate)}).`,
        );
      }
    } else if (name === 'project_next_overs') {
      if (!data.available) {
        lines.push(lang === 'hi' ? 'अगले ओवरों का अनुमान नहीं बन सका।' : 'Could not estimate the next overs.');
      } else {
        lines.push(
          lang === 'hi'
            ? `अगले ${str(data.oversAhead)} ओवर में लगभग ${str(data.rangeText)} रन (मध्य ${str(data.estimatedRunsMid)}).`
            : `About ${str(data.rangeText)} runs in the next ${str(data.oversAhead)} overs (mid ${str(data.estimatedRunsMid)}).`,
        );
      }
    } else if (name === 'get_live_matches') {
      const matches = (data.matches as Array<Record<string, unknown>> | undefined) ?? [];
      if (matches.length === 0) lines.push(lang === 'hi' ? 'अभी कोई मैच लाइव नहीं है।' : 'No matches are live right now.');
      else {
        lines.push(lang === 'hi' ? `अभी ${matches.length} मैच लाइव हैं:` : `${matches.length} match(es) live now:`);
        for (const m of matches.slice(0, 5)) lines.push(`- ${describeMatch(m, lang)}`);
      }
    } else if (name === 'get_match') {
      const focus = wantsLiveRequiredRate(p.question) ? 'rate' : BATTER_WORDS.test(p.question) ? 'batters' : 'summary';
      lines.push(describeMatch(data, lang, focus));
    } else if (name === 'get_scorecard') {
      if (BATTER_WORDS.test(p.question)) {
        // Prefer not-out batters from the latest innings for "current batter" questions.
        const innings = (data.innings as Array<Record<string, unknown>> | undefined) ?? [];
        const last = innings[innings.length - 1];
        const batting = ((last?.batting as Array<Record<string, unknown>>) ?? []).filter((b) => !b.out);
        if (batting.length > 0) {
          lines.push(lang === 'hi' ? `${str(last.team)} के मौजूदा बल्लेबाज:` : `Current ${str(last.team)} batters:`);
          for (const b of batting.slice(0, 2)) {
            lines.push(
              lang === 'hi'
                ? `- ${str(b.name)}: ${str(b.runs)} (${str(b.balls)} गेंद).`
                : `- ${str(b.name)}: ${str(b.runs)} (${str(b.balls)} balls).`,
            );
          }
        }
      } else {
        for (const inn of (data.innings as Array<Record<string, unknown>> | undefined) ?? []) {
          const batting = ((inn.batting as Array<Record<string, unknown>>) ?? []).slice().sort((a, b) => Number(b.runs) - Number(a.runs));
          const top = batting[0];
          if (top) {
            lines.push(
              lang === 'hi'
                ? `${str(inn.team)} (${str(inn.score)}): सर्वाधिक रन ${str(top.name)} ${str(top.runs)} (${str(top.balls)} गेंद).`
                : `${str(inn.team)} (${str(inn.score)}): top scorer ${str(top.name)} ${str(top.runs)} (${str(top.balls)} balls).`,
            );
          }
        }
      }
    } else if (name === 'get_recent_commentary') {
      const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
      if (items.length > 0) {
        lines.push(lang === 'hi' ? 'हाल की गेंदें:' : 'Recent balls:');
        for (const item of items.slice(0, 6)) lines.push(`- ${str(item.over)}: ${str(item.text)}`);
      }
    } else if (HISTORY_TOOLS.has(name)) {
      usedHistory = true;
      lines.push(...describeHistory(name, data, lang, p.question));
    }
  }
  if (usedHistory) lines.push(ARCHIVE_NOTE[lang]);
  if (lines.length === 0) {
    if (wantsPlayerHistory(p.question) || wantsEventResults(p.question)) {
      lines.push(
        lang === 'hi'
          ? 'ऐतिहासिक आंकड़ों के लिए AI_HISTORY_ENABLED=true चाहिए और Cricsheet डेटा आयात होना चाहिए।'
          : 'Archive answers need AI_HISTORY_ENABLED=true and imported Cricsheet history in the API database.',
      );
    } else {
      lines.push(lang === 'hi' ? 'मुझे इसका उत्तर देने के लिए डेटा नहीं मिला।' : 'I could not find data to answer that.');
    }
  }
  lines.push(MOCK_NOTE[lang]);
  return lines.join('\n');
}

/** Deterministic provider for development and a ₹0 budget: picks tools by keywords, answers from templates. */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';
  readonly mocked = true;

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const parsed = parse(request.messages);
    const promptTokens = estimateTokens(JSON.stringify(request.messages));
    const available = new Set(request.tools.map((t) => t.name));
    if (parsed.toolMessages.length === 0 && available.size > 0) {
      const toolCalls = plan(parsed, available).filter((call) => available.has(call.name));
      if (toolCalls.length > 0) {
        return { content: null, toolCalls, usage: { promptTokens, completionTokens: estimateTokens(JSON.stringify(toolCalls)) } };
      }
    }
    const content = compose(parsed);
    return { content, toolCalls: [], usage: { promptTokens, completionTokens: estimateTokens(content) } };
  }
}
