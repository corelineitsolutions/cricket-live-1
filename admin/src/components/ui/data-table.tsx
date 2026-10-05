import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Dims the table while a refresh is in flight. */
  busy?: boolean;
  caption?: string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, busy = false, caption }: DataTableProps<T>) {
  return (
    <div className={`overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200 transition-opacity ${busy ? 'opacity-60' : ''}`}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${column.className ?? ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => event.key === 'Enter' && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={onRowClick ? 'cursor-pointer hover:bg-indigo-50/50 focus:bg-indigo-50 focus:outline-none' : 'hover:bg-slate-50/60'}
            >
              {columns.map((column) => (
                <td key={column.key} className={`whitespace-nowrap px-4 py-3 text-slate-700 ${column.className ?? ''}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
