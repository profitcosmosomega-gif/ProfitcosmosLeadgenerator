import { createHash } from 'node:crypto';
import { z } from 'zod';

const emailSchema = z.email();

/** Trim and lower-case an email address. Returns null if it is not a valid address. */
export function normalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  return emailSchema.safeParse(value).success ? value : null;
}

/**
 * Normalise a phone number to E.164 (`+` followed by 8–15 digits).
 * International format is required (`+44 20 …` or `0044 20 …`); numbers without a country code
 * are rejected rather than guessed. Spaces, dashes, dots and brackets are ignored.
 */
export function normalizePhone(input: string): string | null {
  let value = input.trim().replace(/[\s\-().]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
}

/** SHA-256 of a normalised contact value, used by the suppression list. */
export function hashContact(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
