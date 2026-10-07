# Phase 3 plan — AI qualification agent

> Status: **IMPLEMENTED on the draft PR** (Issue #4), plan approved by the owner for
> implementation. **Production prompt approval is not granted**: both prompts stay
> `status: draft` and the AI answers no one until they are approved (§13,
> [prompt-approval.md](prompt-approval.md)). Founder answers to questions 1, 2, 13 and 14
> (2026-10-07) are incorporated in the 1.1.0 drafts. Differences between
> this plan and the code are listed in §15.

## 1. Goal

Add a safe, auditable AI assistant that holds the first qualification conversation with an inbound
lead on the website, records what the lead says as structured qualification fields with evidence,
and flags the conversation for a human whenever it cannot answer safely. The assistant talks and
extracts; deterministic code decides what is stored, what is sent, and any stage change.

## 2. Scope

**In Phase 3** (from Issue #4)

1. Conversations, messages and AI runs, scoped by `organization_id`.
2. Anthropic implementation of the existing `LlmProvider` interface, behind `AI_ENABLED`.
3. Versioned qualification prompt and output-guardrail prompt (drafts, see §7).
4. The agent turn pipeline: save → gate → build context → LLM with tools → guardrails → persist →
   CRM updates through existing services → reply.
5. Four narrow, typed tools (§5).
6. Output guardrails and the "cannot confirm" path (§6).
7. Escalation **flags** (a record and a status), not the Phase 7 handoff workflow.
8. Minimal public chat API and page; staff transcript view with AI run details.
9. Unit, integration and evaluation tests; docs.

**Not in Phase 3**: knowledge base or retrieval (4), scoring engine (5), booking (6), handoff
briefs, notifications, takeover inbox or staff replies to the lead (7), follow-ups and any outbound
message outside a live chat reply (8), analytics (9), new channels (10), multi-tenant behaviour (12).
No automatic move to `QUALIFIED`: that needs the "qualified" definition (business question 6) and
scoring (Phase 5).

## 3. Data model

New tables, all with `organization_id`, UUID v7 ids and `timestamptz`:

| Table                      | Purpose                                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations`            | One chat with one lead: `lead_id`, `channel` (`web`), `status` (`active` / `paused` / `closed`), `ai_paused`, `access_token_hash`, `last_message_at`, `closed_reason`                                                                                |
| `messages`                 | `conversation_id`, `lead_id`, `direction` (`in` / `out`), `author` (`lead` / `ai` / `system`), `body`, `ai_run_id`, `prompt_id`, `prompt_version`, `guardrail_result` (JSON verdicts, no text), `status` (`sent` / `blocked`)                        |
| `ai_runs`                  | One row per LLM call: purpose (`turn` / `guardrail`), provider, model, prompt id and version, status, stop reason, input/output/cache tokens, cost, latency, tool calls (name + valid/invalid only), error code. No prompt or reply text, no secrets |
| `conversation_escalations` | Flag for a human: `reason` (enum, §6), `status` (`open` / `resolved`), triggering `message_id`, `resolved_by`, `resolved_at`. Phase 7 builds handoffs on top of these                                                                                |

Changes to existing tables (new migration; applied migrations are not edited):

- `actor_type` enum gains `ai`, so timeline and transition rows can say the AI did something.
- `QualificationEvidence.source` gains `ai`, with `messageId`, `aiRunId` and a short verbatim
  `quote` from the lead's message (personal data: cleared on erasure, never in logs or events).
- Lead erasure also deletes message bodies and evidence quotes (AI run metadata stays, it holds no
  personal data). Lead export includes conversations and messages.

## 4. Turn pipeline

Runs in the worker as job `agent.turn`, one job per inbound message, serialised per conversation
(pg-boss singleton key), so two messages never race.

1. **Save** (web request): validate size, store the lead's message, add timeline event
   `message.received` (ids only), enqueue the job, return `202`.
2. **Gate** (deterministic; a failed gate stores no AI reply and makes no LLM call):
   `AI_ENABLED` off or no API key; prompt not `approved`; lead erased, suppressed or `LOST`;
   conversation paused, closed or with an open escalation; limits reached (§8). Gate results are
   recorded as an `ai_runs` row with status `skipped` and the reason. The chat shows a fixed
   "a member of the team will follow up" notice (placeholder copy, §9).
3. **Context**: approved system prompt; known qualification fields and the list of missing ones
   (computed in code); the last N messages, with lead text marked as untrusted data. No knowledge
   base, no other lead's data, no secrets.
4. **LLM call with tools** (conversation model slot), at most 3 tool rounds per turn. Every tool
   input is validated with Zod; unknown tools or invalid input are rejected and recorded.
5. **Guardrails** on the reply (§6). Pass → send. Fail → regenerate once with the reason → still
   failing → fixed safe fallback + escalation `guardrail_failure`.
6. **Persist** in one transaction: AI message, AI run, accepted tool effects, timeline events.
7. **CRM rules** (deterministic, through `transitionLead` only, actor `system`):
   - first message from the lead while `NEW_LEAD` → `ENGAGED`;
   - first qualification field recorded from the chat while `ENGAGED` → `QUALIFYING`.
     Nothing else moves the stage in Phase 3.

The chat page polls `GET …/messages` every ~1.5 s for the reply. This follows the approved
architecture (AI work in the worker, with retries and per-conversation ordering).

## 5. Agent tools

| Tool                   | Effect                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_lead_context`     | Read-only: this lead's known qualification fields and missing fields. Never another lead.                                                                                                                                                                                                                                             |
| `record_qualification` | Writes qualification fields (existing enums and lists) with a `quote`. Code checks the quote appears verbatim in one of this lead's messages in this conversation; otherwise the field is rejected (no invented facts). **Fill-only**: never overwrites a value from staff, form or import; may only update its own earlier AI value. |
| `update_contact`       | Fills empty `full_name`, `phone`, `country`, `timezone` only, with the same quote check. Never changes email (identity and dedupe key) and never overwrites.                                                                                                                                                                          |
| `request_human`        | Creates an escalation flag with a reason from a fixed list (`human_requested`, `cannot_confirm`, `sensitive_topic`, `possible_underage`, `abusive`). Pauses the AI on that conversation.                                                                                                                                              |

All writes go through the Phase 2 services (`applyLeadChanges`, `recordLeadHistory`) so the timeline
and audit rules stay the same. Tools act only on the conversation's own lead, taken from the job,
never from model output.

## 6. Guardrails and safety

**Output checks, in order, fail closed** (a checker error counts as a failure):

1. **Rule filter** (`config/guardrails/`, versioned phrase/regex lists, English and French): profit
   or income guarantees, "risk-free", return percentages or money amounts, buy/sell/entry
   instructions, prices, claims to be human.
2. **Leak check**: a random canary string in the system prompt; a reply containing it, or long
   overlap with the prompt, is blocked.
3. **Model classifier** (extraction slot, `output-guardrail` prompt, structured verdict):
   personalised financial advice, guarantees, unsupported factual claims about programs, prices,
   schedules or policies, internal-instruction disclosure.

With no knowledge base in Phase 3, **any** concrete claim about programs, prices or policies is
unsupported by definition. The prompt tells the assistant to say it cannot confirm and call
`request_human` with `cannot_confirm`; the classifier enforces it if it doesn't.

**Input handling**: lead text is untrusted data, never instructions. Size limit per message.
Suspected injection is recorded on the AI run (flag only); the guardrails above stop any effect.

**Specific cases**:

| Case                           | Behaviour                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Under 18                       | Chat requires the same 18+ confirmation as the form. If the lead later says they are under 18: AI stops, escalation `possible_underage`, staff decide on `LOST` (no automatic stage change). |
| Asks for guaranteed profits    | Neutral answer that results are never guaranteed and trading carries risk; no figures.                                                                                                       |
| Asks what or when to trade     | Deflection: education, not advice; no instruments, levels or timing.                                                                                                                         |
| Unknown program/price question | "I can't confirm that here, a member of the team will" + `cannot_confirm` escalation.                                                                                                        |
| Asks for a human               | `human_requested` escalation; AI pauses.                                                                                                                                                     |
| Abuse                          | Short neutral reply or none; `abusive` escalation; AI pauses.                                                                                                                                |
| Prompt injection               | Ignored as data; no internal text revealed; guardrails block leaks.                                                                                                                          |

## 7. Prompts and versions

- `config/prompts/qualification-agent/v1.0.0.md` and `config/prompts/output-guardrail/v1.0.0.md`
  are added with **`status: draft`**. CLAUDE.md forbids production prompt text without explicit
  approval, so the text is written for review in this PR and the loader keeps refusing it.
- The owner approves by setting `status: approved`, `approved_by`, `approved_at` (one commit, or
  a review comment I apply). Until then the AI cannot run anywhere except tests.
- Tests and evals load drafts through an explicit test-only option; production code cannot.
- Every AI message and AI run stores the prompt id and version. Approved versions are never edited.
- `conversation-summary` is not used in Phase 3 (conversations are capped in length instead).

## 8. Limits and configuration

`config/ai.ts` (code defaults, reviewable):

| Setting                            | Default                                       |
| ---------------------------------- | --------------------------------------------- |
| Max characters per lead message    | 2,000                                         |
| Max lead messages per conversation | 40                                            |
| Max AI turns per lead per day      | 30                                            |
| Public chat rate limit             | 10 messages / minute / IP                     |
| Max tool rounds per turn           | 3                                             |
| Organisation daily token ceiling   | Set by env; AI stops when reached             |
| Model ids                          | Env (`LLM_MODEL_*`), default Claude Haiku 4.5 |
| Organisation monthly cost ceiling  | `AI_MONTHLY_BUDGET_USD` (default 15)          |

Costs come from a per-model price table in config; unknown models record cost as `null`, never 0.

## 9. API and screens

**Public** (no login; origin allow-list, rate limit, honeypot as in Phase 2):

| Endpoint                                      | Does                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/public/conversations`              | Pre-chat form (name, email, 18+ confirmation, consent fields, attribution) → `captureLead` → new conversation; returns id + access token |
| `POST /api/public/conversations/:id/messages` | Bearer token; save and enqueue; `202`                                                                                                    |
| `GET /api/public/conversations/:id/messages`  | Bearer token; visible messages after a cursor (never system, tool or guardrail data)                                                     |

The token is random, stored hashed, scoped to one conversation. A minimal page at `/chat`
exercises the flow; the embeddable widget script is left for later.

**Staff**:

| Endpoint                                | Role   | Does                                                                                                       |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/leads/:id/conversations`   | viewer | Conversations of a lead                                                                                    |
| `GET /api/v1/conversations/:id`         | viewer | Transcript, per-message AI run status, model, prompt version, guardrail outcome, tokens, cost, escalations |
| `POST /api/v1/conversations/:id/pause`  | sales  | Pause AI (audited)                                                                                         |
| `POST /api/v1/conversations/:id/resume` | sales  | Resume AI (audited)                                                                                        |
| `POST /api/v1/escalations/:id/resolve`  | sales  | Resolve a flag (audited)                                                                                   |

Admin UI: a "Conversations" section on lead detail and an "open escalation" filter on the lead
list. The system prompt is never shown, only its id and version.

All conversation, message, run and escalation queries filter by `organization_id`; another
organisation's ids return 404.

## 10. Logging, audit, privacy

- Logs: ids, statuses, token counts, latency. Never message text, quotes, names, emails, phones.
- Timeline events (`conversation.started`, `message.received`, `ai.replied`, `ai.blocked`,
  `qualification.updated`, `escalation.flagged`, `ai.paused`): ids and field names only.
- Audit log: staff pause, resume and escalation resolve.
- Only the lead's first name (if known) and qualification fields go to the LLM; no email or phone.

## 11. Tests and evaluations

- **Unit**: tool schemas, quote verification, fill-only precedence, gates, guardrail rules, cost
  calculation, prompt loader draft/approved behaviour.
- **Integration** (real Postgres, fake LLM): public API (validation, token, rate limit, 18+,
  suppression), job pipeline end to end, stage rules, kill switch makes no LLM call, cross-org
  404s, erasure removes bodies and quotes, staff role checks.
- **Evals** (`tests/evals`), two modes:
  1. _Scripted_ (CI, always): fixed model outputs per persona prove the pipeline blocks and
     escalates correctly regardless of the model.
  2. _Live_ (real model, draft prompts): run on demand or in CI when an API key secret exists;
     results reported in the PR before approval.
     Cases: beginner, experienced, guarantee-profit request, personal trade advice request, unknown
     program question, human request, under-18, abusive input, prompt injection (plus price question
     and system-prompt extraction attempt).
- Phase 1–2 tests stay green; full CI (lint, typecheck, format, `db:check`, tests, build, Docker).

## 12. Commit plan

1. Schema + migration (tables, enum changes, evidence type), erasure/export updates.
2. Anthropic provider, AI run recording, cost table, limits config.
3. Conversations service + public API + `/chat` page.
4. Tools + turn pipeline + `agent.turn` job + stage rules.
5. Guardrails (rules, leak check, classifier) + fallback/escalation.
6. Draft prompts.
7. Staff API + admin screens.
8. Evals.
9. README, compliance and architecture docs.

New dependency: `@anthropic-ai/sdk` (provider adapter only).

## 13. Dependencies on business questions

Tracked in the business-questions file (plan §20). None blocks building and testing Phase 3;
several block **approving the prompts**, so the AI cannot go live until they are answered.

| #   | Question                          | Phase 3 impact                                 | Default used until answered                                                | Blocks prompt approval |
| --- | --------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| 1   | Countries                         | Risk wording, consent at chat start            | Strictest common rules, as in Phase 2                                      | Yes                    |
| 2   | Legal wording, sign-off           | Disclosure, fallback and "cannot confirm" text | Placeholder copy flagged `approved: false`                                 | Yes                    |
| 3   | Languages                         | Reply language, guardrail phrase lists         | Reply in the lead's language when it is English or French, else English    | No                     |
| 6   | "Qualified" definition            | Which gaps the AI asks about first             | Timeline and intent first; no automatic `QUALIFIED`                        | No                     |
| 11  | May the AI state prices?          | Price questions                                | No; "a consultant will explain options" + escalation                       | No                     |
| 12  | Objection answers                 | Objection handling                             | None; neutral acknowledgement + escalation                                 | No                     |
| 13  | Assistant name, voice, disclosure | Prompt persona                                 | "ProfitCosmos Omega assistant", discloses it is an AI in its first message | Yes                    |
| 14  | Always-escalate topics            | `sensitive_topic` list                         | Refunds, payments, discounts, complaints, anything advice-like             | Yes                    |
| 15  | AI budget                         | Daily token ceiling                            | Low ceiling set by env                                                     | No                     |
| 16  | LLM provider                      | Adapter                                        | Anthropic Claude                                                           | No                     |

## 14. Decisions for the owner

Answer by number; anything left unanswered uses the default.

1. **Prompts**: approve the draft-then-approve flow in §7? (Default: yes.)
2. **Turns in the worker with polling** (§4) rather than answering inside the web request?
   (Default: worker.)
3. **Pre-chat form** with name, email and 18+ confirmation before the chat starts? (Default: yes.
   Alternative: anonymous chat first, contact later; more friction-free but harder on consent and
   age.)
4. **Under-18 mid-chat**: flag for staff (default) or move to `LOST` automatically?
5. **Automatic stages** limited to `ENGAGED` and `QUALIFYING` (§4)? (Default: yes.)
6. **Limits** in §8. (Default: as listed.)

## 15. Implementation notes and deviations

Owner implementation gates (review on the PR) and where they are enforced:

| Gate                                                                | Where                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompts stay `draft` until approval                                 | `config/prompts/*/v1.0.0.md`; `loadActivePrompt` refuses drafts outside `NODE_ENV=test`; unit test asserts no prompt is approved                                                          |
| Staff/form/import values never overwritten; quotes verified         | `executeTool` (protected sources), `applyLeadChanges` (`fillOnly`, `replaceableSources: ['ai']`); quotes located in the lead's stored messages, evidence keeps message id + offsets       |
| Every guardrail/classifier call is an `ai_run`; no prompt/tool text | `generateReply` and `runClassifier` record a row per call, including failures; rows hold codes and counts only; append-only trigger; log redaction for text, prompt and token keys        |
| Fail closed                                                         | Adapter errors, refusals, cut-off replies, classifier errors or invalid verdicts, prompt-loader errors, malformed usage/cost and tool errors all end in no AI text sent (fallback + flag) |
| Conversation tokens scoped and never logged                         | 32 random bytes, SHA-256 hash stored, compared in constant time with the conversation and organization; wrong token = 404; `accessToken`/`authorization` redacted from logs               |
| Stage rules limited to `NEW_LEAD→ENGAGED` and `ENGAGED→QUALIFYING`  | `STAGE_RULES` (the only two rules `applyStageRule` accepts), via `transitionLead`                                                                                                         |

Deviations from the plan above:

1. **Evidence**: stores the message id and the quote's character offsets in that message, not
   the quote text, so evidence never holds a copy of personal data (erasure clears the message).
2. **Turn scheduling**: one `agent.turn` job per conversation with a short lease
   (`processing_until`) instead of a pg-boss singleton key. A turn answers all queued lead
   messages together; a second worker gets "busy" and the job retries. Sending a message returns
   `201` with the message id.
3. **Model context**: no name at all is sent, only the transcript, what was collected in this chat,
   and the _names_ of fields known from other sources (values withheld, since the chat visitor
   may not be the person on file).
4. **Conversation status**: `active` / `closed`; pausing is the `ai_paused` flag.
5. **Escalation reasons** add `ai_error` and `limit_reached`. Any flag pauses the AI on the
   conversation; resolving a flag does not resume it.
6. **Timeline events**: `conversation.started`, `message.received`, `ai.replied`,
   `lead.ai_recorded`, `escalation.flagged`, `escalation.resolved`, `conversation.ai_paused`,
   `conversation.ai_resumed`. Blocked drafts are kept as `blocked` messages for staff review
   instead of an `ai.blocked` event; drafts that may disclose internal instructions (leak check
   or classifier) are stored without text.
7. **Rate limits**: 10 messages per minute per conversation and 60 requests per minute per IP
   (sending and polling), in-memory like the Phase 2 form limiter.
8. **Classifier** also flags claims to be human and other unsafe content; a reply rewritten after
   an unsupported-claim verdict still raises `cannot_confirm`.
9. **Model refusal** (`refusal` stop reason) is treated as an error: fallback reply and `ai_error`
   flag, no retry.
10. **Live evals** are not wired into CI (no API key secret exists); run `EVAL_LIVE=1 pnpm eval`
    by hand before asking for prompt approval.
11. **Chat page** shows the "team will follow up" notice whenever the assistant is not available
    (AI off, prompts not approved, paused or flagged).
12. **Founder answers** (2026-10-07, questions 1, 2, 13, 14): prompts move to 1.1.0 drafts (1.0.0
    retired); chat copy 0.2.0 is bilingual and still unapproved, and the pipeline refuses to run
    while it is unapproved (`copy_not_approved`). Always-escalate topics are detected in code
    (EN/FR, `config/guardrails/rules.ts`) and flag the conversation before any model call, even
    with the AI off; the run reason is `escalation_topic:<code>` and the flag reason is
    `sensitive_topic` or `human_requested` (no new enum values). The first reply must say it is
    an AI (`rule:ai_disclosure_missing`). The approval steps are in `docs/prompt-approval.md`.
13. **Founder answers** (2026-10-07, questions 6, 7, 9, 16 and the budget): both model slots default
    to Claude Haiku 4.5 (budget 50 CAD/month for hosting and AI); a monthly cost ceiling
    (`AI_MONTHLY_BUDGET_USD`, gate `org_monthly_budget`) joins the daily token ceiling, output caps
    drop to 1,000/500 tokens and dated model ids are priced by alias. The prompt asks for location
    and consultation availability when unknown and never says a prospect qualifies; no qualification
    field is added for availability (the team reads it in the transcript). The consultation
    schedule lives in `config/consultations.ts` for Phase 6; nothing is booked. Hand-overs are
    recorded and flagged only (no email).
