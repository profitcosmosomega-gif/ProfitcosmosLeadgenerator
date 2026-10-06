# ProfitCosmos Omega — AI Student Acquisition System
## Architecture & Implementation Plan (v0.1 — awaiting approval)

> Status: **PROPOSAL**. Nothing in this document is implemented yet. Implementation starts only after founder approval and answers to §20.

---

## 1. Key assumptions and missing requirements

### Assumptions (change any of these and the plan adjusts)
| # | Assumption |
|---|---|
| A1 | V1 has **one live inbound channel** (website/landing-page chat + lead form) plus **email** for confirmations/reminders. WhatsApp is the most likely second channel. |
| A2 | Lead volume in V1 is modest (hundreds to low thousands/month). No need for Kafka, Redis, microservices or a separate vector DB. |
| A3 | Users of the admin side are a small internal team (founder, 1–5 sales/consultants). Prospects never log in. |
| A4 | Consultations are 1:1 video calls run by humans; the AI only books them. |
| A5 | Payments/enrollment happen outside the system in V1; staff record enrollments (and revenue) manually or via a later webhook. |
| A6 | The AI may discuss programs, curriculum, schedule, process and (if approved) price ranges — **only** from approved knowledge base entries. |
| A7 | One brand, one language to start (English assumed — see §20). |
| A8 | The AI discloses that it is an AI assistant when asked (and ideally up-front). |
| A9 | Prospects must be 18+. |

### Missing requirements (need answers, see §20)
- Target countries/jurisdictions (drives consent, marketing-message law, data residency, and financial-promotion rules).
- Exact definition of "qualified" and of a "high-intent" consultation the sales team actually wants.
- Programs, prices and whether the AI may quote prices.
- Which calendar tool the team uses today; consultation length; who hosts.
- Where leads currently come from and current volume/conversion baseline (needed to *prove* the MVP worked).
- Existing CRM/spreadsheets to import.
- Handoff notification channel (email / Slack / WhatsApp) and response SLA.
- Brand voice, assistant name/persona, disclosure wording.
- Legal-reviewed disclaimer and consent text.

---

## 2. Recommended MVP architecture

**A modular monolith**: one TypeScript codebase, one PostgreSQL database, two processes.

```
                 ┌──────────────────────────────────────────────────────────┐
 Website /       │                    WEB PROCESS (Next.js)                 │
 landing page ──▶│  Public API (lead form, chat widget, booking, unsubscribe)│
 chat widget     │  Webhooks (calendar, email, future channels)             │
                 │  Admin UI (staff, auth + RBAC)                           │
                 └───────────────┬──────────────────────────────────────────┘
                                 │ domain services (src/modules/*)
                 ┌───────────────▼──────────────────────────────────────────┐
                 │                 PostgreSQL (single source of truth)      │
                 │ CRM · conversations · events · scores · KB · jobs queue  │
                 └───────────────▲──────────────────────────────────────────┘
                                 │ pg-boss job queue
                 ┌───────────────┴──────────────────────────────────────────┐
                 │                  WORKER PROCESS (Node)                   │
                 │ AI agent turns · scoring · follow-up sends · reminders   │
                 │ calendar sync · handoff notifications · analytics rollups│
                 └───────┬───────────────┬──────────────┬───────────────────┘
                         │               │              │
                    LLM provider   Calendar provider  Email provider
                   (adapter)        (adapter)          (adapter)
```

Principles:
- **API-first**: every admin/UI action goes through typed, Zod-validated service functions exposed as HTTP endpoints. The admin UI is just one client.
- **Domain modules** with clear boundaries (leads, conversations, agent, knowledge, scoring, booking, handoff, followup, attribution, analytics, compliance, channels). Modules call each other through service interfaces, never through each other's tables.
- **Append-only lead event log** (`lead_events`) is the timeline *and* the analytics source of truth.
- **Adapters for everything external** (LLM, calendar, email, channels, embeddings) behind small interfaces.
- **Async by default for AI and outbound comms** (jobs with retries + idempotency), sync for simple CRUD.
- **Deterministic core, AI at the edges**: the LLM converses and extracts; rules decide score, stage, consent and sending.
- **SaaS-ready, not SaaS-built**: every core table carries `organization_id` (one seeded org). No tenant UI, billing, or row-level security in V1.

---

## 3. Recommended technology stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript (strict)** | Requested; one language end to end. |
| Runtime | **Node.js 22 LTS** | Stable, broad library support. |
| Package manager | **pnpm** | Fast, strict dependency resolution. |
| Web framework | **Next.js (App Router)** | Admin UI + API routes + embeddable widget in one deployable; huge ecosystem. |
| Database | **PostgreSQL 16** | Relational CRM data, JSONB for flexible payloads, full-text search, `pgvector` later for RAG. |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | SQL-close, typed, no binary engine, first-class Postgres/pgvector support, plain SQL migrations committed to Git. |
| Validation | **Zod** | Shared schemas for API input, env vars, LLM tool I/O and config. |
| Background jobs | **pg-boss** | Job queue *inside Postgres* — retries, scheduling, cron, no Redis to operate. |
| Auth (staff) | **Better Auth** (or Auth.js) with roles | Email+password / magic link, sessions in Postgres, Drizzle adapter, RBAC. |
| LLM | **Anthropic Claude API** via an `LlmProvider` adapter | Strong tool use + instruction following for compliance-sensitive conversations; model IDs configured via env (larger model for conversation, small/fast model for extraction & classification). Swappable. |
| Embeddings (later) | Adapter (e.g. Voyage AI / OpenAI) + `pgvector` | Only when the KB outgrows full-text search. |
| Email | **Resend** or **Postmark** via `EmailProvider` | Transactional deliverability, webhooks for bounces/complaints. |
| Calendar | **Cal.com API** *or* **Google Calendar** via `CalendarProvider` | Founder decision (§20). |
| UI | Tailwind CSS + shadcn/ui | Fast, accessible admin UI, no heavy component framework. |
| Logging | **pino** (JSON), request IDs, PII redaction | Structured logs. |
| Errors / tracing | Sentry (optional in Phase 1) | Production visibility. |
| Testing | **Vitest** (unit/integration with real Postgres via Docker), **Playwright** (later E2E), LLM eval harness | |
| CI | **GitHub Actions** | Lint, typecheck, test, migration check on every PR. |
| Local dev | Docker Compose (Postgres + Mailpit) | One-command setup. |
| Hosting | Railway / Render / Fly.io (web + worker + managed Postgres), or Vercel (web) + Neon (DB) + a worker host | Founder decision; all are cheap at MVP scale. Docker image keeps us portable. |

Deliberately **not** used in V1: Redis, Kafka, microservices, Kubernetes, LangChain-style frameworks (thin custom orchestration is easier to audit), separate vector DB, GraphQL.

---

## 4. Database schema — core entities and relationships

All tables: `id` (UUID v7), `organization_id`, `created_at`, `updated_at`. PII columns flagged for encryption/redaction.

```
organizations 1─* users (staff, role: owner|admin|sales|viewer)

organizations 1─* leads
leads 1─1 lead_qualification          (typed discovered fields + evidence)
leads 1─* lead_events                  (append-only timeline)
leads 1─* stage_transitions            (pipeline history)
leads 1─* lead_scores                  (versioned score snapshots + breakdown)
leads 1─* channel_identities           (email / phone / whatsapp id / ig id …)
leads 1─* consents                     (per channel + purpose)
leads 1─* touchpoints                  (attribution)
leads 1─* conversations 1─* messages
leads 1─* appointments
leads 1─* handoffs
leads 1─* sequence_enrollments 1─* outbound_messages
leads 1─* enrollments                  (program, amount → revenue)
leads 1─* referrals (as referrer)  /  leads *─1 referred_by_lead

knowledge_documents 1─* knowledge_chunks   (embedding column added later)
scoring_rulesets (versioned config) 1─* lead_scores
sequences 1─* sequence_steps
campaigns 1─* touchpoints, campaigns 1─* ad_spend
ai_runs (every LLM call: model, prompt_version, tokens, latency, cost, tool calls)
audit_log (who did what to which record)
suppression_list (global do-not-contact by email/phone hash)
```

Key tables (abbreviated):

**leads** — `full_name, email, phone, country, timezone, locale, age_confirmed_18plus, status (pipeline stage), outcome_reason, owner_user_id, current_score, score_band, ai_paused (human takeover), conversation_summary, first_touch_id, last_touch_id, last_inbound_at, last_outbound_at, deleted_at`.

**lead_qualification** — `experience_level (beginner|intermediate|experienced|unknown), markets_of_interest[], main_difficulties[], goals[], reason_for_training, previous_training, desired_start (now|30d|90d|later|unknown), mentorship_interest (yes|maybe|no|unknown), purchase_intent_signals[], red_flags[], evidence JSONB` — evidence maps each field to `{value, source_message_id, quote, extracted_by, confidence, at}` so every field is explainable and correctable by staff.

**lead_events** — `lead_id, type (lead.created, message.received, field.updated, stage.changed, score.changed, appointment.booked, handoff.created, consent.revoked, …), actor (system|ai|user:<id>|lead), payload JSONB, occurred_at`. Never updated, never deleted (except via data-deletion workflow).

**conversations / messages** — `channel, external_thread_id, status, ai_enabled`; messages: `direction (in|out), author (lead|ai|staff|system), body, channel_message_id, kb_citations[], guardrail_result JSONB, ai_run_id, delivered_at, read_at`.

**lead_scores** — `score (0–100), band, ruleset_id, ruleset_version, breakdown JSONB [{rule_id, label, points, evidence}], computed_at, trigger_event_id`.

**appointments** — `provider, external_id, host_user_id, starts_at, ends_at, timezone, status (booked|rescheduled|canceled|completed|no_show), meeting_url, reminder_state, outcome_notes`.

**handoffs** — `reason (high_intent|human_requested|kb_miss|sensitive|booked|manual), brief JSONB, assigned_to, status (open|acknowledged|resolved), sla_due_at, resolved_at`.

**consents** — `channel (email|sms|whatsapp|…), purpose (transactional|marketing), status (granted|revoked), source (form|chat|import|staff), evidence (text shown, IP, user agent, url), captured_at, revoked_at`.

**touchpoints** — `occurred_at, source, medium, platform, campaign, ad_set, ad, content, term, landing_page, referrer, click_ids JSONB (gclid, fbclid, ttclid), raw_utm JSONB, is_first_touch, is_last_touch`.

**ad_spend** — `date, platform, campaign_id, spend, currency, source (csv|api)`.

**enrollments** — `lead_id, program, amount, currency, enrolled_at, recorded_by`.

**knowledge_documents** — `category (program|curriculum|pricing|schedule|faq|policy|philosophy|deliverables|enrollment|objection|compliance), title, body (markdown), status (draft|approved|archived), version, approved_by, approved_at, effective_from/to, tags[]`. Chunks: `document_id, content, tsvector, embedding vector NULL`.

---

## 5. Repository / folder structure

```
.
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (admin)/              # staff dashboard pages (auth required)
│   │   ├── (public)/             # booking page, unsubscribe/preferences page
│   │   ├── widget/               # embeddable chat widget
│   │   └── api/
│   │       ├── v1/               # versioned REST API (leads, conversations, …)
│   │       ├── public/           # lead form, chat, slots (rate-limited)
│   │       ├── webhooks/         # calendar, email, channels (signature-verified)
│   │       └── health/
│   ├── modules/                  # domain modules (each: schema.ts, service.ts, repo.ts, types.ts, *.test.ts)
│   │   ├── leads/  crm/  conversations/  agent/  knowledge/  scoring/
│   │   ├── booking/  handoff/  followup/  attribution/  analytics/
│   │   ├── compliance/           # consent, suppression, guardrails, deletion
│   │   └── channels/             # adapter interface + web, email (later whatsapp, …)
│   ├── providers/                # llm/, calendar/, email/, embeddings/ adapters
│   ├── db/
│   │   ├── schema/               # Drizzle table definitions
│   │   ├── migrations/           # generated SQL, committed
│   │   └── seed.ts
│   ├── worker/                   # pg-boss bootstrap + job handlers
│   └── lib/                      # env, logger, errors, auth, rbac, ids, time
├── config/
│   ├── scoring/default.ruleset.ts
│   ├── pipeline.ts               # stages + allowed transitions
│   └── prompts/                  # versioned agent prompts
├── knowledge/                    # approved KB source (markdown + frontmatter), imported by script
├── tests/
│   ├── integration/
│   └── evals/                    # scripted conversation fixtures for the AI agent
├── docs/
│   ├── ARCHITECTURE_PLAN.md      # this file
│   ├── adr/                      # architecture decision records
│   └── compliance.md
├── .github/workflows/ci.yml
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── CLAUDE.md                     # conventions for AI-assisted development
└── README.md
```

---

## 6. AI qualification-agent architecture

**Turn pipeline** (runs in the worker, one job per inbound message, serialized per conversation):

1. **Ingest** — channel adapter normalizes the inbound message → `messages` row → `lead_events` → enqueue `agent.turn`.
2. **Gate** — skip AI if `ai_paused` (human takeover), lead unsubscribed from this channel, outside channel messaging window, or rate limit hit.
3. **Build context**
   - System prompt (versioned file) = role, brand voice, **compliance rules**, education-not-advice boundary, AI disclosure.
   - Lead state: known qualification fields + **gaps** still to discover (computed deterministically).
   - Conversation: last N messages + rolling summary.
   - Retrieved KB entries relevant to the message (§11).
   - Allowed next actions given stage (e.g. offer booking only if minimum fields known).
4. **LLM call with tools** (structured tool use, Zod-validated):
   - `search_knowledge(query)` → approved entries with IDs.
   - `record_qualification(fields, evidence_quote)` → writes fields with provenance.
   - `update_contact(name/email/phone)`.
   - `get_available_slots(range)` / `book_consultation(slot, contact)`.
   - `request_human(reason, note)` — **mandatory** when the answer is not in the KB, the topic is sensitive (refunds, complaints, legal, personal financial situation, distress), or the lead asks for a human.
   - `record_opt_out(channel)`.
5. **Guardrails on output** (before sending):
   - Rule-based filter for prohibited claims (guaranteed / risk-free / "you will make", income figures, specific trade recommendations).
   - Small-model classifier check for: personalized financial advice, unsupported factual claims (answer must cite KB IDs when stating facts about programs/prices/policies).
   - On failure: regenerate once with feedback → else send a safe fallback + create handoff.
6. **Send** via channel adapter; persist with citations + guardrail result + `ai_run_id`.
7. **Post-turn (deterministic)**: recompute score (§7) → evaluate stage transitions (§8) → evaluate handoff triggers (§10) → update follow-up enrollments (§12) → refresh rolling summary (async, cheap model).

**Conversation design**: one question at a time, acknowledge before asking, mirror the prospect's language level, never interrogate; prioritize gaps by value (timeline & intent before nice-to-haves); offer booking once minimum qualification is met or when the prospect asks.

**Safety & quality**
- Lead messages are untrusted input → prompt-injection resistant prompt structure, tools only act on *the current lead*, no tool can read other leads.
- Max turns per day / tokens per lead caps; cost tracked in `ai_runs`.
- **Eval harness** (`tests/evals`): scripted personas (beginner, experienced, "guarantee me profits", asks unknown question, wants a human, minor, abusive, prompt-injection) with assertions on extracted fields, escalations and absence of prohibited claims. Runs in CI on prompt changes.
- Prompts versioned in Git; every message records which prompt version produced it.

---

## 7. Explainable lead-scoring architecture

**Separation of concerns**: the LLM *extracts signals with evidence*; a **deterministic, configurable rules engine** computes the score.

```
signals (qualification fields + engagement metrics + events)
        │
        ▼
ruleset (versioned config, stored in DB, default in config/scoring)
        │  each rule: id, label, category, condition, points, cap
        ▼
score = clamp(0..100, Σ points)  +  breakdown[] (rule, points, evidence)  →  band
```

Example default ruleset (to be tuned with sales team):

| Category (cap) | Rule | Points |
|---|---|---|
| Fit (35) | Experience level known | +5 |
| | Markets of interest align with offered programs | +10 |
| | Clear main difficulty stated | +10 |
| | Concrete goal stated | +10 |
| Intent (40) | Wants to start ≤ 30 days | +15 (≤ 90 days: +8) |
| | Mentorship interest = yes (maybe: +5) | +10 |
| | Asked about price / enrollment / schedule | +10 |
| | Requested a call / human | +15 |
| Engagement (25) | ≥ 3 replies | +5 |
| | Replied within 24h of last outbound | +5 |
| | Provided phone/email voluntarily | +5 |
| | Booked consultation | +10 |
| Negative | Expects guaranteed returns (needs expectation reset, flagged) | −10 |
| | No reply in 14 days | −10 |
| Disqualifiers | Under 18 / explicit "not interested" / spam | score 0 → LOST or NURTURE |

Bands (configurable): **0–39 NURTURE**, **40–69 INTERESTED**, **70–100 HIGH INTENT**.

- Every score write stores `breakdown` + `ruleset_version` → staff see *why* ("+15 wants to start this month — 'I want to begin next week'").
- Score recomputed on relevant events; history kept for analysis (did score predict enrollment?).
- Ruleset editable by admins later via UI; V1 edits via config + migration-style versioning.
- Later: calibrate weights against actual enrollments (logistic regression offline), still output as additive explainable points.

---

## 8. CRM pipeline architecture

- **Explicit state machine** in `config/pipeline.ts`: stages `NEW_LEAD → ENGAGED → QUALIFYING → QUALIFIED → CONSULTATION_BOOKED → CONSULTATION_COMPLETED → ENROLLMENT_PENDING → ENROLLED`, plus `NURTURE` and `LOST` (with `outcome_reason`), allowed transitions listed explicitly.
- **Automatic transitions** from events, e.g. first inbound reply → ENGAGED; AI starts discovery → QUALIFYING; minimum fields + band ≥ INTERESTED → QUALIFIED; booking webhook → CONSULTATION_BOOKED; appointment marked completed → CONSULTATION_COMPLETED; enrollment recorded → ENROLLED; no response after nurture threshold → NURTURE.
- **Manual transitions** by staff (with reason) always allowed within the transition table; logged to `stage_transitions` + `audit_log`.
- A single `crm.transition(leadId, to, actor, reason)` service enforces rules and emits `stage.changed` — the only way to change stage.
- **Referral** tracked as a relationship (`referred_by_lead_id`) + `referrals` row, not a stage, since enrolled students can refer while staying ENROLLED.
- Lead **deduplication** on normalized email/phone (E.164) with merge tooling for staff.

---

## 9. Appointment-booking architecture

```ts
interface CalendarProvider {
  getAvailability(params: { hostIds?: string[]; from: Date; to: Date; durationMin: number; tz: string }): Promise<Slot[]>;
  createBooking(input: { slot: Slot; attendee: { name; email; phone? }; notes: string; idempotencyKey: string }): Promise<Booking>;
  cancelBooking(externalId: string, reason?: string): Promise<void>;
  rescheduleBooking(externalId: string, slot: Slot): Promise<Booking>;
  parseWebhook(req: Request): Promise<CalendarEvent | null>; // booked/rescheduled/canceled
}
```

- V1 implementation: **Cal.com** (availability + booking + webhooks, handles round-robin, buffers, Google/Outlook sync, video links) — or **Google Calendar** directly if founder prefers (more work: we own availability rules).
- Flow: AI offers 3 slots in the lead's timezone → lead picks → collect/confirm name + email (+ phone) → `createBooking` with idempotency key → `appointments` row → stage CONSULTATION_BOOKED → confirmation email (+ .ics) → reminder jobs (24h, 1h) scheduled → handoff brief sent to host.
- Webhooks keep our state in sync with reschedules/cancels made outside the system.
- Slot re-validated at booking time to avoid double booking; all times stored UTC + display tz.
- No-show / completed marked by host in admin (or provider webhook) → triggers follow-up sequences.
- Fallback: hosted booking link if the API call fails.

---

## 10. Human-handoff architecture

**Triggers** (rules, not LLM whims): score crosses HIGH INTENT; lead asks for a human; KB miss (`request_human` tool); sensitive topic detected; guardrail failure; consultation booked (brief for host); staff manual request.

**Handoff record** with a generated **brief** (template filled from structured data; LLM writes only the summary paragraph):

```
Prospect:        Jane Doe · jane@… · +44… · UK (GMT)
Experience:      Beginner (6 months demo trading)
Markets:         Forex, Indices
Main challenge:  Inconsistent entries, emotional trading
Goal:            Build a disciplined part-time routine
Timeline:        Wants to start within 30 days
Lead score:      78 / HIGH INTENT  (+15 timeline, +10 mentorship, +10 asked price, …)
Status:          QUALIFIED
Appointment:     Thu 10 Oct 15:00 BST with <host> (or "not booked")
Source:          Instagram ad "Forex Foundations" → landing page /start
Why handed off:  Asked about payment plans (not in KB)
Summary:         3–5 sentences
Open questions:  …
```

- **Delivery**: admin "Handoffs" queue + notification (email in V1; Slack/WhatsApp later) to owner/round-robin assignee; SLA timer with escalation.
- **Takeover**: staff can pause AI per conversation (`ai_paused`) and reply from the admin inbox; resume AI explicitly. Staff replies are logged as `author=staff`.
- The AI tells the lead honestly what happens next ("A member of our team will reply within X hours").

---

## 11. Knowledge-base / RAG architecture

- **Source of truth**: `knowledge_documents` with **draft → approved → archived** workflow, versioning, approver and effective dates. Only `approved` + currently effective entries are retrievable by the AI.
- **Authoring in V1**: markdown files in `/knowledge` (frontmatter: category, tags, status) imported by a script → reviewed in Git PRs (gives free version history and approvals). Admin UI editor comes in a later phase.
- **Retrieval V1**: the approved KB will likely be small (tens of entries). Strategy:
  1. Category/tag routing + **Postgres full-text search** (tsvector) over chunks, top-k entries passed with IDs; **and/or**
  2. If total approved KB fits comfortably in context, include it whole with prompt caching (simplest, most reliable).
- **RAG expansion** (when KB grows): add `embedding vector` column (pgvector) + `EmbeddingProvider` adapter → **hybrid search** (FTS + vector, reciprocal-rank fusion) → optional reranker. Same `knowledge.search()` interface, so the agent doesn't change.
- **Grounding contract**: factual statements about programs/pricing/policies must cite KB IDs; the guardrail rejects uncited factual claims; KB miss → honest "I'll check with the team" + handoff. KB misses are logged → a "questions we couldn't answer" report drives KB growth.
- **Compliance entries** (risk disclaimers, "education not advice", no-guarantee statements) are pinned and always included.

---

## 12. Follow-up automation architecture

- **Sequences as data**: `sequences` (trigger, exit conditions) → `sequence_steps` (delay, channel, template id, optional AI personalization, send window).
- **Triggers**: `lead.created` w/o reply, stalled conversation (no reply X h), QUALIFIED but not booked, appointment booked (reminders), no-show, completed-not-enrolled, NURTURE (long-term, low frequency).
- **Exit conditions**: lead replies, books, stage changes, unsubscribes, handoff opened, staff stops it.
- **Execution**: pg-boss scheduled job per step → at send time re-check **consent, suppression, quiet hours (lead timezone), frequency caps, channel window rules**, and exit conditions → render template (approved copy; AI personalization constrained + guardrailed) → send via adapter with idempotency key → `outbound_messages` + event.
- **Unsubscribe**: one-click link (email, RFC 8058 List-Unsubscribe), "STOP" keyword handling for SMS/WhatsApp later, preference page; revocation is immediate and global for that channel/purpose.
- V1 ships the engine + **3 sequences**: new inquiry no-reply, qualified-not-booked, consultation reminders (+ no-show rebook).

---

## 13. Attribution and analytics architecture

**Capture**
- Small JS snippet on landing pages stores UTM params, click IDs (gclid/fbclid/ttclid), referrer and landing page in a first-party cookie on first visit and on every new campaign visit.
- Lead form / chat widget submit sends these → `touchpoints`; first and last touch flagged; `leads.first_touch_id/last_touch_id`.
- Future channel adapters (Meta lead ads, IG DMs from ads) create touchpoints from platform metadata.
- `campaigns` normalize naming; `ad_spend` imported by **CSV in V1** (APIs later).

**Metrics** (SQL views/materialized views over events, stages, appointments, enrollments, spend):
total leads, leads by source/campaign, qualified leads, qualification rate, avg score, consultations booked, booking conversion, show rate, enrollments, enrollment conversion, CPL, cost per qualified lead, cost per appointment, cost per enrolled student, attributed revenue (first- and last-touch).

**Honesty rule**: every metric returns `{ value | null, numerator, denominator, coverage, reason }`. Missing spend → cost metrics show "No spend data", never 0 or an estimate. Small samples flagged.

---

## 14. Future social-media / channel integration strategy

```ts
interface ChannelAdapter {
  channel: 'web' | 'email' | 'whatsapp' | 'instagram' | 'messenger' | 'sms' | 'tiktok' | …;
  capabilities: { freeformWindowHours?: number; requiresTemplates: boolean; media: boolean; … };
  verifyWebhook(req): boolean;
  parseInbound(req): NormalizedInbound[];            // → identity resolution → conversation
  send(msg: NormalizedOutbound): Promise<SendResult>;
  parseStatus?(req): DeliveryStatus[];
}
```

Recommended order after V1:
1. **WhatsApp Business Cloud API** (highest conversation value for trading education; needs approved templates outside 24h window, opt-in required).
2. **Instagram DM + Facebook Messenger** (same Meta platform/app review; 24h window rules).
3. **Lead-form integrations** (Meta Lead Ads, TikTok Lead Gen, Google Ads lead forms) → create leads + touchpoints, AI starts conversation via an opted-in channel.
4. **SMS** (Twilio) — strict consent law in many countries (e.g. TCPA in US).
5. **YouTube / TikTok** — mainly attribution + link-in-bio landing pages, not messaging.
6. **Webinars** (Zoom/WebinarJam webhooks → events: registered, attended).

Note: ad platforms have specific policies for financial-services/trading ads; the content side (Phase 11) must respect them.

---

## 15. Security, privacy and compliance risks

| Risk | Mitigation |
|---|---|
| AI makes guaranteed-profit or performance claims | Hard system rules + rule-based & model-based output guardrails + KB-only facts + evals in CI + human review of sampled conversations. |
| AI gives personalized financial/investment advice | Explicit boundary in prompt; classifier; scripted deflection ("we teach how to analyse markets; we can't tell you what to trade"); disclaimer KB entries. Possible regulatory exposure (e.g. FCA/SEC/ASIC/SEBI financial-promotion rules) → legal review per jurisdiction. |
| Marketing without consent (GDPR, ePrivacy, CAN-SPAM, TCPA, CASL, LGPD, POPIA, WhatsApp policy) | Consent records per channel/purpose with evidence; send-time consent check; suppression list; unsubscribe on every marketing message; transactional vs marketing separation. |
| Minors | Age confirmation (18+) before qualification; disqualify + stop contact. |
| PII breach | TLS, encrypted DB at rest, column-level encryption for phone/email if required, least-privilege DB user, secrets in env/secret manager, no PII in logs (pino redaction), RBAC, MFA for admins, rate limiting, webhook signature verification, dependency scanning. |
| Prompt injection via lead messages | Treat input as data, tools scoped to current lead, no secrets in prompts, output guardrails, no autonomous actions beyond the narrow tool set. |
| Sending data to LLM vendor | Vendor DPA, zero-retention settings where available, minimize PII in prompts, disclose in privacy policy. |
| Right to access / erasure | Data export endpoint + deletion workflow (hard-delete PII, keep anonymized aggregates and an erasure record). |
| Auditability | `audit_log` for staff actions; `lead_events`; `ai_runs` record prompt version/model per AI message. |
| AI impersonating a human | Disclose AI nature; never claim to be a person. |
| Data retention | Configurable retention for inactive leads and raw conversations. |

---

## 16. Features NOT in V1

- Social channels (WhatsApp, IG, FB, TikTok, YouTube, SMS) — interfaces only.
- Content generation / auto-posting / campaign automation; ad-platform API integrations (spend via CSV).
- Payments, checkout, invoicing, LMS/enrollment provisioning.
- Multi-tenant features: tenant onboarding, billing, white-labeling, RLS, per-tenant config UI.
- Voice / phone AI agents.
- Vector RAG (unless KB is already large), rerankers, fine-tuning.
- ML-trained scoring (rules only; calibrate later).
- Multi-touch attribution models beyond first/last touch.
- Custom dashboard builder, A/B testing framework, mobile app.
- AI closing sales or negotiating price/discounts.
- Multi-language (unless founder says it's essential day one).

---

## 17. Exact Phase 1 implementation plan — Architecture & repository foundation

Goal: a production-grade, empty-but-runnable skeleton that every later phase plugs into. **No business features yet.**

| Step | Deliverable | Done when |
|---|---|---|
| 1.1 | Repo tooling: pnpm, Node 22 (`.nvmrc`), TypeScript strict, ESLint (typescript-eslint), Prettier, EditorConfig, `.gitignore` | `pnpm lint` and `pnpm typecheck` pass |
| 1.2 | Next.js App Router app scaffold with `(admin)`, `(public)`, `api/` route groups; Tailwind + shadcn/ui base | `pnpm dev` serves a placeholder admin shell |
| 1.3 | `src/lib/env.ts` — Zod-validated env; `.env.example` documented | App fails fast with clear message on bad env |
| 1.4 | `src/lib/logger.ts` — pino JSON logger, request ID middleware, PII redaction paths | Logs structured with request IDs |
| 1.5 | `src/lib/errors.ts` + API helper — typed errors → consistent JSON error envelope; Zod input validation helper | Unit tests for error mapping |
| 1.6 | Docker Compose: Postgres 16 (+ pgvector image for later), Mailpit | `docker compose up` works |
| 1.7 | Drizzle setup: config, `db` client, migration scripts; **foundation tables only**: `organizations`, `users`, auth tables, `audit_log`; seed (ProfitCosmos org + owner user) | `pnpm db:migrate && pnpm db:seed` works on clean DB |
| 1.8 | Staff authentication (Better Auth) with roles `owner/admin/sales/viewer`; RBAC helper; protected admin layout; login page | Integration test: unauthenticated → 401; viewer can't hit admin-only route |
| 1.9 | Worker process: `src/worker/index.ts` with pg-boss bootstrap, graceful shutdown, a sample `system.heartbeat` job | `pnpm worker` runs and processes a test job |
| 1.10 | Provider interface stubs (types only): `LlmProvider`, `CalendarProvider`, `EmailProvider`, `ChannelAdapter` + email provider dev implementation (Mailpit/SMTP) | Types compile; email dev send test passes |
| 1.11 | `GET /api/health` (DB + queue check) | Returns 200 with component status |
| 1.12 | Testing: Vitest config, test DB helper (migrate per run, truncate per test), first unit + integration tests | `pnpm test` green locally and in CI |
| 1.13 | GitHub Actions CI: install, lint, typecheck, test (Postgres service), `drizzle-kit check` | CI green on PR |
| 1.14 | Dockerfile (multi-stage) for web + worker | Image builds |
| 1.15 | Docs: README (§18), `docs/adr/0001-modular-monolith.md`, `0002-postgres-pg-boss.md`, `0003-deterministic-scoring.md`, `docs/compliance.md` (principles + prohibited claims list), `CLAUDE.md` (conventions) | Docs reviewed |
| 1.16 | Placeholder `config/pipeline.ts` + `config/scoring/default.ruleset.ts` types (no logic) to lock the shapes | Reviewed with founder |

Estimated effort: ~3–5 focused working days. Output: one PR to the development branch.

**Phases 2–12 at a glance** (each a separate approved PR series):
2 Lead DB & CRM (leads, qualification, events, pipeline state machine, consents, touchpoints capture, lead form API, admin lead list/detail/timeline, CSV import) ·
3 AI qualification agent (web chat widget, conversations, agent turn pipeline, guardrails, evals) ·
4 Knowledge base (markdown import, approval workflow, FTS retrieval, KB-miss report) ·
5 Lead scoring (rules engine, breakdown UI, history) ·
6 Calendar & booking (provider adapter, slots in chat, confirmations, reminders, webhooks) ·
7 Human handoff (triggers, briefs, queue, notifications, takeover inbox) ·
8 Follow-up automation (sequence engine, 3 sequences, unsubscribe/preferences) ·
9 Analytics dashboard (metric views, spend CSV import, funnel & source reports) ·
10 Channels (WhatsApp → IG/Messenger → lead ads) ·
11 Content/campaign automation (compliance-reviewed) ·
12 Multi-tenant SaaS (tenant isolation/RLS, onboarding, billing, per-tenant config).

> Note: phases 4 and 5 are tightly coupled to phase 3; a minimal KB and scoring will land alongside phase 3 so the agent can be tested end-to-end, then be expanded in their own phases. The first **real-lead validation** milestone is after phases 2–7 (minimal), roughly the "website chat → qualify → book → handoff" loop.

---

## 18. Proposed README structure

1. **ProfitCosmos Omega — AI Student Acquisition System** (one-paragraph purpose + "education, not financial advice; no guaranteed results" statement)
2. Status & roadmap (phase checklist)
3. Architecture overview (diagram + link to `docs/ARCHITECTURE_PLAN.md` and ADRs)
4. Tech stack
5. Getting started — prerequisites, `cp .env.example .env`, `docker compose up -d`, `pnpm i`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, `pnpm worker`
6. Environment variables (table)
7. Project structure
8. Scripts (dev, worker, lint, typecheck, test, db:*, evals)
9. Testing strategy (unit, integration, AI evals)
10. Domain concepts — funnel stages, lead scoring, handoff, knowledge base
11. Compliance & data protection principles (prohibited claims, consent, deletion)
12. Deployment
13. Contributing workflow (branches, PRs, CI, commit conventions)
14. License / ownership

---

## 19. Major technical risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LLM hallucination / non-compliant claims | Legal + brand damage | KB grounding with citations, layered guardrails, evals in CI, sampling review, easy kill-switch (`AI_ENABLED=false` → human-only mode). |
| AI feels robotic or pushy → low conversion | MVP fails to validate | Conversation design principles, real transcript reviews weekly, prompt versioning + A/B later, human takeover. |
| Over-scoping before validation | Slow time-to-real-leads | Strict phase gates; first live loop = web chat → qualify → book → handoff. |
| LLM cost / latency spikes | Budget, UX | Small model for extraction/summaries, caps per lead, prompt caching, cost tracking in `ai_runs`, alerts. |
| Calendar sync bugs (timezones, double booking) | Missed consultations | Provider handles availability; UTC storage; re-validation at booking; webhooks; idempotency; tests across DST. |
| Email/WhatsApp deliverability & platform bans | Channel loss | Proper domain auth (SPF/DKIM/DMARC), consent-only marketing, frequency caps, bounce/complaint handling, template approvals. |
| Lead data quality (duplicates, fake numbers) | Bad metrics | Normalization (E.164, lowercased emails), dedup + merge, validation, bot protection (rate limit + Turnstile). |
| Vendor lock-in (LLM, calendar, email) | Switching cost | Adapter interfaces + contract tests per provider. |
| Unmeasurable MVP outcome | Can't decide to scale | Capture baseline now; events + attribution from day one; honest metrics. |
| Security incident | Trust, legal | RBAC, MFA, encryption, audit logs, secret management, dependency scanning, minimal PII to third parties. |
| Future multi-tenancy retrofit pain | Rewrite | `organization_id` everywhere from day one, config-driven behavior (prompts, KB, scoring, pipeline) instead of hard-coded ProfitCosmos logic. |

---

## 20. Questions requiring founder / business decisions

**Market & legal**
1. Which countries do prospects come from, and where is the business registered? (Consent law, financial-promotion rules, data residency.)
2. Do you have legal-approved risk disclaimer, privacy policy and consent wording? Who signs off on compliance copy?
3. Languages required at launch?

**Funnel & sales**
4. What channel do most leads come through *today* (website, IG, WhatsApp, ads, webinars)? Monthly volume and current lead→consultation→enrollment rates?
5. V1 primary channel: website chat widget (recommended for fastest build) or WhatsApp first?
6. Your definition of a "qualified" prospect and of "high intent". Any hard disqualifiers (age, budget, region)?
7. Who runs consultations? How many hosts, duration, working hours/timezones?
8. Calendar tool used today (Calendly, Cal.com, Google Calendar, other)?
9. How should humans be notified of handoffs (email, Slack, WhatsApp)? Expected response time?
10. Do you use a CRM or spreadsheet today that we must import or sync with?

**Offer & AI behaviour**
11. Programs, curriculum, schedules and prices — may the AI state prices, or only "a consultant will explain options"?
12. Approved objection-handling answers? (Cost, time commitment, "does it work", "I lost money before".)
13. Assistant name/persona and brand voice? Confirm the AI will disclose it's an AI.
14. Topics the AI must always escalate (refunds, payment plans, discounts, complaints, …)?

**Operations & budget**
15. Hosting preference/budget, and monthly budget ceiling for AI usage.
16. LLM provider preference (recommendation: Anthropic Claude via adapter).
17. Email sending domain available (for SPF/DKIM/DMARC)?
18. How are enrollments and payments recorded today (so we can attribute revenue)?
19. Can you export ad spend per campaign (CSV) from Meta/Google/TikTok?
20. What result after ~60–90 days would count as "MVP validated" (e.g. +X% qualified consultations, −Y hours manual work)?
