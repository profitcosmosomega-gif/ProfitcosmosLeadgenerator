import type { ScoringRuleset } from './types';

/**
 * Default ruleset — PLACEHOLDER (Phase 1). Bands follow the approved plan;
 * rules and caps are defined with the sales team in Phase 5.
 */
export const defaultRuleset: ScoringRuleset = {
  id: 'default',
  version: '0.0.0',
  bands: [
    { id: 'NURTURE', label: 'Nurture', min: 0 },
    { id: 'INTERESTED', label: 'Interested', min: 40 },
    { id: 'HIGH_INTENT', label: 'High intent', min: 70 },
  ],
  // TODO(phase-5): category caps (fit / intent / engagement).
  categoryCaps: {},
  // TODO(phase-5): scoring rules.
  rules: [],
};
