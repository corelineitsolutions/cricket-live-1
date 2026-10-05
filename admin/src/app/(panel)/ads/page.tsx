'use client';

import { useState } from 'react';
import { AdFormModal } from '@/components/ads/ad-form-modal';
import { PageHeader } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Field, Select } from '@/components/ui/form';
import { ConfirmDialog } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '@/components/ui/states';
import { StatusBadge, type Tone } from '@/components/ui/status-badge';
import { adState, type AdState } from '@/lib/ad-form';
import { ApiError, apiRequest } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import { AD_PLACEMENTS, type Ad, type AdPlacement } from '@/lib/types';
import { useApi, useNow } from '@/lib/use-api';

const PAGE_SIZE = 20;

const STATE_BADGE: Record<AdState, { tone: Tone; label: string }> = {
  visible: { tone: 'success', label: 'Showing' },
  scheduled: { tone: 'info', label: 'Scheduled' },
  expired: { tone: 'warning', label: 'Expired' },
  inactive: { tone: 'neutral', label: 'Inactive' },
};

type Editing = { ad: Ad | null } | null;

export default function AdsPage() {
  const now = useNow(30_000);
  const [placement, setPlacement] = useState<'' | AdPlacement>('');
  const [status, setStatus] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Ad | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);

  const { data, meta, error, loading, refreshing, reload } = useApi<Ad[]>('/admin/ads', {
    query: { page, limit: PAGE_SIZE, placement: placement || undefined, isActive: status || undefined },
  });

  const run = async (ad: Ad, action: () => Promise<unknown>, success: string) => {
    setBusyId(ad.id);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: 'info', text: success });
      reload();
    } catch (err) {
      setNotice({ tone: 'warning', text: err instanceof ApiError ? err.describe() : 'Unexpected error.' });
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (ad: Ad) =>
    run(ad, () => apiRequest<Ad>(`/admin/ads/${ad.id}/${ad.isActive ? 'deactivate' : 'activate'}`, { method: 'PATCH' }), `"${ad.title}" ${ad.isActive ? 'deactivated' : 'activated'}.`);

  const confirmDelete = async () => {
    if (!deleting) return;
    const ad = deleting;
    await run(ad, () => apiRequest(`/admin/ads/${ad.id}`, { method: 'DELETE' }), `"${ad.title}" deleted.`);
    setDeleting(null);
  };

  const columns: Column<Ad>[] = [
    {
      key: 'preview',
      header: 'Preview',
      render: (ad) => (
        <a href={ad.clickUrl} target="_blank" rel="noopener noreferrer" className="block w-24" title={ad.clickUrl}>
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external ad creatives */}
          <img src={ad.imageUrl} alt={ad.title} loading="lazy" referrerPolicy="no-referrer" className="h-12 w-24 rounded border border-slate-200 bg-slate-50 object-contain" />
        </a>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (ad) => (
        <div className="max-w-xs">
          <p className="truncate font-medium text-slate-900">{ad.title}</p>
          <p className="truncate text-xs text-slate-500">{ad.clickUrl}</p>
        </div>
      ),
    },
    { key: 'placement', header: 'Placement', render: (ad) => humanize(ad.placement) },
    { key: 'priority', header: 'Priority', className: 'tabular-nums', render: (ad) => ad.priority },
    {
      key: 'schedule',
      header: 'Schedule',
      render: (ad) => (
        <div className="text-xs">
          <p>From: {ad.startAt ? formatDateTime(ad.startAt) : 'immediately'}</p>
          <p>Until: {ad.endAt ? formatDateTime(ad.endAt) : 'no end'}</p>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      render: (ad) => {
        const badge = STATE_BADGE[adState(ad, now)];
        return <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>;
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (ad) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing({ ad })} disabled={busyId === ad.id}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggle(ad)} loading={busyId === ad.id && !deleting}>
            {ad.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => setDeleting(ad)} disabled={busyId === ad.id}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const filtered = placement !== '' || status !== '';

  return (
    <>
      <PageHeader
        title="Ads"
        description="Ads served to the app by GET /api/v1/ads. Changes are live immediately."
        actions={<Button onClick={() => setEditing({ ad: null })}>New ad</Button>}
      />

      <div className="mb-4 grid grid-cols-1 gap-4 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-3">
        <Field label="Placement" htmlFor="filter-placement">
          <Select
            id="filter-placement"
            value={placement}
            onChange={(e) => {
              setPlacement(e.target.value as '' | AdPlacement);
              setPage(1);
            }}
          >
            <option value="">All placements</option>
            {AD_PLACEMENTS.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="filter-status">
          <Select
            id="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | 'true' | 'false');
              setPage(1);
            }}
          >
            <option value="">Active and inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </Select>
        </Field>
      </div>

      {notice && (
        <div className="mb-4">
          <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading ads…" />
      ) : !data ? (
        <ErrorState error={error ?? 'No data'} onRetry={reload} />
      ) : (
        <>
          {error && (
            <div className="mb-4">
              <InlineNotice>{error.describe()}</InlineNotice>
            </div>
          )}
          {data.length === 0 ? (
            <EmptyState
              title={filtered ? 'No ads match these filters' : 'No ads yet'}
              description={filtered ? 'Try another placement or status.' : 'Create the first ad to show it in the app.'}
              action={!filtered && <Button onClick={() => setEditing({ ad: null })}>New ad</Button>}
            />
          ) : (
            <DataTable caption="Ads" columns={columns} rows={data} rowKey={(ad) => ad.id} busy={refreshing} />
          )}
          {meta && meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
        </>
      )}

      {editing && (
        <AdFormModal
          key={editing.ad?.id ?? 'new'}
          ad={editing.ad}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setNotice({ tone: 'info', text: `"${saved.title}" ${editing.ad ? 'updated' : 'created'}.` });
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete ad"
        message={
          <>
            Permanently delete <span className="font-medium text-slate-900">{deleting?.title}</span>? This cannot be undone. Deactivate it instead if you may need it again.
          </>
        }
        confirmLabel="Delete"
        busy={deleting !== null && busyId === deleting.id}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
