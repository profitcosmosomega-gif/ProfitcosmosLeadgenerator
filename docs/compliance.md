# Compliance principles

ProfitCosmos Omega Academy sells **trading education**. This system markets, qualifies and books
consultations for that education. These principles bind every phase: code, prompts, templates,
knowledge-base content and staff tooling.

> This document records engineering guardrails. It is not legal advice. Disclaimers, consent wording
> and privacy notices must be reviewed by qualified counsel for every jurisdiction we market in.

## 1. Education, not financial advice

- The system never tells a prospect what to buy, sell or trade, when to trade, or how much to risk.
- Questions about a prospect's personal financial situation or specific trades get a neutral
  deflection and, where appropriate, a handoff to a human.
- Approved disclaimer text lives in the knowledge base (Phase 4) and is always available to the AI.

## 2. Prohibited claims

Never state or imply:

- guaranteed trading profits, income or returns
- risk-free trading or "can't lose" strategies
- guaranteed financial independence or certain financial success
- specific earnings figures or results as typical/expected
- that past student results predict a prospect's results

Enforcement (from Phase 3): prompt rules, rule-based output filter, model-based output classifier,
knowledge-base-only facts with citations, automated evaluations in CI and human review of sampled
conversations. A failed check means the message is not sent and a human is notified.

## 3. Honesty about the AI

- The assistant discloses that it is an AI and never claims to be a person.
- When it does not know an answer, it says so and escalates; it never invents facts.

## 4. Consent and communication

- Consent is recorded per channel and purpose (transactional vs marketing) with evidence (wording
  shown, source, time).
- Consent and suppression are checked **at send time**, not only when a message is scheduled.
- Every marketing message offers a working unsubscribe; opt-outs apply immediately.
- Quiet hours (prospect's time zone) and frequency caps apply to automated messages.
- Prospects must be 18 or older; minors are not qualified or contacted further.

## 5. Data protection

- Collect only what qualification needs. No personal data in logs (`src/lib/logger.ts` redacts
  common keys as a safety net).
- Staff access is authenticated and role-based (`viewer` < `sales` < `admin` < `owner`); public
  sign-up is disabled.
- Staff actions that change data are written to the append-only `audit_log`.
- Secrets come from environment variables, never from the repository.
- Data-subject access and erasure workflows arrive with lead data (Phase 2): export on request,
  hard-delete personal data, keep anonymised aggregates and an erasure record.
- Minimise personal data sent to AI providers; use providers' data-protection terms.

## 6. Metrics honesty

Analytics never fabricate numbers. When data is missing (e.g. no ad spend), the metric is reported
as unavailable, not as zero or an estimate.

## Implementation status

**Phase 1**: staff authentication with roles, disabled public sign-up, audit log with sign-in
events, PII log redaction, environment-only secrets, AI kill-switch (`AI_ENABLED=false`), and a
prompt loader that refuses any prompt not marked `approved` (all prompts are stubs).

**Phase 2**:

- Consent records per channel and purpose with evidence (method, wording version, who recorded
  it); latest record is current. Withdrawal is recorded the same way.
- ⚠️ Form consent wording (`config/consent.ts`) is a **placeholder pending legal review**, stored
  as `approved: false` with every consent until replaced. It is not legal approval of any
  jurisdiction's requirements.
- Public form requires confirmation that the person is 18 or older; otherwise nothing is stored.
- Do-not-contact list (hashed email/phone) blocks re-capture and re-import after erasure.
- Data-subject export (admin) and erasure (owner) endpoints.
- Lead timeline and audit entries hold ids and field names only; URLs are stored without query
  strings; `lead_events` and `stage_transitions` are append-only at database level.
- Nothing is sent to leads yet: consent is recorded, but no outbound messaging exists until
  Phase 8, where consent and suppression will be checked at send time.

**Phase 3** (AI qualification agent):

- The assistant says it is an AI (chat page disclosure; persona text pending business question 13)
  and never claims to be a person (rule filter + classifier).
- Every draft reply passes a rule filter (guarantees, risk-free, earnings claims, money figures,
  trade instructions, human claims; English and French), a prompt-leak check and a model
  classifier (personalised advice, guarantees, unsupported claims, internal disclosure). Failing
  drafts are never sent; after one retry a fixed fallback is sent and the team is flagged.
- Program, price and policy questions the assistant cannot confirm are flagged for the team
  (`cannot_confirm`).
- A message suggesting the person is under 18 stops the AI and flags the team before any model
  call. The pre-chat form requires the 18+ confirmation.
- Prompts are drafts until the owner approves them; the loader refuses drafts outside tests. ⚠️
  The fixed chat texts (`config/chat-copy.ts`) are placeholders stored as `approved: false`.
- No message text, prompt text or token is logged; AI runs and timeline events store ids, codes
  and counts only. Drafts that may disclose internal instructions are not stored.
- Erasure removes message text and closes the lead's conversations; export includes them.
- The model receives the transcript, the names (not values) of details known from other sources
  and what was collected in this chat; never other leads' data, emails or phone numbers.
