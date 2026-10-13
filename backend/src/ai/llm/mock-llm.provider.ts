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
const COMMENTARY_WORDS = /last (?:over|ball)|recent|commentary|just happened|कमेंट्री|पिछल|आखिरी/i;
const HEAD_TO_HEAD_WORDS = /head[\s-]?to[\s-]?head|h2h|record (?:against|vs)|आमने[\s-]?सामने/i;
const VENUE_WORDS = /venue|ground|stadium|pitch|मैदान|पिच|स्टेडियम/i;
const PLAYER_HISTORY_WORDS = /career|record|stats|statistics|average|strike rate|करियर|रिकॉर्ड|आंकड़े|औसत/i;
const TEAMS_VS = /([A-Z][\w']*(?:\s+[A-Z][\w']*){0,3})\s+(?:vs\.?|v|versus|बनाम)\s+([A-Z][\w']*(?:\s+[A-Z][\w']*){0,3})/;
const NOT_A_NAME = new Set(['what', 'how', 'tell', 'show', 'give', 'is', 'does', 'who', 'which', 'career', 'record', 'stats', 'odi', 't20', 'test', 'ipl', 'me', 'the', 'in', 'of']);

/** First run of capitalised words that looks like a player name ("Virat Kohli"). */
export function guessPlayerName(question: string): string | null {
  const runs: string[][] = [];
  let current: string[] = [];
  for (const token of question.split(/[\s,?!:;]+/)) {
    if (/^[A-Z][a-zA-Z'.-]+$/.test(token) || (current.length > 0 && /^(de|van|du|der)$/.test(token))) current.push(token);
    else {
      if (current.length) runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  for (const run of runs) {
    const words = run.filter((w) => !NOT_A_NAME.has(w.toLowerCase()));
    if (words.length >= 2) return words.slice(0, 4).join(' ');
  }
  return null;
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
  if (HEAD_TO_HEAD_WORDS.test(p.question)) {
    const teams = TEAMS_VS.exec(p.question);
    const clean = (team: string) => team.replace(/\s+(?:T20I?|ODI|Tests?|Head|H2H)$/i, '').trim();
    if (teams) return call('get_head_to_head', { team1: clean(teams[1]), team2: clean(teams[2]) });
    if (p.matchId) return call('get_head_to_head', { matchId: p.matchId });
  }
  if (VENUE_WORDS.test(p.question) && p.matchId) return call('get_venue_history', { matchId: p.matchId });
  if (PLAYER_HISTORY_WORDS.test(p.question)) {
    const name = guessPlayerName(p.question);
    if (name) return call('get_player_history', { name });
  }
  return [];
}

function plan(p: Parsed, available: Set<string>): LlmToolCall[] {
  const rate = rateQuestion(p.question);
  if (rate) {
    const unit = rate.unit.toLowerCase();
    const isBalls = unit.startsWith('ball') || unit.startsWith('गेंद');
    const args = isBalls
      ? { runsNeeded: rate.runs, ballsRemaining: Number(rate.amount) }
      : { runsNeeded: rate.runs, oversRemaining: rate.amount };
    return [{ id: 'mock_1', name: 'calculate_required_rate', arguments: JSON.stringify(args) }];
  }
  const history = planHistory(p, available);
  if (history.length > 0) return history;
  if (p.matchId) {
    const calls: LlmToolCall[] = [{ id: 'mock_1', name: 'get_match', arguments: JSON.stringify({ matchId: p.matchId }) }];
    if (SCORECARD_WORDS.test(p.question)) {
      calls.push({ id: 'mock_2', name: 'get_scorecard', arguments: JSON.stringify({ matchId: p.matchId }) });
    }
    if (COMMENTARY_WORDS.test(p.question)) {
      calls.push({ id: 'mock_3', name: 'get_recent_commentary', arguments: JSON.stringify({ matchId: p.matchId, limit: 6 }) });
    }
    return calls;
  }
  return [{ id: 'mock_1', name: 'get_live_matches', arguments: '{}' }];
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function describeMatch(m: Record<string, unknown>, lang: Lang): string {
  const teams = (m.teams as unknown[] | undefined)?.map(str).filter(Boolean) ?? [];
  const vs = teams.join(lang === 'hi' ? ' बनाम ' : ' vs ');
  const innings = (m.innings as Array<Record<string, unknown>> | undefined) ?? [];
  const scores = innings.map((i) => `${str(i.team)} ${str(i.score)} (${str(i.overs)})`).join(', ');
  const current = m.current as Record<string, unknown> | null;
  const parts = [`${vs}${m.statusDetail ? ` - ${str(m.statusDetail)}` : ''}.`];
  if (scores) parts.push(lang === 'hi' ? `स्कोर: ${scores}.` : `Score: ${scores}.`);
  if (current?.runsRequired !== null && current?.runsRequired !== undefined && current.ballsRemaining) {
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

const HISTORY_TOOLS = new Set(['get_player_history', 'get_head_to_head', 'get_venue_history', 'get_team_phase_stats']);
const ARCHIVE_NOTE = {
  en: 'Source: Cricsheet archive (cricsheet.org) - not official career totals.',
  hi: 'स्रोत: Cricsheet संग्रह (cricsheet.org) - ये आधिकारिक करियर आंकड़े नहीं हैं।',
} as const;

function describeHistory(name: string, data: Record<string, unknown>, lang: Lang): string[] {
  const hi = lang === 'hi';
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
  if (candidates?.length) {
    const list = candidates.map((c) => str(c.name)).join(', ');
    return [hi ? `कई खिलाड़ी मिले: ${list}। आप किसके बारे में पूछ रहे हैं?` : `Several players match: ${list}. Which one do you mean?`];
  }
  if (data.found === false) return [hi ? 'यह संग्रह में नहीं मिला।' : `Not found in the archive. ${str(data.note)}`.trim()];
  const lines: string[] = [];
  if (name === 'get_player_history') {
    const bat = (data.batting as Array<Record<string, unknown>> | undefined)?.[0];
    const bowl = (data.bowling as Array<Record<string, unknown>> | undefined)?.[0];
    if (bat) {
      lines.push(
        hi
          ? `${str(data.player)} (${str(bat.matchType)}, ${str(bat.teamType)}): ${str(bat.innings)} पारियों में ${str(bat.runs)} रन, औसत ${str(bat.average ?? '-')}, स्ट्राइक रेट ${str(bat.strikeRate ?? '-')}, सर्वोच्च ${str(bat.highest)}.`
          : `${str(data.player)} (${str(bat.matchType)}, ${str(bat.teamType)}): ${str(bat.runs)} runs in ${str(bat.innings)} innings, average ${str(bat.average ?? '-')}, strike rate ${str(bat.strikeRate ?? '-')}, highest ${str(bat.highest)}.`,
      );
    }
    if (bowl && Number(bowl.wickets) > 0) {
      lines.push(
        hi
          ? `गेंदबाजी (${str(bowl.matchType)}): ${str(bowl.wickets)} विकेट, इकॉनमी ${str(bowl.economy)}, सर्वश्रेष्ठ ${str(bowl.best)}.`
          : `Bowling (${str(bowl.matchType)}): ${str(bowl.wickets)} wickets, economy ${str(bowl.economy)}, best ${str(bowl.best)}.`,
      );
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
  }
  return lines;
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
    } else if (name === 'get_live_matches') {
      const matches = (data.matches as Array<Record<string, unknown>> | undefined) ?? [];
      if (matches.length === 0) lines.push(lang === 'hi' ? 'अभी कोई मैच लाइव नहीं है।' : 'No matches are live right now.');
      else {
        lines.push(lang === 'hi' ? `अभी ${matches.length} मैच लाइव हैं:` : `${matches.length} match(es) live now:`);
        for (const m of matches.slice(0, 5)) lines.push(`- ${describeMatch(m, lang)}`);
      }
    } else if (name === 'get_match') {
      lines.push(describeMatch(data, lang));
    } else if (name === 'get_scorecard') {
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
    } else if (name === 'get_recent_commentary') {
      const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
      if (items.length > 0) {
        lines.push(lang === 'hi' ? 'हाल की गेंदें:' : 'Recent balls:');
        for (const item of items.slice(0, 6)) lines.push(`- ${str(item.over)}: ${str(item.text)}`);
      }
    } else if (HISTORY_TOOLS.has(name)) {
      usedHistory = true;
      lines.push(...describeHistory(name, data, lang));
    }
  }
  if (usedHistory) lines.push(ARCHIVE_NOTE[lang]);
  if (lines.length === 0) {
    lines.push(lang === 'hi' ? 'मुझे इसका उत्तर देने के लिए डेटा नहीं मिला।' : 'I could not find data to answer that.');
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
