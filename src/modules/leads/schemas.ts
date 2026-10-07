import { z } from 'zod';
import { ALL_STAGES } from '@config/pipeline';
import { normalizeEmail, normalizePhone } from './normalize';

const shortText = (max = 200) => z.string().trim().min(1).max(max);
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const emailField = z
  .string()
  .max(320)
  .transform((value, ctx) => {
    const email = normalizeEmail(value);
    if (!email) {
      ctx.addIssue({ code: 'custom', message: 'Invalid email address' });
      return z.NEVER;
    }
    return email;
  });

export const phoneField = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({
        code: 'custom',
        message: 'Phone must be in international format, e.g. +44 20 7946 0958',
      });
      return z.NEVER;
    }
    return phone;
  });

const stringList = z.array(shortText(100)).max(20);

export const qualificationInput = z
  .object({
    experienceLevel: z.enum(['unknown', 'beginner', 'intermediate', 'experienced']),
    marketsOfInterest: stringList,
    mainDifficulties: stringList,
    goals: stringList,
    reasonForTraining: optionalText(1000),
    previousTraining: optionalText(1000),
    desiredStart: z.enum(['unknown', 'now', '30d', '90d', 'later']),
    mentorshipInterest: z.enum(['unknown', 'yes', 'maybe', 'no']),
  })
  .partial()
  .strict();

export type QualificationInput = z.infer<typeof qualificationInput>;

const contactFields = {
  fullName: optionalText(200),
  email: emailField.nullable().optional(),
  phone: phoneField.nullable().optional(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter ISO country code')
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  timezone: optionalText(64),
  locale: optionalText(16),
  ageConfirmed18plus: z.boolean().nullable().optional(),
};

/** Staff: create a lead by hand. Stage is never accepted here (always the initial stage). */
export const createLeadInput = z
  .object({
    ...contactFields,
    source: optionalText(100),
    ownerUserId: z.uuid().nullable().optional(),
    qualification: qualificationInput.optional(),
  })
  .strict()
  .refine((v) => v.email || v.phone, {
    message: 'Provide an email or a phone number',
    path: ['email'],
  });

export type CreateLeadInput = z.infer<typeof createLeadInput>;

/** Staff: edit a lead. Stage changes go through the transition endpoint, not here. */
export const updateLeadInput = z
  .object({
    ...contactFields,
    ownerUserId: z.uuid().nullable().optional(),
    qualification: qualificationInput.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export type UpdateLeadInput = z.infer<typeof updateLeadInput>;

export const transitionInput = z
  .object({
    to: z.enum(ALL_STAGES),
    reason: optionalText(500),
  })
  .strict();

export const noteInput = z.object({ body: shortText(5000) }).strict();

export const consentInput = z
  .object({
    channel: z.enum(['email', 'sms', 'whatsapp', 'phone']),
    purpose: z.enum(['transactional', 'marketing']),
    status: z.enum(['granted', 'revoked']),
    note: optionalText(500),
  })
  .strict();

export const attributionInput = z
  .object({
    source: optionalText(100),
    medium: optionalText(100),
    campaign: optionalText(200),
    content: optionalText(200),
    term: optionalText(200),
    landingPage: z.url().max(2000).nullable().optional(),
    referrer: z.url().max(2000).nullable().optional(),
    clickIds: z
      .object({
        gclid: shortText(500),
        fbclid: shortText(500),
        ttclid: shortText(500),
        msclkid: shortText(500),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export type AttributionInput = z.infer<typeof attributionInput>;

export const listLeadsQuery = z.object({
  stage: z.enum(ALL_STAGES).optional(),
  ownerUserId: z.union([z.uuid(), z.literal('unassigned')]).optional(),
  source: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  /** `open`: only leads with an open AI escalation flag. */
  escalation: z.literal('open').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type ListLeadsQuery = z.infer<typeof listLeadsQuery>;

export const mergeInput = z
  .object({ targetLeadId: z.uuid(), sourceLeadId: z.uuid() })
  .strict()
  .refine((v) => v.targetLeadId !== v.sourceLeadId, {
    message: 'Cannot merge a lead into itself',
    path: ['sourceLeadId'],
  });
