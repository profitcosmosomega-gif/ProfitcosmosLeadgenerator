/*
 * CRM pipeline shape — PLACEHOLDER (Phase 1).
 * Locks the stage names and config shape only. Transition rules and the state machine that
 * enforces them are implemented in Phase 2.
 */

export const PIPELINE_STAGES = [
  'NEW_LEAD',
  'ENGAGED',
  'QUALIFYING',
  'QUALIFIED',
  'CONSULTATION_BOOKED',
  'CONSULTATION_COMPLETED',
  'ENROLLMENT_PENDING',
  'ENROLLED',
] as const;

/** Alternative outcomes outside the main path. */
export const PIPELINE_OUTCOMES = ['NURTURE', 'LOST'] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number] | (typeof PIPELINE_OUTCOMES)[number];

export interface PipelineConfig {
  version: string;
  /** Allowed transitions: from stage -> stages it may move to. */
  transitions: Partial<Record<PipelineStage, readonly PipelineStage[]>>;
}

export const pipelineConfig: PipelineConfig = {
  version: '0.0.0',
  // TODO(phase-2): define allowed transitions with the sales team.
  transitions: {},
};
