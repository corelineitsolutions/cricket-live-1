'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { apiRequest } from '@/lib/api';
import {
  clearSession,
  createSession,
  isSessionValid,
  loadSession,
  saveSession,
  SESSION_EXPIRED_EVENT,
  subscribeSession,
  type Session,
} from '@/lib/session';
import type { LoginResponse } from '@/lib/types';
import { useClientValue } from '@/lib/use-client-value';

interface AuthContextValue {
  session: Session | null;
  /** False until the stored session has been read on the client. */
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSyncExternalStore(subscribeSession, loadSession, () => null);
  const ready = useClientValue(() => true, false);

  const logout = useCallback(() => {
    clearSession();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    const onExpired = () => {
      clearSession();
      if (pathname !== '/login') {
        router.replace(`/login?next=${encodeURIComponent(pathname)}&expired=1`);
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [pathname, router]);

  useEffect(() => {
    if (!session) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (!isSessionValid(session)) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await apiRequest<LoginResponse>('/admin/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    saveSession(createSession(data.accessToken, email.trim().toLowerCase()));
  }, []);

  const value = useMemo(() => ({ session, ready, login, logout }), [session, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
