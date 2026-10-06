import { z } from 'zod';
import { CURRENT_CONSENT_WORDING } from '@config/consent';
import { attributionInput, emailField, phoneField } from './schemas';

/** Body accepted from website / landing-page lead forms. */
export const publicLeadInput = z
  .object({
    fullName: z.string().trim().max(200).optional(),
    email: emailField,
    phone: phoneField.optional(),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter ISO country code')
      .transform((v) => v.toUpperCase())
      .optional(),
    experienceLevel: z.enum(['beginner', 'intermediate', 'experienced']).optional(),
    marketsOfInterest: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    // Prospects must be adults. Minors' data is never stored.
    ageConfirmed18plus: z.literal(true, { message: 'You must be 18 or older' }),
    consent: z
      .object({
        wordingVersion: z.literal(CURRENT_CONSENT_WORDING.version, {
          message: 'Consent wording is out of date; reload the form',
        }),
        marketingEmail: z.boolean().default(false),
        marketingSms: z.boolean().default(false),
        marketingWhatsapp: z.boolean().default(false),
      })
      .strict(),
    attribution: attributionInput.optional(),
    /** Honeypot: hidden from people, filled in by bots. */
    website: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.phone || (!v.consent.marketingSms && !v.consent.marketingWhatsapp), {
    message: 'A phone number is needed for SMS or WhatsApp consent',
    path: ['phone'],
  });

export type PublicLeadInput = z.infer<typeof publicLeadInput>;
