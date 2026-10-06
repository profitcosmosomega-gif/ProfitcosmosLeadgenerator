import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getStaffUser } from '@/lib/session';
import { SignOutButton } from './sign-out-button';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getStaffUser(await headers());
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="font-semibold">ProfitCosmos Omega</span>
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <span>
              {user.name} · <span className="uppercase">{user.role}</span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
