import type { ReactNode } from 'react';

/** White card with an optional title row, used to group related information. */
export function Panel({ title, description, actions, children }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** Label/value rows, for detail views. */
export function DescriptionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-slate-100">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-3 gap-4 py-2.5 text-sm">
          <dt className="text-slate-500">{item.label}</dt>
          <dd className="col-span-2 break-words text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
