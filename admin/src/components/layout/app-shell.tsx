'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth-provider';
import { LoadingState } from '@/components/ui/states';
import { Header } from './header';
import { Sidebar } from './sidebar';

/** Authenticated layout. Redirects to /login when there is no valid session. */
export function AppShell({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (ready && !session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, session, router, pathname]);

  if (!ready || !session) {
    return <LoadingState label="Checking session…" />;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
