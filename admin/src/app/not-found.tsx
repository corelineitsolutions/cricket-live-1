import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold text-indigo-600">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <Link href="/dashboard" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
        Back to the dashboard
      </Link>
    </main>
  );
}
