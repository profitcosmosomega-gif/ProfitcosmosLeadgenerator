import { z } from 'zod';
import { aiConfig } from '@config/ai';
import { CURRENT_CONSENT_WORDING } from '@config/consent';
import { attributionInput, emailField } from '@/modules/leads/schemas';

/** Pre-chat form: who is chatting. Same adult and consent rules as the public lead form. */
export const startConversationInput = z
  .object({
    fullName: z.string().trim().max(200).optional(),
    email: emailField,
    ageConfirmed18plus: z.literal(true, { message: 'You must be 18 or older' }),
    consent: z
      .object({
        wordingVersion: z.literal(CURRENT_CONSENT_WORDING.version, {
          message: 'Consent wording is out of date; reload the page',
        }),
        marketingEmail: z.boolean().default(false),
      })
      .strict(),
    attribution: attributionInput.optional(),
    /** Honeypot: hidden from people, filled in by bots. */
    website: z.string().max(500).optional(),
  })
  .strict();

export const sendMessageInput = z
  .object({ text: z.string().trim().min(1).max(aiConfig.maxLeadMessageChars) })
  .strict();

export const listMessagesQuery = z.object({ after: z.uuid().optional() });

/** `Authorization: Bearer <token>` for the conversation. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  const match = header ? /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(header) : null;
  return match?.[1] ?? null;
}
