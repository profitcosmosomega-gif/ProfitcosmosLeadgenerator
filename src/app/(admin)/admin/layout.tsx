import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRole } from '@/lib/rbac';
import { getStaffUser } from '@/lib/session';
import { SignOutButton } from './sign-out-button';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getStaffUser(await headers());
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/admin" className="font-semibold">
              ProfitCosmos Omega
            </Link>
            <Link href="/admin/leads" className="text-slate-600 hover:text-slate-900">
              Leads
            </Link>
            {hasRole(user.role, 'admin') ? (
              <Link href="/admin/leads/import" className="text-slate-600 hover:text-slate-900">
                Import
              </Link>
            ) : null}
          </nav>
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
