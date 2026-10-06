import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { accounts, organizations, users } from '@/db/schema';
import { seedFoundation } from '@/db/seed';
import { getDefaultOrganization } from '@/modules/organizations/service';
import { resetDb } from '../helpers/db';

const input = {
  organization: { slug: 'profitcosmos-omega', name: 'ProfitCosmos Omega Academy' },
  owner: { email: 'Owner@Example.test', name: 'Owner', password: 'a-very-long-password' },
};

beforeEach(resetDb);
afterAll(closeDb);

describe('seedFoundation', () => {
  it('creates the organization and an owner with a hashed credential', async () => {
    const { organization, owner } = await seedFoundation(getDb(), input);
    expect(owner.role).toBe('owner');
    expect(owner.email).toBe('owner@example.test');
    expect(owner.organizationId).toBe(organization.id);

    const [account] = await getDb().select().from(accounts).where(eq(accounts.userId, owner.id));
    expect(account?.providerId).toBe('credential');
    expect(account?.password).not.toContain(input.owner.password);

    expect((await getDefaultOrganization(getDb())).id).toBe(organization.id);
  });

  it('is idempotent', async () => {
    await seedFoundation(getDb(), input);
    await seedFoundation(getDb(), input);
    expect(await getDb().$count(organizations)).toBe(1);
    expect(await getDb().$count(users)).toBe(1);
  });

  it('rejects short passwords', async () => {
    await expect(
      seedFoundation(getDb(), { ...input, owner: { ...input.owner, password: 'short' } }),
    ).rejects.toThrow('at least 12');
  });
});
