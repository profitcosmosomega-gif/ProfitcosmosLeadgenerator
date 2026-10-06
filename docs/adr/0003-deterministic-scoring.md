# ADR 0003 — Deterministic, explainable lead scoring

- Status: Accepted (implementation in Phase 5)
- Date: 2026-10-06

## Context

Sales staff must trust and understand lead scores, scores must be configurable, and the business
must be able to check later whether scores predicted enrollments. An LLM-only score is opaque and
non-reproducible.

## Decision

The LLM only **extracts signals with evidence** (e.g. "wants to start within 30 days", with the
quote). A deterministic rules engine computes the 0–100 score from versioned rulesets
(`config/scoring`). Every stored score includes the ruleset version and a per-rule breakdown with
evidence. Bands are configurable (default 0–39 Nurture, 40–69 Interested, 70–100 High intent).

## Consequences

- Scores are reproducible, auditable and explainable in the UI and handoff briefs.
- Weight tuning is a config change, testable without calling an LLM.
- Extraction quality still matters; it is covered by the AI evaluation suite (Phase 3).
