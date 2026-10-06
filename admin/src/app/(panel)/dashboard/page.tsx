'use client';

import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { MetricCard, UsageBar } from '@/components/ui/metric-card';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { ErrorState, InlineNotice, LoadingState } from '@/components/ui/states';
import { healthTone, StatusBadge } from '@/components/ui/status-badge';
import { formatDateTime, formatInterval, formatNumber, formatRelative, humanize } from '@/lib/format';
import type { Dashboard } from '@/lib/types';
import { useApi, useNow } from '@/lib/use-api';

const REFRESH_MS = 15_000;

const WORKER_HEALTH_TEXT: Record<Dashboard['dependencies']['worker'], string> = {
  up: 'Reporting normally',
  down: 'No report recently: crashed or stuck',
  disabled: 'Disabled (no Latiyal token)',
  unknown: 'Never reported, or Redis unavailable',
};

function ServiceTile({ name, status, detail }: { name: string; status: string; detail: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-4">
      <div>
        <p className="text-sm font-medium text-slate-900">{name}</p>
        <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
      </div>
      <StatusBadge tone={healthTone(status)}>{status === 'up' ? 'Up' : humanize(status)}</StatusBadge>
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, loading, refreshing, lastLoadedAt, reload } = useApi<Dashboard>('/admin/dashboard', { pollMs: REFRESH_MS });
  const now = useNow();

  if (loading) {
    return <LoadingState label="Loading dashboard…" />;
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState title="NestJS API unreachable" error={error ?? 'No data'} onRetry={reload} />
      </>
    );
  }

  const { provider: sm, dependencies: deps } = data;
  const lastSuccessAge = sm.lastSuccessAt ? now - Date.parse(sm.lastSuccessAt) : null;
  const pollIsLate = lastSuccessAge !== null && lastSuccessAge > Math.max(3 * (sm.pollingIntervalMs ?? sm.configuredIntervalsMs.idle), 120_000);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Refreshes every ${REFRESH_MS / 1000} s · updated ${formatRelative(lastLoadedAt ? new Date(lastLoadedAt).toISOString() : null, now)}`}
        actions={
          <Button variant="secondary" size="sm" onClick={reload} loading={refreshing}>
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <InlineNotice>Last refresh failed ({error.describe()}). Showing the previous data.</InlineNotice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Live matches" value={formatNumber(data.matches.liveCount)} hint={data.matches.liveCount === null ? 'Live store unavailable' : 'In the live feed now'} />
        <MetricCard
          label="Active devices"
          value={formatNumber(data.devices.active)}
          hint={`of ${formatNumber(data.devices.registered)} registered`}
        />
        <MetricCard
          label="WebSocket connections"
          value={formatNumber(data.realtime.connectedClients)}
          hint={`${formatNumber(data.realtime.activeMatchRooms)} match rooms · ${formatNumber(data.realtime.subscriptions)} subscriptions`}
          footer={`${data.realtime.instances} API instance${data.realtime.instances === 1 ? '' : 's'} reporting`}
        />
        <MetricCard
          label="Active ads"
          value={formatNumber(data.ads.visibleNow)}
          hint={`${formatNumber(data.ads.enabled)} enabled · ${formatNumber(data.ads.total)} total`}
        />
      </div>

      <div className="mt-6">
        <Panel title="Infrastructure" description="Each service is checked independently.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ServiceTile name="NestJS API" status={deps.api} detail="Answered this request" />
            <ServiceTile name="Live-score worker" status={deps.worker} detail={WORKER_HEALTH_TEXT[deps.worker]} />
            <ServiceTile name="Redis" status={deps.redis} detail={deps.redis === 'up' ? 'Live state, cache, pub/sub' : 'Live data and caching unavailable'} />
            <ServiceTile name="MySQL" status={deps.mysql} detail={deps.mysql === 'up' ? 'Stored matches, devices, ads' : 'Stored data unavailable'} />
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Latiyal worker"
          actions={<StatusBadge tone={healthTone(sm.workerState)}>{sm.workerState ? humanize(sm.workerState) : 'No status'}</StatusBadge>}
        >
          {pollIsLate && (
            <div className="mb-3">
              <InlineNotice>The last successful poll is older than expected. Check the worker logs.</InlineNotice>
            </div>
          )}
          <DescriptionList
            items={[
              { label: 'Status message', value: sm.workerMessage ?? '—' },
              {
                label: 'Last successful poll',
                value: sm.lastSuccessAt ? (
                  <span title={formatDateTime(sm.lastSuccessAt)}>
                    {formatRelative(sm.lastSuccessAt, now)}
                    {sm.lastSuccess && (
                      <span className="text-slate-500">
                        {' '}
                        · {sm.lastSuccess.liveMatches} live · {sm.lastSuccess.durationMs} ms
                      </span>
                    )}
                  </span>
                ) : (
                  'Never'
                ),
              },
              {
                label: 'Last error',
                value: sm.lastError ? (
                  <span>
                    <span className="font-medium text-rose-700">
                      {humanize(sm.lastError.kind)}
                      {sm.lastError.status ? ` (HTTP ${sm.lastError.status})` : ''}
                    </span>{' '}
                    <span className="text-slate-500" title={formatDateTime(sm.lastError.at)}>
                      {formatRelative(sm.lastError.at, now)}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{sm.lastError.message}</span>
                  </span>
                ) : (
                  'None'
                ),
              },
              {
                label: 'Polling interval',
                value: (
                  <span>
                    {formatInterval(sm.pollingIntervalMs)}
                    <span className="text-slate-500">
                      {' '}
                      · next {formatRelative(sm.nextPollAt, now)} · configured idle {formatInterval(sm.configuredIntervalsMs.idle)} / live{' '}
                      {formatInterval(sm.configuredIntervalsMs.live)} / close finish {formatInterval(sm.configuredIntervalsMs.active)}
                    </span>
                  </span>
                ),
              },
              { label: 'Worker last report', value: formatRelative(sm.workerUpdatedAt, now) },
            ]}
          />
        </Panel>

        <Panel title="Latiyal usage" description="Counted across every worker and API instance through Redis.">
          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-900">
                {formatNumber(sm.callsThisHour)} {sm.hourlyLimit === null ? '' : `/ ${formatNumber(sm.hourlyLimit)} `}calls this hour
              </span>
              <span className="text-slate-500">resets {formatRelative(sm.quotaResetsAt, now)}</span>
            </div>
            {sm.hourlyLimit !== null && <UsageBar used={sm.callsThisHour ?? 0} limit={sm.hourlyLimit} />}
          </div>
          <DescriptionList
            items={[
              { label: 'Calls this hour', value: formatNumber(sm.callsThisHour) },
              { label: 'Configured limit', value: sm.hourlyLimit === null ? 'Unlimited' : `${formatNumber(sm.hourlyLimit)} / hour` },
              {
                label: 'Remaining quota',
                value: sm.remainingQuota === null ? (sm.hourlyLimit === null ? 'Unlimited' : 'Unavailable') : (
                  <span>
                    {formatNumber(sm.remainingQuota)}
                    <span className="text-slate-500"> · {sm.quotaSource === 'api' ? 'from API headers' : 'local count'}</span>
                  </span>
                ),
              },
              {
                label: 'HTTP 429 responses',
                value: (
                  <span className={sm.count429 ? 'font-medium text-rose-700' : ''}>
                    {formatNumber(sm.count429)}
                    {sm.last429At && <span className="font-normal text-slate-500"> · last {formatRelative(sm.last429At, now)}</span>}
                  </span>
                ),
              },
              {
                label: 'App requests (feeds, scorecard, commentary)',
                value:
                  sm.onDemandHourlyLimit === null
                    ? `${formatNumber(sm.onDemandCallsThisHour)} calls this hour`
                    : `${formatNumber(sm.onDemandCallsThisHour)} / ${formatNumber(sm.onDemandHourlyLimit)} calls this hour`,
              },
              { label: 'Last HTTP status', value: sm.lastStatus ?? '—' },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
