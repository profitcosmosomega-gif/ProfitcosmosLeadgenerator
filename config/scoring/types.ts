/*
 * Explainable lead-scoring shapes — PLACEHOLDER (Phase 1).
 * The rules engine that evaluates these is implemented in Phase 5.
 */

export type ScoreCategory = 'fit' | 'intent' | 'engagement' | 'negative';

export interface ScoreBand {
  id: 'NURTURE' | 'INTERESTED' | 'HIGH_INTENT';
  label: string;
  /** Inclusive lower bound, 0–100. */
  min: number;
}

export interface ScoringRule {
  id: string;
  label: string;
  category: ScoreCategory;
  /** Points added when the rule matches (negative for penalties). */
  points: number;
  /** Condition identifier evaluated by the engine (defined in Phase 5). */
  condition: string;
}

export interface ScoringRuleset {
  id: string;
  version: string;
  bands: readonly ScoreBand[];
  categoryCaps: Partial<Record<ScoreCategory, number>>;
  rules: readonly ScoringRule[];
}

/** One line of a stored score explanation. */
export interface ScoreBreakdownItem {
  ruleId: string;
  label: string;
  points: number;
  evidence?: string;
}
