'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/client/auth-client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
