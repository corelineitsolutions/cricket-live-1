'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '@/components/ui/states';
import { healthTone, StatusBadge } from '@/components/ui/status-badge';
import { formatOvers, formatRelative, formatScore, humanize, teamLabel } from '@/lib/format';
import { matchStatusTone } from '@/lib/match-status';
import type { AdminLiveBoard, AdminLiveMatch } from '@/lib/types';
import { useApi, useNow } from '@/lib/use-api';

const REFRESH_MS = 10_000;

export default function MatchesPage() {
  const router = useRouter();
  const now = useNow();
  const { data, error, loading, refreshing, reload } = useApi<AdminLiveBoard>('/admin/matches/live', { pollMs: REFRESH_MS });

  const battingTeam = (match: AdminLiveMatch) => {
    const id = match.battingTeamSportmonksId;
    if (id === null) return null;
    return id === match.localTeam.sportmonksId ? match.localTeam : id === match.visitorTeam.sportmonksId ? match.visitorTeam : null;
  };

  const columns: Column<AdminLiveMatch>[] = [
    {
      key: 'match',
      header: 'Match',
      render: (match) => (
        <div>
          <p className="font-medium text-slate-900">{match.league?.name ?? 'Unknown league'}</p>
          <p className="text-xs text-slate-500">
            {[match.matchType, match.round].filter(Boolean).join(' · ') || '—'} · #{match.matchId}
          </p>
        </div>
      ),
    },
    {
      key: 'teams',
      header: 'Teams',
      render: (match) => (
        <span>
          {teamLabel(match.localTeam)} <span className="text-slate-400">vs</span> {teamLabel(match.visitorTeam)}
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      className: 'tabular-nums',
      render: (match) => {
        const team = battingTeam(match);
        return (
          <span>
            {team && <span className="mr-1 text-xs text-slate-500">{teamLabel(team)}</span>}
            <span className="font-semibold text-slate-900">{formatScore(match.score, null)}</span>
          </span>
        );
      },
    },
    { key: 'wickets', header: 'Wickets', className: 'tabular-nums', render: (match) => match.wickets ?? '—' },
    { key: 'overs', header: 'Overs', className: 'tabular-nums', render: (match) => formatOvers(match.overs) },
    {
      key: 'status',
      header: 'Status',
      render: (match) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge tone={matchStatusTone(match.status)}>{humanize(match.status)}</StatusBadge>
          {match.statusDetail && <span className="text-xs text-slate-500">{match.statusDetail}</span>}
        </div>
      ),
    },
    { key: 'updated', header: 'Last update', render: (match) => <span title={match.lastUpdatedAt}>{formatRelative(match.lastUpdatedAt, now)}</span> },
    {
      key: 'stale',
      header: 'Data',
      render: (match) => (match.stale ? <StatusBadge tone="warning">Stale</StatusBadge> : <StatusBadge tone="success">Fresh</StatusBadge>),
    },
    { key: 'subscribers', header: 'Viewers', className: 'tabular-nums text-right', render: (match) => match.subscribers },
  ];

  return (
    <>
      <PageHeader
        title="Live matches"
        description={`Read-only view of the live feed. Refreshes every ${REFRESH_MS / 1000} s.`}
        actions={
          <Button variant="secondary" size="sm" onClick={reload} loading={refreshing}>
            Refresh
          </Button>
        }
      />
      {loading ? (
        <LoadingState label="Loading live matches…" />
      ) : !data ? (
        <ErrorState error={error ?? 'No data'} onRetry={reload} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span>
              Feed updated <span className="font-medium text-slate-900">{formatRelative(data.updatedAt, now)}</span>
            </span>
            <StatusBadge tone={data.stale ? 'warning' : 'success'}>{data.stale ? 'Feed delayed' : 'Feed fresh'}</StatusBadge>
            <span className="flex items-center gap-1.5">
              Worker <StatusBadge tone={healthTone(data.workerState)}>{data.workerState ? humanize(data.workerState) : 'No status'}</StatusBadge>
            </span>
          </div>
          {error && <InlineNotice>Last refresh failed ({error.describe()}). Showing the previous data.</InlineNotice>}
          {data.matches.length === 0 ? (
            <EmptyState title="No live matches right now" description="Matches appear here as soon as the worker sees them in the Latiyal live feed." />
          ) : (
            <DataTable
              caption="Live matches"
              columns={columns}
              rows={data.matches}
              rowKey={(match) => String(match.matchId)}
              onRowClick={(match) => router.push(`/matches/${match.matchId}`)}
              busy={refreshing}
            />
          )}
        </div>
      )}
    </>
  );
}
