'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z' },
  { href: '/matches', label: 'Live matches', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v4.59l3.2 3.2-1.41 1.42L11 12.41V7h2Z' },
  { href: '/devices', label: 'Devices', icon: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h10V5H7Zm5 14.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z' },
  { href: '/ads', label: 'Ads', icon: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v10h14V7H5Zm2 2h6v2H7V9Zm0 4h10v2H7v-2Z' },
];

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-60 transform bg-slate-900 text-slate-300 transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-500 text-sm font-bold text-white">CL</span>
        <div>
          <p className="text-sm font-semibold text-white">Cricket Live</p>
          <p className="text-xs text-slate-400">Admin</p>
        </div>
      </div>
      <nav className="mt-2 space-y-1 px-3" aria-label="Main">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60 hover:text-white'}`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 shrink-0" aria-hidden>
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <p className="absolute bottom-4 left-5 right-5 text-xs leading-relaxed text-slate-500">
        Scores are read-only. Sportmonks is the source of truth.
      </p>
    </aside>
  );
}
