import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { assertRole, hasRole, isStaffRole } from '@/lib/rbac';

describe('rbac', () => {
  it('is hierarchical', () => {
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('sales', 'admin')).toBe(false);
    expect(hasRole('viewer', 'sales')).toBe(false);
    expect(hasRole('viewer', 'viewer')).toBe(true);
  });

  it('throws a 403 AppError when the role is insufficient', () => {
    expect(() => assertRole('viewer', 'admin')).toThrow(AppError);
    try {
      assertRole('sales', 'owner');
    } catch (err) {
      expect((err as AppError).status).toBe(403);
    }
  });

  it('recognises valid roles only', () => {
    expect(isStaffRole('admin')).toBe(true);
    expect(isStaffRole('superuser')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});
