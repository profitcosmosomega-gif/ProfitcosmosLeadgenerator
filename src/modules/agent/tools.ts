import { z } from 'zod';
import type { AiToolCallRecord, EscalationReason, LeadQualification, Message } from '@/db/schema';
import { phoneField } from '@/modules/leads/schemas';
import type { QualificationInput } from '@/modules/leads/schemas';
import type { EvidenceDetail } from '@/modules/leads/service';
import type { LlmToolDefinition } from '@/providers/llm/types';
import { toolInputSchema } from './schema';

/*
 * The agent's allow-listed tools. Each input is validated with Zod; effects are only *planned*
 * here and applied by the pipeline in one transaction, through the CRM services, after the turn.
 * Tools act on the conversation's own lead, which comes from the job — never from model output.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const list = z.array(text(60)).min(1).max(10);
const quote = z
  .string()
  .trim()
  .min(2)
  .max(300)
  .describe("Short passage copied word for word from the prospect's message that states the value");

export const QUALIFICATION_FIELDS = [
  'desiredStart',
  'mentorshipInterest',
  'experienceLevel',
  'goals',
  'mainDifficulties',
  'marketsOfInterest',
  'reasonForTraining',
  'previousTraining',
] as const;
export type QualificationField = (typeof QUALIFICATION_FIELDS)[number];

const recordQualificationInput = z
  .object({
    fields: z
      .object({
        experienceLevel: z.enum(['beginner', 'intermediate', 'experienced']),
        marketsOfInterest: list,
        mainDifficulties: list,
        goals: list,
        reasonForTraining: text(300),
        previousTraining: text(300),
        desiredStart: z.enum(['now', '30d', '90d', 'later']),
        mentorshipInterest: z.enum(['yes', 'maybe', 'no']),
      })
      .partial()
      .strict()
      .refine((fields) => Object.keys(fields).length > 0, 'Provide at least one field'),
    quote,
  })
  .strict();

const updateContactInput = z
  .object({
    fullName: text(200).optional(),
    phone: phoneField.optional(),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase())
      .optional(),
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), 'Unknown IANA time zone')
      .optional(),
    quote,
  })
  .strict()
  .refine((v) => v.fullName || v.phone || v.country || v.timezone, 'Provide at least one field');

export const AGENT_ESCALATION_REASONS = [
  'human_requested',
  'cannot_confirm',
  'sensitive_topic',
  'possible_underage',
  'abusive',
] as const satisfies readonly EscalationReason[];

const requestHumanInput = z.object({ reason: z.enum(AGENT_ESCALATION_REASONS) }).strict();
const getLeadContextInput = z.object({}).strict();

export const agentTools: LlmToolDefinition[] = [
  {
    name: 'get_lead_context',
    description:
      'Check which qualification details are already known and which are still missing for this prospect.',
    inputSchema: toolInputSchema(getLeadContextInput),
  },
  {
    name: 'record_qualification',
    description:
      'Record qualification details the prospect stated, with a word-for-word quote from their message. Only record what they actually said.',
    inputSchema: toolInputSchema(recordQualificationInput),
  },
  {
    name: 'update_contact',
    description:
      'Record contact details the prospect gave (name, phone, 2-letter country code, IANA time zone), with a word-for-word quote. Existing details are never overwritten.',
    inputSchema: toolInputSchema(updateContactInput),
  },
  {
    name: 'request_human',
    description:
      'Flag the conversation for a member of the team and stop the assistant. Use for: a request for a human, a question you cannot confirm (programs, prices, policies…), a sensitive topic, a prospect who may be under 18, or abuse.',
    inputSchema: toolInputSchema(requestHumanInput),
  },
];

// ---------------------------------------------------------------------------------------------
// Quote verification
// ---------------------------------------------------------------------------------------------

function normalizeWithMap(input: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (/\s/.test(char)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(i);
      pendingSpace = false;
    }
    const normalized = char
      .replace(/[’‘`´]/g, "'")
      .replace(/[“”«»]/g, '"')
      .toLowerCase();
    for (const c of normalized) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

export interface QuoteLocation {
  messageId: string;
  start: number;
  end: number;
}

/**
 * Find a quote in the lead's own persisted messages (newest first), ignoring case, spacing and
 * typographic quotes. Returns its character range in the original message, or null.
 */
export function locateQuote(leadMessages: Message[], quoteText: string): QuoteLocation | null {
  const needle = normalizeWithMap(quoteText).text;
  if (needle.length < 2) return null;
  for (const message of [...leadMessages].reverse()) {
    if (message.author !== 'lead' || !message.body) continue;
    const haystack = normalizeWithMap(message.body);
    const index = haystack.text.indexOf(needle);
    if (index === -1) continue;
    return {
      messageId: message.id,
      start: haystack.map[index]!,
      end: haystack.map[index + needle.length - 1]! + 1,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------

/** Effects accepted during a turn, applied by the pipeline after the turn. */
export interface TurnEffects {
  qualification: QualificationInput;
  qualificationEvidence: Partial<Record<QualificationField, Omit<EvidenceDetail, 'aiRunId'>>>;
  contact: { fullName?: string; phone?: string; country?: string; timezone?: string };
  escalations: { reason: EscalationReason; messageId: string | null }[];
}

export function emptyEffects(): TurnEffects {
  return { qualification: {}, qualificationEvidence: {}, contact: {}, escalations: [] };
}

export interface ToolContext {
  leadMessages: Message[];
  /** Message that triggered the turn (latest unhandled lead message). */
  triggerMessageId: string;
  qualification: LeadQualification | null;
  /** Ids of this conversation's messages, to tell which values were collected in it. */
  conversationMessageIds: Set<string>;
  contactKnown: { fullName: boolean; phone: boolean; country: boolean; timezone: boolean };
}

export interface ToolOutcome {
  record: AiToolCallRecord;
  /** JSON string returned to the model. Never contains other leads' data or internals. */
  result: string;
  isError: boolean;
}

const FIELD_SOURCES_PROTECTED = new Set(['staff', 'form', 'import', 'chat']);

/**
 * Snapshot for the model: values collected in this conversation, names of fields known from
 * other sources (values withheld, since the chat visitor may not be the person on file), and
 * missing fields in priority order.
 */
export function leadContextSnapshot(context: ToolContext, effects: TurnEffects) {
  const collected: Record<string, unknown> = {};
  const knownElsewhere: string[] = [];
  const missing: string[] = [];
  const q = context.qualification;
  for (const field of QUALIFICATION_FIELDS) {
    const pending = effects.qualification[field];
    const value = pending ?? q?.[field];
    const empty =
      value === null ||
      value === undefined ||
      value === 'unknown' ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      missing.push(field);
      continue;
    }
    const evidence = q?.evidence?.[field];
    const fromThisChat =
      pending !== undefined ||
      (evidence?.source === 'ai' &&
        evidence.messageId !== undefined &&
        context.conversationMessageIds.has(evidence.messageId));
    if (fromThisChat) collected[field] = value;
    else knownElsewhere.push(field);
  }
  return { collected, knownElsewhere, missing };
}

function ok(name: string, body: Record<string, unknown>): ToolOutcome {
  return { record: { name, outcome: 'accepted' }, result: JSON.stringify(body), isError: false };
}

function rejected(name: string, code: string, outcome: AiToolCallRecord['outcome'] = 'rejected') {
  return {
    record: { name, outcome, code },
    result: JSON.stringify({ status: 'rejected', reason: code }),
    isError: true,
  };
}

/** Validate and plan one tool call. Unknown tools and invalid input are rejected, not thrown. */
export function executeTool(
  name: string,
  input: unknown,
  context: ToolContext,
  effects: TurnEffects,
): ToolOutcome {
  switch (name) {
    case 'get_lead_context': {
      if (!getLeadContextInput.safeParse(input ?? {}).success) {
        return rejected(name, 'invalid_input', 'invalid');
      }
      return ok(name, leadContextSnapshot(context, effects));
    }

    case 'record_qualification': {
      const parsed = recordQualificationInput.safeParse(input);
      if (!parsed.success) return rejected(name, 'invalid_input', 'invalid');
      const location = locateQuote(context.leadMessages, parsed.data.quote);
      if (!location) return rejected(name, 'quote_not_found');
      const accepted: string[] = [];
      const protectedFields: string[] = [];
      for (const [field, value] of Object.entries(parsed.data.fields) as [
        QualificationField,
        unknown,
      ][]) {
        const existingSource = context.qualification?.evidence?.[field]?.source;
        const existing = context.qualification?.[field];
        const hasValue =
          existing !== null &&
          existing !== undefined &&
          existing !== 'unknown' &&
          !(Array.isArray(existing) && existing.length === 0);
        // Staff, form and import values are stronger than the AI's: never replaced.
        if (hasValue && (!existingSource || FIELD_SOURCES_PROTECTED.has(existingSource))) {
          protectedFields.push(field);
          continue;
        }
        Object.assign(effects.qualification, { [field]: value });
        effects.qualificationEvidence[field] = {
          messageId: location.messageId,
          quoteStart: location.start,
          quoteEnd: location.end,
        };
        accepted.push(field);
      }
      if (accepted.length === 0) return rejected(name, 'already_known');
      return ok(name, {
        status: 'recorded',
        fields: accepted,
        ...(protectedFields.length ? { alreadyKnown: protectedFields } : {}),
      });
    }

    case 'update_contact': {
      const parsed = updateContactInput.safeParse(input);
      if (!parsed.success) return rejected(name, 'invalid_input', 'invalid');
      if (!locateQuote(context.leadMessages, parsed.data.quote)) {
        return rejected(name, 'quote_not_found');
      }
      const accepted: string[] = [];
      for (const field of ['fullName', 'phone', 'country', 'timezone'] as const) {
        const value = parsed.data[field];
        if (value === undefined || context.contactKnown[field]) continue;
        effects.contact[field] = value;
        accepted.push(field);
      }
      if (accepted.length === 0) return rejected(name, 'already_known');
      return ok(name, { status: 'recorded', fields: accepted });
    }

    case 'request_human': {
      const parsed = requestHumanInput.safeParse(input);
      if (!parsed.success) return rejected(name, 'invalid_input', 'invalid');
      if (!effects.escalations.some((e) => e.reason === parsed.data.reason)) {
        effects.escalations.push({
          reason: parsed.data.reason,
          messageId: context.triggerMessageId,
        });
      }
      return ok(name, {
        status: 'flagged',
        note: 'A member of the team will follow up. Tell the prospect so briefly and do not continue qualifying.',
      });
    }

    default:
      return rejected(name, 'unknown_tool', 'unknown_tool');
  }
}
