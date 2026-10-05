'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Field, Select, TextInput } from '@/components/ui/form';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { dayBoundary } from '@/lib/date-filter';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import type { AdminDevice } from '@/lib/types';
import { useApi, useDebounced, useNow } from '@/lib/use-api';

const PAGE_SIZES = [20, 50, 100];
const SEARCH_PATTERN = /^[A-Za-z0-9_.:-]*$/;

interface Filters {
  search: string;
  platform: '' | 'android' | 'ios';
  status: '' | 'true' | 'false';
  lastSeenFrom: string;
  lastSeenTo: string;
  createdFrom: string;
  createdTo: string;
}

const EMPTY_FILTERS: Filters = { search: '', platform: '', status: '', lastSeenFrom: '', lastSeenTo: '', createdFrom: '', createdTo: '' };

export default function DevicesPage() {
  const now = useNow(30_000);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZES[0]);
  const search = useDebounced(filters.search.trim());
  const searchInvalid = !SEARCH_PATTERN.test(filters.search.trim());

  const { data, meta, error, loading, refreshing, reload } = useApi<AdminDevice[]>(searchInvalid ? null : '/admin/devices', {
    query: {
      page,
      limit,
      search: search || undefined,
      platform: filters.platform || undefined,
      isActive: filters.status || undefined,
      lastSeenFrom: dayBoundary(filters.lastSeenFrom, 'start'),
      lastSeenTo: dayBoundary(filters.lastSeenTo, 'end'),
      createdFrom: dayBoundary(filters.createdFrom, 'start'),
      createdTo: dayBoundary(filters.createdTo, 'end'),
    },
  });

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  const columns: Column<AdminDevice>[] = [
    { key: 'deviceId', header: 'Device ID', render: (d) => <code className="text-xs text-slate-900">{d.deviceId}</code> },
    { key: 'platform', header: 'Platform', render: (d) => (d.platform === 'ios' ? 'iOS' : 'Android') },
    { key: 'appVersion', header: 'App version', render: (d) => d.appVersion ?? '—' },
    { key: 'token', header: 'FCM token', render: (d) => <code className="text-xs text-slate-500">{d.fcmTokenMasked}</code> },
    { key: 'lastSeen', header: 'Last seen', render: (d) => <span title={formatDateTime(d.lastSeenAt)}>{formatRelative(d.lastSeenAt, now)}</span> },
    { key: 'status', header: 'Status', render: (d) => (d.isActive ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>) },
    { key: 'created', header: 'Registered', render: (d) => <span title={formatDateTime(d.createdAt)}>{formatDate(d.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader title="Devices" description="Devices registered for push notifications. FCM tokens are masked." />

      <div className="mb-4 grid grid-cols-1 gap-4 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search device ID" htmlFor="search" error={searchInvalid ? 'Letters, digits and _ . : - only.' : undefined}>
          <TextInput id="search" type="search" placeholder="e.g. 6f1c0b3e" maxLength={128} value={filters.search} invalid={searchInvalid} onChange={(e) => update('search', e.target.value)} />
        </Field>
        <Field label="Platform" htmlFor="platform">
          <Select id="platform" value={filters.platform} onChange={(e) => update('platform', e.target.value as Filters['platform'])}>
            <option value="">All platforms</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" value={filters.status} onChange={(e) => update('status', e.target.value as Filters['status'])}>
            <option value="">Active and inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </Select>
        </Field>
        <Field label="Rows per page" htmlFor="limit">
          <Select
            id="limit"
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Last seen from" htmlFor="lastSeenFrom">
          <TextInput id="lastSeenFrom" type="date" value={filters.lastSeenFrom} onChange={(e) => update('lastSeenFrom', e.target.value)} />
        </Field>
        <Field label="Last seen to" htmlFor="lastSeenTo">
          <TextInput id="lastSeenTo" type="date" value={filters.lastSeenTo} min={filters.lastSeenFrom || undefined} onChange={(e) => update('lastSeenTo', e.target.value)} />
        </Field>
        <Field label="Registered from" htmlFor="createdFrom">
          <TextInput id="createdFrom" type="date" value={filters.createdFrom} onChange={(e) => update('createdFrom', e.target.value)} />
        </Field>
        <Field label="Registered to" htmlFor="createdTo">
          <TextInput id="createdTo" type="date" value={filters.createdTo} min={filters.createdFrom || undefined} onChange={(e) => update('createdTo', e.target.value)} />
        </Field>
        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {loading && !searchInvalid ? (
        <LoadingState label="Loading devices…" />
      ) : !data ? (
        error ? <ErrorState error={error} onRetry={reload} /> : null
      ) : (
        <>
          {error && (
            <div className="mb-4">
              <InlineNotice>{error.describe()}</InlineNotice>
            </div>
          )}
          {data.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'No devices match these filters' : 'No devices registered yet'}
              description={hasFilters ? 'Try widening the filters.' : 'Devices appear after the app calls POST /api/v1/devices/register.'}
            />
          ) : (
            <DataTable caption="Registered devices" columns={columns} rows={data} rowKey={(d) => d.id} busy={refreshing} />
          )}
          {meta && meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
        </>
      )}
    </>
  );
}
