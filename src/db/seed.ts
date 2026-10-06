import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { StaffRole } from '../lib/rbac';
import type { Database } from './client';
import { accounts, organizations, users, type Organization, type User } from './schema';

export interface StaffUserInput {
  organizationId: string;
  email: string;
  name: string;
  password: string;
  role: StaffRole;
}

export async function ensureOrganization(
  db: Database,
  input: { slug: string; name: string },
): Promise<Organization> {
  await db.insert(organizations).values(input).onConflictDoNothing({ target: organizations.slug });
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, input.slug));
  if (!org) throw new Error(`Failed to create organization ${input.slug}`);
  return org;
}

/**
 * Create a staff user with an email+password credential (public sign-up is disabled).
 * Returns the existing user unchanged if the email is already registered.
 */
export async function ensureStaffUser(db: Database, input: StaffUserInput): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing;

  if (input.password.length < 12) {
    throw new Error('Staff passwords must be at least 12 characters');
  }
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organizationId: input.organizationId,
        email,
        name: input.name,
        role: input.role,
        emailVerified: true,
      })
      .returning();
    if (!user) throw new Error('Failed to create user');
    await tx.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: passwordHash,
    });
    return user;
  });
}

export interface SeedInput {
  organization: { slug: string; name: string };
  owner: { email: string; name: string; password: string };
}

/** Idempotent foundation seed: the ProfitCosmos Omega organization and its owner account. */
export async function seedFoundation(db: Database, input: SeedInput) {
  const organization = await ensureOrganization(db, input.organization);
  const owner = await ensureStaffUser(db, {
    ...input.owner,
    organizationId: organization.id,
    role: 'owner',
  });
  return { organization, owner };
}
