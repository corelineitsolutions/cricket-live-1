'use client';

import { FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { ApiError, apiRequest } from '@/lib/api';
import { formatOvers, formatScore, teamLabel } from '@/lib/format';
import type { Match } from '@/lib/types';

const DEVICE_KEY = 'cricket-admin-ai-device';
const QUESTION_MAX = 500;

interface AiStatus {
  available: boolean;
  languages: string[];
  maxQuestionLength: number;
}

interface AiAnswer {
  answer: string;
  language: string;
  sources: string[];
  mocked: boolean;
  disclaimer: string;
  generatedAt: string;
}

interface ChatTurn {
  id: string;
  question: string;
  answer?: AiAnswer;
  error?: string;
}

function adminDeviceId(): string {
  if (typeof window === 'undefined') return 'admin-ai-ssr0001';
  const fresh = () => `admin-ai-${crypto.randomUUID()}`;
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id || id.length < 8) {
      id = fresh();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id.slice(0, 128);
  } catch {
    return fresh();
  }
}

function battingTeam(match: Match) {
  const id = match.battingTeamSportmonksId;
  if (id === null) return null;
  if (id === match.localTeam.sportmonksId) return match.localTeam;
  if (id === match.visitorTeam.sportmonksId) return match.visitorTeam;
  return null;
}

function suggestionsFor(match: Match): string[] {
  const bat = battingTeam(match);
  const batName = bat ? teamLabel(bat) : teamLabel(match.localTeam);
  const a = teamLabel(match.localTeam);
  const b = teamLabel(match.visitorTeam);
  const ground = match.venue?.name ? 'this ground' : 'the venue';
  return [
    `How many runs per over does ${batName} need?`,
    `How is the current batter performing?`,
    `Show ${ground}'s record from the Cricsheet archive`,
    `What is the head-to-head between ${a} and ${b}?`,
    `Who is the top scorer on the scorecard?`,
  ];
}

export function MatchAiAssistant({ match }: { match: Match }) {
  const inputId = useId();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const vs = `${teamLabel(match.localTeam)} vs ${teamLabel(match.visitorTeam)}`;
  const bat = battingTeam(match);
  const scoreLine = bat
    ? `${teamLabel(bat)} ${formatScore(match.score, match.wickets)}`
    : match.innings.length
      ? match.innings.map((i) => formatScore(i.score, i.wickets)).join(' · ')
      : 'No score yet';
  const oversLine = [
    match.overs !== null ? `${formatOvers(match.overs)} overs` : null,
    match.statusDetail,
    match.stale ? 'data may be delayed' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<AiStatus>('/ai/status', { auth: false, signal: controller.signal })
      .then((res) => {
        setStatus(res.data);
        setStatusError(null);
      })
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setStatus(null);
        setStatusError(error instanceof ApiError ? error.describe() : 'Could not load AI status');
      });
    return () => controller.abort();
  }, []);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, QUESTION_MAX);
      if (text.length < 2 || busy) return;
      const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setBusy(true);
      setQuestion('');
      setTurns((prev) => [...prev, { id: turnId, question: text }]);
      try {
        const { data } = await apiRequest<AiAnswer>('/ai/ask', {
          method: 'POST',
          auth: false,
          body: { question: text, language, matchId: String(match.matchId), deviceId: adminDeviceId() },
        });
        setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, answer: data } : t)));
      } catch (error) {
        const message = error instanceof ApiError ? error.describe() : 'Unexpected error';
        setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, error: message } : t)));
      } finally {
        setBusy(false);
      }
    },
    [busy, language, match.matchId],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  const ready = status?.available === true;
  const statusLabel = statusError ? 'Error' : status === null ? 'Checking…' : ready ? 'Ready' : 'Off';
  const statusTone = statusError ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30' : ready ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' : 'bg-slate-500/20 text-slate-300 ring-slate-500/30';

  return (
    <section id="ai" className="overflow-hidden rounded-2xl bg-zinc-950 text-zinc-100 shadow-lg ring-1 ring-zinc-800">
      <div className="space-y-5 p-5 sm:p-6">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 ring-1 ring-zinc-700" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-200" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c-2.8 1.6-4.5 4.4-4.5 7.5 0 2.1.8 3.9 2.1 5.2L8 21l4-1.5L16 21l-1.6-5.3c1.3-1.3 2.1-3.1 2.1-5.2C16.5 7.4 14.8 4.6 12 3Z" />
              <path strokeLinecap="round" d="M9.5 10.5h.01M14.5 10.5h.01" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-white">Cricket AI</h2>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusTone}`}>{statusLabel}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-zinc-400">{vs} · Match assistant</p>
          </div>
          <label className="sr-only" htmlFor={`${inputId}-lang`}>
            Language
          </label>
          <select
            id={`${inputId}-lang`}
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'en' | 'hi')}
            className="rounded-lg bg-zinc-900 px-2 py-1 text-xs text-zinc-300 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
          >
            <option value="en">EN</option>
            <option value="hi">HI</option>
          </select>
        </header>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Current match</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-white tabular-nums">{scoreLine}</p>
          {oversLine && <p className="mt-0.5 text-sm text-zinc-400">{oversLine}</p>}
        </div>

        {!ready && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/20">
            {statusError
              ? statusError
              : 'AI is switched off. Set AI_ENABLED=true (and LLM_PROVIDER=mock for a free test) in backend/.env, then reload the API.'}
          </p>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-zinc-200">What would you like to know?</p>
          <ul className="space-y-2">
            {suggestionsFor(match).map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  disabled={!ready || busy}
                  onClick={() => void ask(suggestion)}
                  className="flex w-full items-center gap-3 rounded-xl bg-zinc-900/80 px-3.5 py-3 text-left text-sm text-zinc-100 ring-1 ring-zinc-700 transition hover:bg-zinc-800 hover:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5M7 4h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H11l-4 3v-3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
                  </svg>
                  <span className="min-w-0 flex-1">{suggestion}</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {turns.length > 0 && (
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl bg-zinc-900/60 p-3 ring-1 ring-zinc-800">
            {turns.map((turn) => (
              <div key={turn.id} className="space-y-1.5 text-sm">
                <p className="font-medium text-zinc-300">You: {turn.question}</p>
                {!turn.answer && !turn.error && <p className="text-zinc-500">Thinking…</p>}
                {turn.error && <p className="text-rose-300">{turn.error}</p>}
                {turn.answer && (
                  <div className="space-y-1 text-zinc-100">
                    <p className="whitespace-pre-wrap">{turn.answer.answer}</p>
                    {turn.answer.sources.length > 0 && <p className="text-xs text-zinc-500">Sources: {turn.answer.sources.join(' · ')}</p>}
                    <p className="text-xs text-zinc-500">{turn.answer.disclaimer}</p>
                    {turn.answer.mocked && <p className="text-xs text-sky-400">Demo mode (no AI model).</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-1.5">
          <label htmlFor={inputId} className="sr-only">
            Ask about this match
          </label>
          <div className="relative">
            <textarea
              id={inputId}
              rows={3}
              value={question}
              maxLength={QUESTION_MAX}
              disabled={!ready || busy}
              placeholder="Ask about this match..."
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              className="w-full resize-none rounded-2xl bg-zinc-900 py-3 pl-4 pr-12 text-sm text-zinc-100 placeholder:text-zinc-500 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!ready || busy || question.trim().length < 2}
              aria-label="Send question"
              className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                  <path d="M3.4 20.6 21 12 3.4 3.4l.1 6.8L15 12 3.5 13.8z" />
                </svg>
              )}
            </button>
          </div>
          <p className="px-1 text-xs text-zinc-500">Example: Can {teamLabel(match.localTeam)} reach 180?</p>
        </form>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Admin test panel for this match. Questions and answers are not stored. Historical figures come from the Cricsheet archive when AI_HISTORY_ENABLED is on.
        </p>
      </div>
    </section>
  );
}
