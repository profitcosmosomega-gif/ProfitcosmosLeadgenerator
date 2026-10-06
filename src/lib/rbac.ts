import { Errors } from './errors';

/** Staff roles, lowest privilege first. */
export const STAFF_ROLES = ['viewer', 'sales', 'admin', 'owner'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const RANK: Record<StaffRole, number> = { viewer: 0, sales: 1, admin: 2, owner: 3 };

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Roles are hierarchical: an owner can do everything an admin can, and so on. */
export function hasRole(actual: StaffRole, required: StaffRole): boolean {
  return RANK[actual] >= RANK[required];
}

export function assertRole(actual: StaffRole, required: StaffRole): void {
  if (!hasRole(actual, required)) {
    throw Errors.forbidden();
  }
}
