import type { PaginationMeta } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { Button } from './button';

export function Pagination({ meta, onPageChange }: { meta: PaginationMeta; onPageChange: (page: number) => void }) {
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);
  return (
    <nav className="flex items-center justify-between gap-4 px-1 py-3 text-sm text-slate-600" aria-label="Pagination">
      <p>
        {meta.total === 0 ? 'No results' : (
          <>
            Showing <span className="font-medium text-slate-900">{formatNumber(first)}</span>–
            <span className="font-medium text-slate-900">{formatNumber(last)}</span> of{' '}
            <span className="font-medium text-slate-900">{formatNumber(meta.total)}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
          Previous
        </Button>
        <span className="tabular-nums">
          Page {meta.page} of {Math.max(1, meta.totalPages)}
        </span>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
