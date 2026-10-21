'use client';

import { PageHeader } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { type Column, DataTable } from '@/components/ui/data-table';
import { MetricCard, UsageBar } from '@/components/ui/metric-card';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatInterval, formatNumber } from '@/lib/format';
import { useApi } from '@/lib/use-api';

const REFRESH_MS = 60_000;

interface UsageCounters {
  requests: number;
  answered: number;
  refusedDisabled: number;
  refusedQuota: number;
  refusedBudget: number;
  refusedBusy: number;
  errors: number;
  timeouts: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  languageEn: number;
  languageHi: number;
  latencyMsTotal: number;
}

interface UsageRow extends UsageCounters {
  day: string;
  provider: string;
  model: string;
  estimatedCost: number;
}

interface AiOverview {
  status: {
    enabled: boolean;
    ready: boolean;
    reason: string | null;
    provider: string;
    model: string;
    mocked: boolean;
    logQuestions?: boolean;
    dailyTokenBudget: number;
    tokensUsedToday: number | null;
    costPer1kInputTokens: number;
    costPer1kOutputTokens: number;
  };
  limits: {
    perDevicePerMinute: number;
    perDevicePerDay: number;
    perIpPerMinute: number;
    maxConcurrentPerInstance: number;
    requestTimeoutMs: number;
    maxOutputTokens: number;
  };
  today: Array<{ provider: string; model: string; counters: UsageCounters; estimatedCost: number }> | null;
  history: UsageRow[] | null;
}

interface TrainingQuestion {
  id: string;
  question: string;
  language: string;
  matchId: string | null;
  outcome: string;
  toolsUsed: string[] | unknown;
  answerPreview: string | null;
  needsReview: boolean;
  createdAt: string;
}

interface TrainingList {
  loggingEnabled: boolean;
  total: number;
  needsReview: number;
  items: TrainingQuestion[];
}

const refused = (c: UsageCounters) => c.refusedDisabled + c.refusedQuota + c.refusedBudget + c.refusedBusy;
const avgLatency = (c: UsageCounters) => (c.answered > 0 ? Math.round(c.latencyMsTotal / c.answered) : null);

const COLUMNS: Column<UsageRow>[] = [
  { key: 'day', header: 'Day (UTC)', render: (r) => r.day },
  { key: 'provider', header: 'Provider / model', render: (r) => `${r.provider} / ${r.model}` },
  { key: 'requests', header: 'Requests', render: (r) => formatNumber(r.requests), className: 'text-right' },
  { key: 'answered', header: 'Answered', render: (r) => formatNumber(r.answered), className: 'text-right' },
  { key: 'refused', header: 'Refused', render: (r) => formatNumber(refused(r)), className: 'text-right' },
  { key: 'failed', header: 'Errors / timeouts', render: (r) => `${formatNumber(r.errors)} / ${formatNumber(r.timeouts)}`, className: 'text-right' },
  { key: 'tokens', header: 'Tokens in / out', render: (r) => `${formatNumber(r.promptTokens)} / ${formatNumber(r.completionTokens)}`, className: 'text-right' },
  { key: 'lang', header: 'EN / HI', render: (r) => `${formatNumber(r.languageEn)} / ${formatNumber(r.languageHi)}`, className: 'text-right' },
  { key: 'latency', header: 'Avg latency', render: (r) => formatInterval(avgLatency(r)), className: 'text-right' },
  { key: 'cost', header: 'Est. cost', render: (r) => r.estimatedCost.toFixed(4), className: 'text-right' },
];

const TRAINING_COLUMNS: Column<TrainingQuestion>[] = [
  {
    key: 'createdAt',
    header: 'When',
    render: (r) => new Date(r.createdAt).toLocaleString(),
  },
  { key: 'language', header: 'Lang', render: (r) => r.language },
  { key: 'question', header: 'Question', render: (r) => r.question },
  {
    key: 'tools',
    header: 'Tools',
    render: (r) => (Array.isArray(r.toolsUsed) ? r.toolsUsed.join(', ') : '—'),
  },
  {
    key: 'review',
    header: 'Review',
    render: (r) => (
      <StatusBadge tone={r.needsReview ? 'warning' : 'success'}>{r.needsReview ? 'Needs review' : 'OK'}</StatusBadge>
    ),
  },
  {
    key: 'answer',
    header: 'Answer preview',
    render: (r) => r.answerPreview ?? '—',
  },
];

export default function AiPage() {
  const { data, error, loading, refreshing, reload } = useApi<AiOverview>('/admin/ai/overview', { pollMs: REFRESH_MS });
  const training = useApi<TrainingList>('/admin/ai/training-questions?limit=100', { pollMs: REFRESH_MS });

  if (loading) return <LoadingState label="Loading AI assistant…" />;
  if (!data) {
    return (
      <>
        <PageHeader title="AI assistant" />
        <ErrorState title="Could not load AI status" error={error ?? 'No data'} onRetry={reload} />
      </>
    );
  }

  const { status, limits } = data;
  const today = (data.today ?? []).reduce<UsageCounters | null>((sum, row) => {
    if (!sum) return { ...row.counters };
    for (const key of Object.keys(sum) as Array<keyof UsageCounters>) sum[key] += row.counters[key];
    return sum;
  }, null);
  const tokensToday = status.tokensUsedToday ?? 0;

  return (
    <>
      <PageHeader
        title="AI assistant"
        description={
          status.logQuestions
            ? 'Usage counters plus opt-in training questions (AI_LOG_QUESTIONS). Device ids and IPs are never stored.'
            : 'Aggregate counters only. Question text is stored only when AI_LOG_QUESTIONS=true.'
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              reload();
              training.reload();
            }}
            loading={refreshing || training.refreshing}
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <InlineNotice>Last refresh failed ({error.describe()}). Showing the previous data.</InlineNotice>
        </div>
      )}
      {status.enabled && !status.ready && (
        <div className="mb-4">
          <InlineNotice>The assistant is enabled but not usable: {status.reason}</InlineNotice>
        </div>
      )}
      {status.mocked && status.enabled && (
        <div className="mb-4">
          <InlineNotice tone="info">Mock mode (no Groq): answers from tools + templates. Safe for team question drills.</InlineNotice>
        </div>
      )}
      {status.logQuestions && (
        <div className="mb-4">
          <InlineNotice tone="info">
            Question logging is on. Team Ask text is saved for routing training
            {training.data ? ` (${formatNumber(training.data.total)} total, ${formatNumber(training.data.needsReview)} need review)` : ''}.
          </InlineNotice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Status"
          value={
            <StatusBadge tone={status.ready ? 'success' : status.enabled ? 'warning' : 'neutral'}>
              {status.ready ? 'Available' : status.enabled ? 'Not configured' : 'Switched off'}
            </StatusBadge>
          }
          hint={`${status.provider} / ${status.model}`}
        />
        <MetricCard label="Questions today" value={formatNumber(today?.requests ?? 0)} hint={`${formatNumber(today?.answered ?? 0)} answered`} />
        <MetricCard
          label="Refused today"
          value={formatNumber(today ? refused(today) : 0)}
          hint={today ? `limits ${formatNumber(today.refusedQuota)} · budget ${formatNumber(today.refusedBudget)} · busy ${formatNumber(today.refusedBusy)}` : undefined}
        />
        <MetricCard
          label="Errors today"
          value={formatNumber((today?.errors ?? 0) + (today?.timeouts ?? 0))}
          hint={`${formatNumber(today?.timeouts ?? 0)} timeouts`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Daily token budget" description="Shared by all API instances. Only real providers count against it.">
          {status.mocked ? (
            <p className="text-sm text-slate-600">The mock provider uses no tokens.</p>
          ) : (
            <>
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-900">
                  {formatNumber(tokensToday)} / {formatNumber(status.dailyTokenBudget)} tokens today
                </span>
              </div>
              {status.dailyTokenBudget > 0 && <UsageBar used={tokensToday} limit={status.dailyTokenBudget} />}
            </>
          )}
          <div className="mt-4">
            <DescriptionList
              items={[
                { label: 'Cost per 1k input / output tokens', value: `${status.costPer1kInputTokens} / ${status.costPer1kOutputTokens}` },
                { label: 'Max output tokens per call', value: formatNumber(limits.maxOutputTokens) },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Limits">
          <DescriptionList
            items={[
              { label: 'Per device', value: `${limits.perDevicePerMinute} / minute, ${limits.perDevicePerDay} / day` },
              { label: 'Per IP address', value: `${limits.perIpPerMinute} / minute` },
              { label: 'Concurrent requests', value: `${limits.maxConcurrentPerInstance} per API instance` },
              { label: 'Request timeout', value: formatInterval(limits.requestTimeoutMs) },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Daily usage" description="Stored in ai_usage_daily (UTC days). Costs are estimates from the configured prices.">
          {data.history && data.history.length > 0 ? (
            <DataTable columns={COLUMNS} rows={data.history} rowKey={(r) => `${r.day}-${r.provider}-${r.model}`} busy={refreshing} />
          ) : (
            <EmptyState title="No usage yet" description={data.history === null ? 'Usage history is unavailable (MySQL or Redis down).' : 'Counters appear after the first question.'} />
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel
          title="Training questions"
          description="Hinglish / routing drills. Requires AI_LOG_QUESTIONS=true and the ai_training_questions migration."
        >
          {!status.logQuestions ? (
            <EmptyState
              title="Logging is off"
              description="Set AI_LOG_QUESTIONS=true on the API, run the migration, and restart. Then every Ask is listed here."
            />
          ) : training.error && !training.data ? (
            <ErrorState title="Could not load training questions" error={training.error} onRetry={training.reload} />
          ) : training.data && training.data.items.length > 0 ? (
            <DataTable
              columns={TRAINING_COLUMNS}
              rows={training.data.items}
              rowKey={(r) => r.id}
              busy={training.refreshing}
            />
          ) : (
            <EmptyState title="No questions yet" description="Ask from the app or admin match AI. Weak or unmatched answers are flagged Needs review." />
          )}
        </Panel>
      </div>
    </>
  );
}
