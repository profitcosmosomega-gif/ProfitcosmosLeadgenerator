import { eq } from 'drizzle-orm';
import { pipelineConfig, type PipelineStage } from '@config/pipeline';
import type { Database, DbExecutor } from '@/db/client';
import { leads, stageTransitions, type Lead } from '@/db/schema';
import { Errors } from '@/lib/errors';
import { actorUserId, recordLeadHistory, type Actor } from '@/modules/leads/history';
import { findMutableLead } from '@/modules/leads/repository';

export function allowedNextStages(from: PipelineStage): readonly PipelineStage[] {
  return pipelineConfig.transitions[from];
}

export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  return allowedNextStages(from).includes(to);
}

export function reasonRequired(to: PipelineStage): boolean {
  return pipelineConfig.reasonRequired.includes(to);
}

/** Record the initial stage of a newly created lead (from: null). Called by lead creation. */
export async function recordInitialStage(
  tx: DbExecutor,
  lead: Pick<Lead, 'id' | 'organizationId' | 'stage'>,
  actor: Actor,
): Promise<void> {
  await tx.insert(stageTransitions).values({
    organizationId: lead.organizationId,
    leadId: lead.id,
    fromStage: null,
    toStage: lead.stage,
    actorType: actor.type,
    actorUserId: actorUserId(actor),
  });
}

/**
 * The only way to change a lead's pipeline stage. Validates the move against
 * `config/pipeline.ts`, then writes the stage, the transition history, a timeline event and an
 * audit entry in one transaction.
 */
export async function transitionLead(
  db: Database,
  input: {
    organizationId: string;
    leadId: string;
    to: PipelineStage;
    reason?: string | null;
    actor: Actor;
  },
): Promise<Lead> {
  return db.transaction(async (tx) => {
    const lead = await findMutableLead(tx, input.organizationId, input.leadId);
    const from = lead.stage;
    const allowed = allowedNextStages(from);

    if (from === input.to) {
      throw Errors.invalidTransition(`Lead is already in stage ${from}`, { from, to: input.to });
    }
    if (!allowed.includes(input.to)) {
      throw Errors.invalidTransition(`Cannot move a lead from ${from} to ${input.to}`, {
        from,
        to: input.to,
        allowed,
      });
    }
    const reason = input.reason?.trim() || null;
    if (reasonRequired(input.to) && !reason) {
      throw Errors.validation(`A reason is required when moving a lead to ${input.to}`, [
        { path: ['reason'], message: 'Required' },
      ]);
    }

    const [updated] = await tx
      .update(leads)
      .set({
        stage: input.to,
        outcomeReason: reasonRequired(input.to) ? reason : null,
        lastActivityAt: new Date(),
      })
      .where(eq(leads.id, lead.id))
      .returning();

    const [transition] = await tx
      .insert(stageTransitions)
      .values({
        organizationId: lead.organizationId,
        leadId: lead.id,
        fromStage: from,
        toStage: input.to,
        actorType: input.actor.type,
        actorUserId: actorUserId(input.actor),
        reason,
      })
      .returning({ id: stageTransitions.id });

    await recordLeadHistory(tx, {
      organizationId: lead.organizationId,
      leadId: lead.id,
      type: 'stage.changed',
      actor: input.actor,
      payload: { from, to: input.to, transitionId: transition?.id },
    });

    return updated!;
  });
}
