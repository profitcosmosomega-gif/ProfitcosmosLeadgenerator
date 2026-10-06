import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import { pipelineConfig } from '@config/pipeline';
import type { Database, DbExecutor } from '@/db/client';
import {
  channelIdentities,
  consents,
  leadEvents,
  leadNotes,
  leadQualification,
  leads,
  stageTransitions,
  touchpoints,
  users,
  type Lead,
  type LeadQualification,
  type QualificationEvidence,
  type Touchpoint,
} from '@/db/schema';
import { Errors } from '@/lib/errors';
import { recordTouchpoint } from '@/modules/attribution/service';
import { addToSuppressionList, currentConsents, isSuppressed } from '@/modules/consents/service';
import { allowedNextStages, recordInitialStage } from '@/modules/crm/service';
import { actorUserId, recordLeadHistory, type Actor } from './history';
import { findLead, findMutableLead } from './repository';
import type {
  AttributionInput,
  CreateLeadInput,
  ListLeadsQuery,
  QualificationInput,
  UpdateLeadInput,
} from './schemas';

export const CONTACT_FIELDS = [
  'fullName',
  'email',
  'phone',
  'country',
  'timezone',
  'locale',
  'ageConfirmed18plus',
] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];
export type ContactInput = Partial<Record<ContactField, unknown>> & {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  timezone?: string | null;
  locale?: string | null;
  ageConfirmed18plus?: boolean | null;
};

type QualificationField = keyof QualificationInput;
type EvidenceSource = QualificationEvidence['source'];

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === 'unknown' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Work out which qualification fields change. With `fillOnly`, existing non-empty values are kept
 * (used for form submissions and imports, which must never overwrite staff edits).
 */
function qualificationChanges(
  current: LeadQualification | undefined,
  input: QualificationInput,
  options: { fillOnly: boolean; source: EvidenceSource; actor: Actor },
) {
  const values: Partial<Record<QualificationField, unknown>> = {};
  const evidence: Record<string, QualificationEvidence> = { ...(current?.evidence ?? {}) };
  const at = new Date().toISOString();
  for (const [field, value] of Object.entries(input) as [QualificationField, unknown][]) {
    if (value === undefined) continue;
    const existing = current?.[field];
    if (options.fillOnly && !isEmptyValue(existing)) continue;
    if (sameValue(existing, value)) continue;
    values[field] = value;
    const actorId = actorUserId(options.actor);
    evidence[field] = { source: options.source, at, ...(actorId ? { actorUserId: actorId } : {}) };
  }
  return { values, evidence, fields: Object.keys(values) };
}

async function assertOwnerInOrganization(
  tx: DbExecutor,
  organizationId: string,
  ownerUserId: string | null | undefined,
): Promise<void> {
  if (!ownerUserId) return;
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.organizationId, organizationId)));
  if (!owner) {
    throw Errors.validation('Owner must be a staff member of this organization', [
      { path: ['ownerUserId'], message: 'Unknown user' },
    ]);
  }
}

/** Find the active lead (not erased, not merged) holding this email or phone, email first. */
export async function findActiveLeadByContact(
  db: DbExecutor,
  organizationId: string,
  contact: { email?: string | null; phone?: string | null },
): Promise<Lead | undefined> {
  const active = and(
    eq(leads.organizationId, organizationId),
    isNull(leads.erasedAt),
    isNull(leads.mergedIntoLeadId),
  );
  for (const condition of [
    contact.email ? eq(leads.email, contact.email) : undefined,
    contact.phone ? eq(leads.phone, contact.phone) : undefined,
  ]) {
    if (!condition) continue;
    const [lead] = await db.select().from(leads).where(and(active, condition)).limit(1);
    if (lead) return lead;
  }
  return undefined;
}

function pickContact(input: ContactInput): Partial<Record<ContactField, unknown>> {
  const values: Partial<Record<ContactField, unknown>> = {};
  for (const field of CONTACT_FIELDS) {
    if (input[field] !== undefined) values[field] = input[field];
  }
  return values;
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

/**
 * Insert a new lead with its qualification row, initial stage, optional touchpoint and history.
 * Shared by staff creation, form capture and CSV import. Runs inside the caller's transaction.
 */
export async function insertLead(
  tx: DbExecutor,
  input: {
    organizationId: string;
    contact: ContactInput;
    ownerUserId?: string | null;
    qualification?: QualificationInput;
    channel: Touchpoint['channel'];
    attribution?: AttributionInput;
    actor: Actor;
  },
): Promise<Lead> {
  const contact = pickContact(input.contact);
  let lead: Lead | undefined;
  try {
    [lead] = await tx
      .insert(leads)
      .values({
        organizationId: input.organizationId,
        ...(contact as Partial<Lead>),
        ownerUserId: input.ownerUserId ?? null,
        stage: pipelineConfig.initialStage,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw Errors.conflict('Another lead already uses this email or phone number');
    }
    throw error;
  }
  if (!lead) throw new Error('Failed to create lead');

  const source: EvidenceSource = input.channel;
  const qualification = qualificationChanges(undefined, input.qualification ?? {}, {
    fillOnly: false,
    source,
    actor: input.actor,
  });
  await tx.insert(leadQualification).values({
    leadId: lead.id,
    organizationId: lead.organizationId,
    ...(qualification.values as Partial<LeadQualification>),
    evidence: qualification.evidence,
  });

  await recordInitialStage(tx, lead, input.actor);

  const hasAttribution = Object.values(input.attribution ?? {}).some((v) => v != null);
  if (input.channel !== 'staff' || hasAttribution) {
    await recordTouchpoint(tx, lead, input.channel, input.attribution);
  }

  await recordLeadHistory(tx, {
    organizationId: lead.organizationId,
    leadId: lead.id,
    type: 'lead.created',
    actor: input.actor,
    payload: {
      channel: input.channel,
      fields: [...Object.keys(contact), ...qualification.fields],
    },
  });

  return findLead(tx, lead.organizationId, lead.id);
}

/** Staff: create a lead by hand. */
export async function createLead(
  db: Database,
  organizationId: string,
  input: CreateLeadInput,
  actor: Actor,
): Promise<Lead> {
  return db.transaction(async (tx) => {
    if (await isSuppressed(tx, organizationId, input)) {
      throw Errors.conflict('This contact is on the do-not-contact list');
    }
    const existing = await findActiveLeadByContact(tx, organizationId, input);
    if (existing) {
      throw Errors.conflict('A lead with this email or phone number already exists', {
        leadId: existing.id,
      });
    }
    await assertOwnerInOrganization(tx, organizationId, input.ownerUserId);
    return insertLead(tx, {
      organizationId,
      contact: input,
      ownerUserId: input.ownerUserId,
      qualification: input.qualification,
      channel: 'staff',
      attribution: input.source ? { source: input.source } : undefined,
      actor,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------------------------

/**
 * Apply contact and qualification changes to a locked, mutable lead and record history.
 * `fillOnly` keeps existing values (form/import). Returns the changed field names.
 */
export async function applyLeadChanges(
  tx: DbExecutor,
  lead: Lead,
  input: {
    contact?: ContactInput;
    ownerUserId?: string | null;
    qualification?: QualificationInput;
    fillOnly: boolean;
    source: EvidenceSource;
    actor: Actor;
    eventType: string;
    eventPayload?: Record<string, unknown>;
  },
): Promise<string[]> {
  const changes: Partial<Record<string, unknown>> = {};
  for (const [field, value] of Object.entries(pickContact(input.contact ?? {}))) {
    const existing = lead[field as ContactField];
    if (input.fillOnly && existing !== null && existing !== undefined) continue;
    if (sameValue(existing, value)) continue;
    changes[field] = value;
  }

  // Never take an email/phone that another active lead already holds (form/import).
  if (input.fillOnly && (changes.email || changes.phone)) {
    for (const field of ['email', 'phone'] as const) {
      const value = changes[field] as string | undefined;
      if (!value) continue;
      const holder = await findActiveLeadByContact(tx, lead.organizationId, { [field]: value });
      if (holder && holder.id !== lead.id) delete changes[field];
    }
  }

  if (input.ownerUserId !== undefined && input.ownerUserId !== lead.ownerUserId) {
    await assertOwnerInOrganization(tx, lead.organizationId, input.ownerUserId);
    changes.ownerUserId = input.ownerUserId;
  }

  const fields = Object.keys(changes);
  if (fields.length > 0) {
    try {
      await tx
        .update(leads)
        .set({ ...(changes as Partial<Lead>), lastActivityAt: new Date() })
        .where(eq(leads.id, lead.id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.conflict('Another lead already uses this email or phone number');
      }
      throw error;
    }
  }

  if (input.qualification && Object.keys(input.qualification).length > 0) {
    const [current] = await tx
      .select()
      .from(leadQualification)
      .where(eq(leadQualification.leadId, lead.id));
    const q = qualificationChanges(current, input.qualification, {
      fillOnly: input.fillOnly,
      source: input.source,
      actor: input.actor,
    });
    if (q.fields.length > 0) {
      await tx
        .update(leadQualification)
        .set({ ...(q.values as Partial<LeadQualification>), evidence: q.evidence })
        .where(eq(leadQualification.leadId, lead.id));
      fields.push(...q.fields.map((f) => `qualification.${f}`));
    }
  }

  if (fields.length > 0 || input.eventPayload) {
    await recordLeadHistory(tx, {
      organizationId: lead.organizationId,
      leadId: lead.id,
      type: input.eventType,
      actor: input.actor,
      payload: { ...input.eventPayload, fields },
    });
  }
  return fields;
}

/** Staff: edit contact details, owner and qualification. Stage is changed only via the CRM. */
export async function updateLead(
  db: Database,
  organizationId: string,
  leadId: string,
  input: UpdateLeadInput,
  actor: Actor,
): Promise<Lead> {
  return db.transaction(async (tx) => {
    const lead = await findMutableLead(tx, organizationId, leadId);
    await applyLeadChanges(tx, lead, {
      contact: input,
      ownerUserId: input.ownerUserId,
      qualification: input.qualification,
      fillOnly: false,
      source: 'staff',
      actor,
      eventType: 'lead.updated',
    });
    return findLead(tx, organizationId, leadId);
  });
}

// ---------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listLeads(db: Database, organizationId: string, query: ListLeadsQuery) {
  const conditions: SQL[] = [
    eq(leads.organizationId, organizationId),
    isNull(leads.erasedAt),
    isNull(leads.mergedIntoLeadId),
  ];
  if (query.stage) conditions.push(eq(leads.stage, query.stage));
  if (query.ownerUserId === 'unassigned') conditions.push(isNull(leads.ownerUserId));
  else if (query.ownerUserId) conditions.push(eq(leads.ownerUserId, query.ownerUserId));
  if (query.source) conditions.push(eq(leads.source, query.source));
  if (query.createdFrom) conditions.push(gte(leads.createdAt, query.createdFrom));
  if (query.createdTo) conditions.push(lte(leads.createdAt, query.createdTo));
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(
      or(ilike(leads.fullName, pattern), ilike(leads.email, pattern), ilike(leads.phone, pattern))!,
    );
  }
  const where = and(...conditions);

  const [items, [totals]] = await Promise.all([
    db
      .select({
        id: leads.id,
        fullName: leads.fullName,
        email: leads.email,
        phone: leads.phone,
        stage: leads.stage,
        source: leads.source,
        ownerUserId: leads.ownerUserId,
        ownerName: users.name,
        createdAt: leads.createdAt,
        lastActivityAt: leads.lastActivityAt,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerUserId))
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: count() }).from(leads).where(where),
  ]);

  return { items, total: totals?.total ?? 0, limit: query.limit, offset: query.offset };
}

export async function getLeadDetail(db: Database, organizationId: string, leadId: string) {
  const lead = await findLead(db, organizationId, leadId);
  const [qualification] = await db
    .select()
    .from(leadQualification)
    .where(eq(leadQualification.leadId, lead.id));
  const [owner] = lead.ownerUserId
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, lead.ownerUserId))
    : [];
  const [leadConsents, leadTouchpoints, notes] = await Promise.all([
    currentConsents(db, organizationId, [lead.id]),
    db
      .select()
      .from(touchpoints)
      .where(eq(touchpoints.leadId, lead.id))
      .orderBy(asc(touchpoints.occurredAt)),
    db
      .select({
        id: leadNotes.id,
        body: leadNotes.body,
        authorUserId: leadNotes.authorUserId,
        authorName: users.name,
        createdAt: leadNotes.createdAt,
      })
      .from(leadNotes)
      .leftJoin(users, eq(users.id, leadNotes.authorUserId))
      .where(eq(leadNotes.leadId, lead.id))
      .orderBy(desc(leadNotes.createdAt)),
  ]);

  const mutable = !lead.erasedAt && !lead.mergedIntoLeadId;
  return {
    lead,
    qualification: qualification ?? null,
    owner: owner ?? null,
    consents: leadConsents,
    touchpoints: leadTouchpoints,
    notes,
    allowedNextStages: mutable ? allowedNextStages(lead.stage) : [],
    reasonRequiredFor: pipelineConfig.reasonRequired,
  };
}

/** Timeline for a lead, including the history of any leads merged into it. Newest first. */
export async function getTimeline(db: Database, organizationId: string, leadId: string) {
  const lead = await findLead(db, organizationId, leadId);
  const merged = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.mergedIntoLeadId, lead.id)));
  const ids = [lead.id, ...merged.map((m) => m.id)];
  return db
    .select({
      id: leadEvents.id,
      leadId: leadEvents.leadId,
      type: leadEvents.type,
      actorType: leadEvents.actorType,
      actorUserId: leadEvents.actorUserId,
      actorName: users.name,
      payload: leadEvents.payload,
      occurredAt: leadEvents.occurredAt,
    })
    .from(leadEvents)
    .leftJoin(users, eq(users.id, leadEvents.actorUserId))
    .where(and(eq(leadEvents.organizationId, organizationId), inArray(leadEvents.leadId, ids)))
    .orderBy(desc(leadEvents.occurredAt), desc(leadEvents.id))
    .limit(500);
}

// ---------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------

export async function addNote(
  db: Database,
  organizationId: string,
  leadId: string,
  body: string,
  actor: Actor,
) {
  return db.transaction(async (tx) => {
    const lead = await findMutableLead(tx, organizationId, leadId);
    const [note] = await tx
      .insert(leadNotes)
      .values({ organizationId, leadId: lead.id, authorUserId: actorUserId(actor), body })
      .returning();
    await tx.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, lead.id));
    await recordLeadHistory(tx, {
      organizationId,
      leadId: lead.id,
      type: 'note.added',
      actor,
      payload: { noteId: note?.id },
    });
    return note!;
  });
}

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

/**
 * Merge a duplicate (`source`) into `target`. Contact details and qualification answers missing
 * on the target are copied over; touchpoints, consents, notes and channel identities move to the
 * target. The source keeps its own history and is marked as merged. Stages are not changed.
 */
export async function mergeLeads(
  db: Database,
  organizationId: string,
  input: { targetLeadId: string; sourceLeadId: string },
  actor: Actor,
): Promise<Lead> {
  return db.transaction(async (tx) => {
    // Lock in a stable order to avoid deadlocks between concurrent merges.
    const [firstId, secondId] = [input.targetLeadId, input.sourceLeadId].sort();
    const first = await findMutableLead(tx, organizationId, firstId!);
    const second = await findMutableLead(tx, organizationId, secondId!);
    const target = first.id === input.targetLeadId ? first : second;
    const source = first.id === input.sourceLeadId ? first : second;

    // Free the source's unique contact values before copying them to the target.
    await tx
      .update(leads)
      .set({ mergedIntoLeadId: target.id, email: null, phone: null })
      .where(eq(leads.id, source.id));

    const [sourceQualification] = await tx
      .select()
      .from(leadQualification)
      .where(eq(leadQualification.leadId, source.id));
    const qualification: QualificationInput = {};
    if (sourceQualification) {
      for (const field of [
        'experienceLevel',
        'marketsOfInterest',
        'mainDifficulties',
        'goals',
        'reasonForTraining',
        'previousTraining',
        'desiredStart',
        'mentorshipInterest',
      ] as const) {
        const value = sourceQualification[field];
        if (!isEmptyValue(value)) Object.assign(qualification, { [field]: value });
      }
    }

    for (const table of [touchpoints, consents, leadNotes, channelIdentities]) {
      await tx.update(table).set({ leadId: target.id }).where(eq(table.leadId, source.id));
    }

    await applyLeadChanges(tx, target, {
      contact: {
        fullName: source.fullName,
        email: source.email,
        phone: source.phone,
        country: source.country,
        timezone: source.timezone,
        locale: source.locale,
        ageConfirmed18plus: source.ageConfirmed18plus,
      },
      qualification,
      fillOnly: true,
      source: 'staff',
      actor,
      eventType: 'lead.merged',
      eventPayload: { sourceLeadId: source.id },
    });
    await recordLeadHistory(tx, {
      organizationId,
      leadId: source.id,
      type: 'lead.merged_into',
      actor,
      payload: { targetLeadId: target.id },
    });

    // Re-point first/last touch now that the source's touchpoints belong to the target.
    const [firstTouch] = await tx
      .select()
      .from(touchpoints)
      .where(eq(touchpoints.leadId, target.id))
      .orderBy(asc(touchpoints.occurredAt))
      .limit(1);
    const [lastTouch] = await tx
      .select()
      .from(touchpoints)
      .where(eq(touchpoints.leadId, target.id))
      .orderBy(desc(touchpoints.occurredAt))
      .limit(1);
    await tx
      .update(leads)
      .set({
        firstTouchId: firstTouch?.id ?? null,
        lastTouchId: lastTouch?.id ?? null,
        source: firstTouch?.source ?? target.source ?? source.source,
      })
      .where(eq(leads.id, target.id));

    return findLead(tx, organizationId, target.id);
  });
}

// ---------------------------------------------------------------------------------------------
// Data-subject requests
// ---------------------------------------------------------------------------------------------

/** Everything stored about one lead, for a data-subject access request. */
export async function exportLead(db: Database, organizationId: string, leadId: string) {
  const detail = await getLeadDetail(db, organizationId, leadId);
  const [allConsents, transitions, timeline, identities] = await Promise.all([
    db.select().from(consents).where(eq(consents.leadId, leadId)).orderBy(asc(consents.createdAt)),
    db
      .select()
      .from(stageTransitions)
      .where(eq(stageTransitions.leadId, leadId))
      .orderBy(asc(stageTransitions.createdAt)),
    getTimeline(db, organizationId, leadId),
    db.select().from(channelIdentities).where(eq(channelIdentities.leadId, leadId)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    lead: detail.lead,
    qualification: detail.qualification,
    consentHistory: allConsents,
    touchpoints: detail.touchpoints,
    notes: detail.notes,
    channelIdentities: identities,
    stageHistory: transitions,
    timeline,
  };
}

/**
 * Erase a lead's personal data (right to erasure). The row is kept, anonymised, so pipeline
 * history and aggregate counts stay correct; email/phone hashes go on the do-not-contact list.
 */
export async function eraseLead(
  db: Database,
  organizationId: string,
  leadId: string,
  actor: Actor,
): Promise<void> {
  await db.transaction(async (tx) => {
    const lead = await findLead(tx, organizationId, leadId, { forUpdate: true });
    if (lead.erasedAt) throw Errors.conflict('This lead has already been erased');

    await addToSuppressionList(tx, organizationId, lead, 'erasure_request');
    await tx
      .update(leads)
      .set({
        fullName: null,
        email: null,
        phone: null,
        country: null,
        timezone: null,
        locale: null,
        erasedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));
    await tx
      .update(leadQualification)
      .set({
        mainDifficulties: [],
        goals: [],
        reasonForTraining: null,
        previousTraining: null,
        evidence: {},
      })
      .where(eq(leadQualification.leadId, lead.id));
    await tx.delete(leadNotes).where(eq(leadNotes.leadId, lead.id));
    await tx.delete(consents).where(eq(consents.leadId, lead.id));
    await tx.delete(channelIdentities).where(eq(channelIdentities.leadId, lead.id));
    await tx
      .update(touchpoints)
      .set({ landingPage: null, referrer: null, clickIds: {} })
      .where(eq(touchpoints.leadId, lead.id));
    await recordLeadHistory(tx, {
      organizationId,
      leadId: lead.id,
      type: 'lead.erased',
      actor,
    });
  });
}
