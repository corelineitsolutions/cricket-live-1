'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Field, FormError, TextInput } from '@/components/ui/form';
import { InlineNotice } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/redirect';
import { useClientValue } from '@/lib/use-client-value';

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Sign-in failed. Please try again.';
  }
  if (error.status === 429) {
    const minutes = error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : null;
    return minutes ? `${error.message} (about ${minutes} min).` : error.message;
  }
  if (error.status === 400) {
    return 'Enter a valid email and a password of at least 8 characters.';
  }
  return error.message;
}

function nextPath(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

export default function LoginPage() {
  const { session, ready, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = useClientValue(() => new URLSearchParams(window.location.search).has('expired'), false);

  useEffect(() => {
    if (ready && session) {
      router.replace(nextPath());
    }
  }, [ready, session, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      setPassword('');
    } catch (caught) {
      setError(loginErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">CL</span>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Cricket Live Admin</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in with your administrator account.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200" noValidate>
          {expired && !error && <InlineNotice tone="info">Your session has expired. Please sign in again.</InlineNotice>}
          <FormError message={error} />
          <Field label="Email" htmlFor="email">
            <TextInput
              id="email"
              type="email"
              autoComplete="username"
              required
              maxLength={255}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <TextInput
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" loading={submitting} disabled={!email || !password}>
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">After 5 failed attempts the account is locked for 15 minutes.</p>
      </div>
    </main>
  );
}
