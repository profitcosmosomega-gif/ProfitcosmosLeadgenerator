/*
 * CRM pipeline configuration. The state machine that enforces it lives in
 * src/modules/crm/service.ts — the only code allowed to change a lead's stage.
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

export const ALL_STAGES = [...PIPELINE_STAGES, ...PIPELINE_OUTCOMES] as const;

export type PipelineStage = (typeof ALL_STAGES)[number];

export interface PipelineConfig {
  version: string;
  initialStage: PipelineStage;
  /** Allowed transitions: from stage -> stages it may move to. */
  transitions: Record<PipelineStage, readonly PipelineStage[]>;
  /** Moving into these stages requires a reason. */
  reasonRequired: readonly PipelineStage[];
}

export const pipelineConfig: PipelineConfig = {
  version: '1.0.0',
  initialStage: 'NEW_LEAD',
  transitions: {
    NEW_LEAD: ['ENGAGED', 'QUALIFYING', 'NURTURE', 'LOST'],
    ENGAGED: ['QUALIFYING', 'NURTURE', 'LOST'],
    QUALIFYING: ['QUALIFIED', 'NURTURE', 'LOST'],
    QUALIFIED: ['CONSULTATION_BOOKED', 'NURTURE', 'LOST'],
    // Back to QUALIFIED when a consultation is cancelled or the prospect does not show.
    CONSULTATION_BOOKED: ['CONSULTATION_COMPLETED', 'QUALIFIED', 'LOST'],
    CONSULTATION_COMPLETED: ['ENROLLMENT_PENDING', 'NURTURE', 'LOST'],
    ENROLLMENT_PENDING: ['ENROLLED', 'NURTURE', 'LOST'],
    ENROLLED: [],
    NURTURE: ['ENGAGED', 'QUALIFYING', 'QUALIFIED', 'LOST'],
    LOST: ['NURTURE'],
  },
  reasonRequired: ['NURTURE', 'LOST'],
};
