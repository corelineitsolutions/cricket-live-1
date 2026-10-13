'use client';

import { type FormEvent, useState } from 'react';
import { PageHeader } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { type Column, DataTable } from '@/components/ui/data-table';
import { Field, FormError, Select, TextInput } from '@/components/ui/form';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '@/components/ui/states';
import { StatusBadge, type Tone } from '@/components/ui/status-badge';
import { ApiError, apiRequest } from '@/lib/api';
import { formatNumber, humanize } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/use-api';

type Kind = 'players' | 'teams' | 'venues';
type MapStatus = 'PROPOSED' | 'CONFIRMED' | 'REJECTED';

interface Side {
  id: string | number;
  name: string | null;
  detail: string | null;
}

interface MappingRow {
  id: string;
  status: MapStatus;
  method: string;
  confidence: number;
  evidence: Record<string, unknown> | null;
  latiyal: Side;
  hist: Side;
}

interface IdentitySummary {
  mappings: Record<Kind, Record<MapStatus, number>>;
  history: { people: number; teams: number; venues: number };
  live: { players: number; teams: number };
  proposalRunning: boolean;
}

interface ProposalRun {
  proposals: number;
  created: number;
  updated: number;
  unchangedOrReviewed: number;
  unmatched: number;
  ambiguous: number;
}

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' },
  { id: 'venues', label: 'Venues' },
];

const STATUS_TONE: Record<MapStatus, Tone> = { PROPOSED: 'info', CONFIRMED: 'success', REJECTED: 'neutral' };

const errorText = (error: unknown) => (error instanceof ApiError ? error.describe() : 'Unexpected error');

function SideCell({ side, idLabel }: { side: Side; idLabel: string }) {
  return (
    <div>
      <p className="font-medium text-slate-900">{side.name ?? <span className="text-slate-400">Unknown</span>}</p>
      <p className="text-xs text-slate-500">
        {idLabel} {side.id}
        {side.detail ? ` · ${side.detail}` : ''}
      </p>
    </div>
  );
}

export default function IdentityPage() {
  const [kind, setKind] = useState<Kind>('players');
  const [status, setStatus] = useState<MapStatus | ''>('PROPOSED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const q = useDebounced(search.trim());

  const summary = useApi<IdentitySummary>('/admin/identity/summary');
  const list = useApi<MappingRow[]>(`/admin/identity/${kind}`, { query: { status: status || undefined, q: q || undefined, page, limit: 25 } });

  const reloadAll = () => {
    list.reload();
    summary.reload();
  };

  const review = async (row: MappingRow, next: MapStatus) => {
    setBusyId(row.id);
    setNotice(null);
    try {
      await apiRequest(`/admin/identity/${kind}/${row.id}`, { method: 'PATCH', body: { status: next } });
      reloadAll();
    } catch (error) {
      setNotice({ tone: 'warning', text: errorText(error) });
    } finally {
      setBusyId(null);
    }
  };

  const propose = async () => {
    setProposing(true);
    setNotice(null);
    try {
      const { data } = await apiRequest<ProposalRun>(`/admin/identity/${kind}/propose`, { method: 'POST' });
      setNotice({
        tone: 'info',
        text: `${formatNumber(data.created)} new and ${formatNumber(data.updated)} updated proposals; ${formatNumber(data.unchangedOrReviewed)} unchanged or already reviewed; ${formatNumber(data.unmatched)} without a match; ${formatNumber(data.ambiguous)} too ambiguous to propose.`,
      });
      reloadAll();
    } catch (error) {
      setNotice({ tone: 'warning', text: errorText(error) });
    } finally {
      setProposing(false);
    }
  };

  const counts = summary.data?.mappings[kind];
  const columns: Column<MappingRow>[] = [
    { key: 'live', header: 'Live (Latiyal)', render: (row) => <SideCell side={row.latiyal} idLabel={kind === 'venues' ? 'key' : 'id'} /> },
    { key: 'hist', header: 'Cricsheet', render: (row) => <SideCell side={row.hist} idLabel="id" /> },
    {
      key: 'match',
      header: 'Match',
      render: (row) => (
        <div>
          <p className="tabular-nums text-slate-900">{row.confidence}%</p>
          <p className="text-xs text-slate-500">
            {humanize(row.method)}
            {row.evidence?.countryMatch ? ' · same country' : ''}
            {Number(row.evidence?.candidates) > 1 ? ` · ${row.evidence?.candidates} candidates` : ''}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge tone={STATUS_TONE[row.status]}>{humanize(row.status)}</StatusBadge> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          {row.status !== 'CONFIRMED' && (
            <Button size="sm" onClick={() => review(row, 'CONFIRMED')} loading={busyId === row.id}>
              Confirm
            </Button>
          )}
          {row.status !== 'REJECTED' && (
            <Button size="sm" variant="secondary" onClick={() => review(row, 'REJECTED')} disabled={busyId === row.id}>
              Reject
            </Button>
          )}
          {row.status !== 'PROPOSED' && (
            <Button size="sm" variant="ghost" onClick={() => review(row, 'PROPOSED')} disabled={busyId === row.id}>
              Reopen
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Identity mapping"
        description="Links Latiyal players, teams and venues to the Cricsheet history. The AI only uses confirmed links."
        actions={
          <Button variant="secondary" size="sm" onClick={propose} loading={proposing}>
            Propose {kind}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {KINDS.map((k) => (
          <Button
            key={k.id}
            size="sm"
            variant={k.id === kind ? 'primary' : 'secondary'}
            onClick={() => {
              setKind(k.id);
              setPage(1);
              setNotice(null);
            }}
          >
            {k.label}
            {summary.data ? ` (${formatNumber(summary.data.mappings[k.id].CONFIRMED)} confirmed)` : ''}
          </Button>
        ))}
      </div>

      {summary.data && summary.data.history.people === 0 && (
        <div className="mb-4">
          <InlineNotice>The Cricsheet history is empty. Import it first (npm run history:import), then propose matches.</InlineNotice>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field label="Status" htmlFor="identity-status">
            <Select
              id="identity-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as MapStatus | '');
                setPage(1);
              }}
            >
              <option value="">All ({formatNumber(counts ? counts.PROPOSED + counts.CONFIRMED + counts.REJECTED : null)})</option>
              <option value="PROPOSED">Proposed ({formatNumber(counts?.PROPOSED)})</option>
              <option value="CONFIRMED">Confirmed ({formatNumber(counts?.CONFIRMED)})</option>
              <option value="REJECTED">Rejected ({formatNumber(counts?.REJECTED)})</option>
            </Select>
          </Field>
        </div>
        <div className="w-72">
          <Field label="Search name" htmlFor="identity-search">
            <TextInput
              id="identity-search"
              value={search}
              placeholder={kind === 'venues' ? 'Live venue name' : 'Live or Cricsheet name'}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </Field>
        </div>
      </div>

      {list.loading ? (
        <LoadingState label="Loading mappings…" />
      ) : !list.data ? (
        <ErrorState error={list.error ?? 'No data'} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <EmptyState title="Nothing here" description="Run “Propose” to find matches by name, or add one by hand below." />
      ) : (
        <>
          <DataTable caption={`${kind} mappings`} columns={columns} rows={list.data} rowKey={(row) => row.id} busy={list.refreshing} />
          {list.meta && <Pagination meta={list.meta} onPageChange={setPage} />}
        </>
      )}

      <div className="mt-6">
        <ManualMapping kind={kind} onSaved={reloadAll} />
      </div>
    </>
  );
}

function ManualMapping({ kind, onSaved }: { kind: Kind; onSaved: () => void }) {
  const [liveId, setLiveId] = useState('');
  const [liveCity, setLiveCity] = useState('');
  const [histId, setHistId] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [lookup, setLookup] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = useDebounced(lookup.trim());
  const results = useApi<Side[]>(term.length >= 2 ? `/admin/identity/${kind}/history-search` : null, { query: { q: term } });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const body =
      kind === 'players'
        ? { latiyalPlayerId: Number(liveId), histPersonId: histId.trim() }
        : kind === 'teams'
          ? { latiyalTeamId: Number(liveId), histTeamId: Number(histId), gender }
          : { liveVenueName: liveId, liveVenueCity: liveCity || undefined, histVenueId: Number(histId) };
    try {
      await apiRequest(`/admin/identity/${kind}`, { method: 'POST', body });
      setMessage('Saved as confirmed.');
      setHistId('');
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Add a confirmed mapping by hand" description="For players or venues the name matcher could not pair. Search the Cricsheet side to find its id.">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form onSubmit={submit} className="space-y-3">
          <Field label={kind === 'venues' ? 'Live venue name (as on matches)' : `Latiyal ${kind === 'players' ? 'player' : 'team'} id`} htmlFor="manual-live">
            <TextInput id="manual-live" value={liveId} onChange={(e) => setLiveId(e.target.value)} required />
          </Field>
          {kind === 'venues' && (
            <Field label="Live venue city" htmlFor="manual-city">
              <TextInput id="manual-city" value={liveCity} onChange={(e) => setLiveCity(e.target.value)} />
            </Field>
          )}
          {kind === 'teams' && (
            <Field label="Gender" htmlFor="manual-gender">
              <Select id="manual-gender" value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female')}>
                <option value="male">Men</option>
                <option value="female">Women</option>
              </Select>
            </Field>
          )}
          <Field label="Cricsheet id" htmlFor="manual-hist">
            <TextInput id="manual-hist" value={histId} onChange={(e) => setHistId(e.target.value)} required />
          </Field>
          <FormError message={error} />
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          <Button type="submit" loading={saving}>
            Save mapping
          </Button>
        </form>
        <div>
          <Field label="Find in Cricsheet" htmlFor="manual-lookup">
            <TextInput id="manual-lookup" value={lookup} placeholder="e.g. Kohli" onChange={(e) => setLookup(e.target.value)} />
          </Field>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {(term.length >= 2 ? (results.data ?? []) : []).map((item) => (
              <li key={String(item.id)} className="flex items-center justify-between py-1.5">
                <span>
                  {item.name} <span className="text-xs text-slate-500">{[item.id, item.detail].filter(Boolean).join(' · ')}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setHistId(String(item.id))}>
                  Use
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
