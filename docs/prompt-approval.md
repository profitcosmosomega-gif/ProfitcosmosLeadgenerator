# Prompt approval gate (Phase 3)

The AI assistant answers nobody until the owner explicitly approves its prompts **and** the fixed
chat texts. This file is the gate; nothing in code or CI approves anything.

## Current state

| Item                                       | Version | Status                                 |
| ------------------------------------------ | ------- | -------------------------------------- |
| `config/prompts/qualification-agent`       | 1.1.0   | `draft` (not approved)                 |
| `config/prompts/output-guardrail`          | 1.1.0   | `draft` (not approved)                 |
| `config/chat-copy.ts`                      | 0.2.0   | `approved: false`                      |
| `config/guardrails/rules.ts` (topics list) | 1.0.0   | code (reviewed with the PR)            |
| Legal review of wording                    | —       | **pending** (not replaced by approval) |

Version 1.1.0 incorporates the founder's answers of 2026-10-07 to business questions 1 (Canada
first, no jurisdiction-specific claims, outside Canada the team confirms), 2 (AI identity,
education not advice, risk and no guarantee), 13 (name "ProfitCosmos Omega AI Assistant", voice,
AI disclosure in the first message) and 14 (always-escalate topics), plus 6 (initial
qualification criteria) and 7 (consultations arranged by the team, never booked in the chat).
Version 1.0.0 is retired.

## How the gate is enforced

- `loadActivePrompt` serves a prompt only with `status: approved`, `approved_by` and
  `approved_at`. Drafts load only in the test suite (`NODE_ENV=test`).
- The turn pipeline also refuses to run while `chatCopy.approved` is false (`copy_not_approved`).
- Every gated turn records a `skipped` AI run; no model is called.
- `tests/unit/prompts.test.ts` fails if any prompt is approved; the approval commit updates it.

## Approving

Only the owner (or someone they name in writing) approves. In one commit:

1. Confirm `pnpm test` (including `tests/evals`) is green.
2. Run the live evaluations with the draft prompts and attach the results:
   `EVAL_LIVE=1 ANTHROPIC_API_KEY=… pnpm eval`.
3. In both prompt files set `status: approved`, `approved_by: <name>`, `approved_at: <ISO date>`.
4. In `config/chat-copy.ts` set `approved: true` (bump `version` if the text changed).
5. Update `tests/unit/prompts.test.ts` to expect the approved versions, and this table.
6. Deploy with `ANTHROPIC_API_KEY` set, then switch `AI_ENABLED=true`.

Approved versions are never edited in place: a change is a new version file, a registry update
and a new approval. Prompt approval does not replace legal review of the wording.
