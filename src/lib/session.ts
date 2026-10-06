import { getAuth } from './auth';
import { Errors } from './errors';
import { assertRole, isStaffRole, type StaffRole } from './rbac';

export interface StaffUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: StaffRole;
}

/** Resolve the signed-in staff user from request headers (session cookie), or null. */
export async function getStaffUser(headers: Headers): Promise<StaffUser | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const { user } = result;
  if (!isStaffRole(user.role) || typeof user.organizationId !== 'string') return null;
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

/** Require a signed-in staff user with at least `minRole`. Throws 401 / 403 AppErrors. */
export async function requireStaffUser(
  headers: Headers,
  minRole: StaffRole = 'viewer',
): Promise<StaffUser> {
  const user = await getStaffUser(headers);
  if (!user) throw Errors.unauthenticated();
  assertRole(user.role, minRole);
  return user;
}
