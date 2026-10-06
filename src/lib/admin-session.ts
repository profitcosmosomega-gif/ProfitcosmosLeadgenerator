import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRole, type StaffRole } from './rbac';
import { getStaffUser, type StaffUser } from './session';

/** For admin pages: the signed-in staff user, or a redirect to /login (or /admin if too junior). */
export async function requirePageUser(minRole: StaffRole = 'viewer'): Promise<StaffUser> {
  const user = await getStaffUser(await headers());
  if (!user) redirect('/login');
  if (!hasRole(user.role, minRole)) redirect('/admin');
  return user;
}
