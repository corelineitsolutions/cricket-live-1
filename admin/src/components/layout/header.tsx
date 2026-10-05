'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';

export function Header({ onMenu }: { onMenu: () => void }) {
  const { session, logout } = useAuth();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button type="button" onClick={onMenu} className="rounded p-2 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
          <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
        </svg>
      </button>
      <div className="ml-auto flex items-center gap-3">
        {session && <span className="hidden text-sm text-slate-500 sm:inline">{session.email}</span>}
        <Button variant="secondary" size="sm" onClick={logout}>
          Sign out
        </Button>
      </div>
    </header>
  );
}

/** Page title row with optional actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
