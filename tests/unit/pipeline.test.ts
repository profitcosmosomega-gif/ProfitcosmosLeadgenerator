import { describe, expect, it } from 'vitest';
import { ALL_STAGES, pipelineConfig } from '@config/pipeline';
import { allowedNextStages, canTransition, reasonRequired } from '@/modules/crm/service';

describe('pipeline configuration', () => {
  it('defines transitions for every stage, only to known stages, never to itself', () => {
    for (const stage of ALL_STAGES) {
      const next = pipelineConfig.transitions[stage];
      expect(next).toBeDefined();
      for (const to of next) {
        expect(ALL_STAGES).toContain(to);
        expect(to).not.toBe(stage);
      }
    }
  });

  it('makes ENROLLED final', () => {
    expect(allowedNextStages('ENROLLED')).toEqual([]);
  });

  it('allows the main path in order', () => {
    expect(canTransition('NEW_LEAD', 'ENGAGED')).toBe(true);
    expect(canTransition('QUALIFYING', 'QUALIFIED')).toBe(true);
    expect(canTransition('QUALIFIED', 'CONSULTATION_BOOKED')).toBe(true);
    expect(canTransition('ENROLLMENT_PENDING', 'ENROLLED')).toBe(true);
  });

  it('forbids skipping ahead and moving out of LOST except to NURTURE', () => {
    expect(canTransition('NEW_LEAD', 'ENROLLED')).toBe(false);
    expect(canTransition('NEW_LEAD', 'QUALIFIED')).toBe(false);
    expect(canTransition('LOST', 'QUALIFIED')).toBe(false);
    expect(canTransition('LOST', 'NURTURE')).toBe(true);
  });

  it('allows a cancelled consultation to return to QUALIFIED', () => {
    expect(canTransition('CONSULTATION_BOOKED', 'QUALIFIED')).toBe(true);
  });

  it('requires a reason for LOST and NURTURE only', () => {
    expect(reasonRequired('LOST')).toBe(true);
    expect(reasonRequired('NURTURE')).toBe(true);
    expect(reasonRequired('QUALIFIED')).toBe(false);
  });
});
