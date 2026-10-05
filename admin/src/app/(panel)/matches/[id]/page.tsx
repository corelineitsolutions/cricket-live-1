'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDateTime, formatOvers, formatRelative, formatScore, humanize, teamLabel } from '@/lib/format';
import { matchStatusTone } from '@/lib/match-status';
import type { AdminMatchDetail, CacheEntry, Match } from '@/lib/types';
import { useApi, useNow } from '@/lib/use-api';

const REFRESH_MS = 10_000;

function CacheRow({ entry, now }: { entry: CacheEntry; now: number }) {
  return entry.cached ? (
    <span>
      <StatusBadge tone="success">Cached</StatusBadge>
      <span className="ml-2 text-slate-500">
        written {formatRelative(entry.cachedAt, now)}
        {entry.expiresInSeconds !== null && ` · expires in ${entry.expiresInSeconds} s`}
      </span>
    </span>
  ) : (
    <StatusBadge tone="neutral">Not cached</StatusBadge>
  );
}

function Scoreboard({ match }: { match: Match }) {
  const teamName = (id: number) => (id === match.localTeam.sportmonksId ? teamLabel(match.localTeam) : id === match.visitorTeam.sportmonksId ? teamLabel(match.visitorTeam) : `#${id}`);
  return (
    <div className="space-y-5">
      {match.innings.length === 0 ? (
        <p className="text-sm text-slate-500">No innings yet.</p>
      ) : (
        <DataTable
          caption="Innings"
          columns={[
            { key: 'inning', header: 'Inn.', render: (row) => row.inning },
            { key: 'team', header: 'Team', render: (row) => teamName(row.teamSportmonksId) },
            { key: 'score', header: 'Score', className: 'tabular-nums', render: (row) => formatScore(row.score, row.wickets) },
            { key: 'overs', header: 'Overs', className: 'tabular-nums', render: (row) => formatOvers(row.overs) },
          ]}
          rows={match.innings}
          rowKey={(row) => `${row.inning}-${row.teamSportmonksId}`}
        />
      )}
      <DescriptionList
        items={[
          { label: 'Run rate', value: match.runRate ?? '—' },
          { label: 'Target', value: match.target ?? '—' },
          { label: 'Runs required', value: match.runsRequired === null ? '—' : `${match.runsRequired} from ${match.ballsRemaining ?? '?'} balls` },
          { label: 'Required run rate', value: match.requiredRunRate ?? '—' },
          {
            label: 'Batsmen',
            value: match.batsmen.length ? match.batsmen.map((b) => `${b.name ?? `#${b.sportmonksId}`} ${b.runs} (${b.balls})`).join(' · ') : '—',
          },
          {
            label: 'Bowler',
            value: match.bowler ? `${match.bowler.name ?? `#${match.bowler.sportmonksId}`} ${match.bowler.wickets}/${match.bowler.runs} (${formatOvers(match.bowler.overs)})` : '—',
          },
          { label: 'Note', value: match.note ?? '—' },
        ]}
      />
    </div>
  );
}

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>();
  const now = useNow();
  const { data, error, loading, refreshing, reload } = useApi<AdminMatchDetail>(`/admin/matches/${encodeURIComponent(params.id)}`, { pollMs: REFRESH_MS });

  const back = (
    <Link href="/matches" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
      ← Live matches
    </Link>
  );

  if (loading) {
    return <LoadingState label="Loading match…" />;
  }
  if (!data) {
    return (
      <>
        <div className="mb-4">{back}</div>
        {error?.status === 404 ? <EmptyState title="Match not found" description="It is not in the live feed and not stored in MySQL." /> : <ErrorState error={error ?? 'No data'} onRetry={reload} />}
      </>
    );
  }

  const match: Match | null = data.live ?? data.stored;
  return (
    <>
      <div className="mb-4">{back}</div>
      <PageHeader
        title={match ? `${teamLabel(match.localTeam)} vs ${teamLabel(match.visitorTeam)}` : `Match ${data.matchId}`}
        description={`Sportmonks #${data.matchId}${data.internalId ? ` · internal ${data.internalId}` : ''}`}
        actions={
          <Button variant="secondary" size="sm" onClick={reload} loading={refreshing}>
            Refresh
          </Button>
        }
      />
      <div className="mb-4">
        <InlineNotice tone="info">Read-only. Scores come from Sportmonks and cannot be edited here.</InlineNotice>
      </div>
      {error && (
        <div className="mb-4">
          <InlineNotice>Last refresh failed ({error.describe()}). Showing the previous data.</InlineNotice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="Live snapshot (Redis)"
            description={data.liveWrittenAt ? `Written by the worker ${formatRelative(data.liveWrittenAt, now)}` : 'No live snapshot'}
            actions={
              data.live && (
                <div className="flex gap-2">
                  <StatusBadge tone={matchStatusTone(data.live.status)}>{humanize(data.live.status)}</StatusBadge>
                  {data.live.stale ? <StatusBadge tone="warning">Stale</StatusBadge> : <StatusBadge tone="success">Fresh</StatusBadge>}
                </div>
              )
            }
          >
            {data.live ? <Scoreboard match={data.live} /> : <p className="text-sm text-slate-500">The match is not in the live feed.</p>}
          </Panel>

          <Panel title="Raw data" description="Exactly what the API holds for this match.">
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-indigo-600">Show JSON</summary>
              <pre className="mt-3 max-h-[28rem] overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{JSON.stringify(data, null, 2)}</pre>
            </details>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Overview">
            <DescriptionList
              items={[
                { label: 'In live feed', value: data.inLiveFeed ? 'Yes' : 'No' },
                { label: 'Status', value: match ? `${humanize(match.status)}${match.statusDetail ? ` · ${match.statusDetail}` : ''}` : '—' },
                { label: 'League', value: match?.league?.name ?? '—' },
                { label: 'Venue', value: match?.venue ? [match.venue.name, match.venue.city].filter(Boolean).join(', ') : '—' },
                { label: 'Start', value: formatDateTime(match?.startTime) },
                { label: 'Last update', value: match ? formatRelative(match.lastUpdatedAt, now) : '—' },
                { label: 'Viewers', value: data.live?.subscribers ?? 0 },
              ]}
            />
          </Panel>
          <Panel title="Stored record (MySQL)">
            {data.stored ? (
              <DescriptionList
                items={[
                  { label: 'Internal id', value: <code className="text-xs">{data.stored.internalId}</code> },
                  { label: 'Status', value: humanize(data.stored.status) },
                  { label: 'Created', value: formatDateTime(data.stored.createdAt) },
                  { label: 'Updated', value: formatDateTime(data.stored.updatedAt) },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-500">Not stored yet.</p>
            )}
          </Panel>
          <Panel title="API cache (Redis)">
            {data.cache ? (
              <DescriptionList
                items={[
                  { label: 'Details', value: <CacheRow entry={data.cache.details} now={now} /> },
                  { label: 'Scorecard', value: <CacheRow entry={data.cache.scorecard} now={now} /> },
                  { label: 'Commentary', value: <CacheRow entry={data.cache.commentary} now={now} /> },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-500">Redis unavailable.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
