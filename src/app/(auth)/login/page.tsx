import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getStaffUser } from '@/lib/session';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · ProfitCosmos Omega' };

export default async function LoginPage() {
  if (await getStaffUser(await headers())) redirect('/admin');

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">ProfitCosmos Omega</h1>
        <p className="mt-1 text-sm text-slate-500">Staff sign in</p>
        <LoginForm />
      </div>
    </main>
  );
}
