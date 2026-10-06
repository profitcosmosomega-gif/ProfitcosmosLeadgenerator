# Phase 2 plan — Lead database and CRM

> Status: **PROPOSAL, awaiting approval.** No Phase 2 code exists yet. Implementation starts after
> the questions in §9 are answered (or the listed defaults are accepted).

## 1. Goal

Give ProfitCosmos Omega a working lead database and CRM: leads can come in through a web form or a
CSV import, staff can see and work them in a pipeline, and every change is recorded on a timeline.
This is the base that the AI agent (Phase 3), scoring (Phase 5), booking (Phase 6) and handoff
(Phase 7) build on.

## 2. Scope

**In Phase 2**

1. Lead records with contact details, source and qualification fields.
2. An append-only timeline (`lead_events`) for every lead.
3. The pipeline state machine: allowed stage transitions, enforced in one place.
4. Consent records per channel and purpose, plus a do-not-contact (suppression) list.
5. Attribution capture: UTM parameters, click IDs, landing page, referrer; first and last touch.
6. A public lead-capture API for website and landing-page forms (rate-limited, spam-protected).
7. Staff API and admin screens: lead list with filters, lead detail with timeline, stage changes,
   notes, owner assignment, and manual edits.
8. CSV import of existing leads, with a dry-run preview and duplicate detection.
9. Data-subject requests: export one lead's data, and erase a lead's personal data.

**Not in Phase 2** (later phases, unchanged from the approved plan)

AI conversations and chat widget (3), knowledge base (4), lead scoring rules (5), calendar and
booking (6), handoff briefs and notifications (7), automated follow-ups and outbound messages (8),
analytics dashboard and ad-spend import (9), social channels (10). No production prompt text.

## 3. Data model

All tables carry `organization_id` (single tenant, as in Phase 1), UUID v7 ids and `timestamptz`
timestamps. New tables:

| Table                | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `leads`              | Contact details, stage, outcome reason, owner, source summary, timestamps  |
| `lead_qualification` | One row per lead: experience, markets, difficulties, goals, timeline, etc. |
| `lead_events`        | Append-only timeline (created, field changed, stage changed, note, import) |
| `stage_transitions`  | Pipeline history: from, to, actor, reason, time                            |
| `consents`           | Per channel (email, SMS, WhatsApp…) and purpose (transactional, marketing) |
| `suppression_list`   | Global do-not-contact by hashed email/phone, survives lead erasure         |
| `touchpoints`        | Attribution: source, medium, campaign, ad, content, term, click IDs, page  |
| `lead_imports`       | One row per CSV import: file name, counts, who ran it, result              |

Key fields on `leads`: `full_name`, `email` (lower-cased), `phone` (E.164), `country`, `timezone`,
`locale`, `age_confirmed_18plus`, `stage`, `outcome_reason`, `owner_user_id`, `first_touch_id`,
`last_touch_id`, `last_activity_at`, `erased_at`.

Qualification fields (all optional, filled by staff now and by the AI in Phase 3):
`experience_level` (beginner / intermediate / experienced / unknown), `markets_of_interest[]`,
`main_difficulties[]`, `goals[]`, `reason_for_training`, `previous_training`, `desired_start`
(now / 30 days / 90 days / later / unknown), `mentorship_interest` (yes / maybe / no / unknown),
and `evidence` (JSON: where each value came from — staff, import, form, later AI with quote).

Fields from the approved plan that belong to later phases (`current_score`, `ai_paused`,
`conversation_summary`, appointments, handoffs) are **not** added in Phase 2. They arrive with the
phase that uses them.

**Duplicates**: a lead is matched by normalised email or phone. A new form submission or import row
that matches an existing lead updates it and adds a touchpoint instead of creating a second lead.
Staff can merge two leads by hand (the timeline keeps both histories).

## 4. Pipeline state machine

Stages: `NEW_LEAD → ENGAGED → QUALIFYING → QUALIFIED → CONSULTATION_BOOKED →
CONSULTATION_COMPLETED → ENROLLMENT_PENDING → ENROLLED`, plus `NURTURE` and `LOST`.

Proposed allowed transitions (`config/pipeline.ts`):

| From                     | Can move to                                    |
| ------------------------ | ---------------------------------------------- |
| `NEW_LEAD`               | `ENGAGED`, `QUALIFYING`, `NURTURE`, `LOST`     |
| `ENGAGED`                | `QUALIFYING`, `NURTURE`, `LOST`                |
| `QUALIFYING`             | `QUALIFIED`, `NURTURE`, `LOST`                 |
| `QUALIFIED`              | `CONSULTATION_BOOKED`, `NURTURE`, `LOST`       |
| `CONSULTATION_BOOKED`    | `CONSULTATION_COMPLETED`, `QUALIFIED`*, `LOST` |
| `CONSULTATION_COMPLETED` | `ENROLLMENT_PENDING`, `NURTURE`, `LOST`        |
| `ENROLLMENT_PENDING`     | `ENROLLED`, `NURTURE`, `LOST`                  |
| `ENROLLED`               | — (final)                                      |
| `NURTURE`                | `ENGAGED`, `QUALIFYING`, `QUALIFIED`, `LOST`   |
| `LOST`                   | `NURTURE` (re-open)                            |

\* back to `QUALIFIED` when a consultation is cancelled or the prospect does not show.

Rules:

- One service function, `crm.transition(leadId, to, actor, reason)`, is the only way to change a
  stage. It checks the table, writes `stage_transitions`, a `lead_events` entry and the audit log.
- Moving to `LOST` or `NURTURE` requires a reason.
- In Phase 2 every transition is manual (staff). Automatic transitions (e.g. first reply →
  `ENGAGED`) arrive with the features that trigger them in Phases 3–7.

## 5. API

Public (no login, for website forms):

| Endpoint                 | Does                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `POST /api/public/leads` | Create or update a lead from a form, with consent and attribution fields |

Protection: per-IP rate limit, hidden honeypot field, strict validation and size limits, and an
allow-list of form origins. Response never reveals whether the email already exists.

Staff (login required; minimum role in brackets):

| Endpoint                                  | Role   | Does                                     |
| ----------------------------------------- | ------ | ---------------------------------------- |
| `GET /api/v1/leads`                       | viewer | List with filters, search, pagination    |
| `GET /api/v1/leads/:id`                   | viewer | Lead detail, qualification, consents     |
| `GET /api/v1/leads/:id/timeline`          | viewer | Timeline events                          |
| `POST /api/v1/leads`                      | sales  | Create a lead by hand                    |
| `PATCH /api/v1/leads/:id`                 | sales  | Edit contact/qualification fields, owner |
| `POST /api/v1/leads/:id/transition`       | sales  | Change stage (rules in §4)               |
| `POST /api/v1/leads/:id/notes`            | sales  | Add a note to the timeline               |
| `POST /api/v1/leads/:id/consents`         | sales  | Record or revoke consent                 |
| `POST /api/v1/leads/merge`                | admin  | Merge two duplicate leads                |
| `POST /api/v1/imports` (dry-run + commit) | admin  | CSV import                               |
| `GET /api/v1/leads/:id/export`            | admin  | Data-subject export (JSON)               |
| `DELETE /api/v1/leads/:id`                | owner  | Erase personal data, add to suppression  |

Erasure removes personal data (name, email, phone, free-text answers, notes) and keeps an anonymous
record (stage history, timestamps, attribution without personal data) plus a hashed suppression
entry, so the person is never contacted again and aggregate numbers stay correct.

## 6. Admin screens

- **Leads**: table with stage, owner, source, created, last activity; filters (stage, owner,
  source, date range) and search (name, email, phone).
- **Lead detail**: contact card, qualification fields, consents, attribution, timeline, stage
  change control (only allowed next stages shown), notes, owner assignment.
- **Import**: upload CSV → column mapping → dry-run preview (new / updated / duplicates / errors)
  → confirm.
- Viewers see everything read-only; sales and above can edit.

## 7. Defaults I will use unless told otherwise

| Topic           | Default                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| Countries / law | Strictest common rules: explicit opt-in for marketing (GDPR-style), timestamped evidence |
| Existing leads  | Generic CSV import with column mapping (no direct CRM sync)                              |
| "Qualified"     | Manual staff decision in Phase 2; rule-based definition arrives with scoring in Phase 5  |
| Disqualifiers   | Under 18 → `LOST` with reason `underage`; contact stops                                  |
| Lead sources    | Free-text `source` plus standard UTM fields; source list kept as configuration           |
| Form fields     | Name, email, phone (optional), country, experience level, markets, consent checkboxes    |
| Lead owner      | Unassigned by default; staff assign by hand                                              |
| Data retention  | No automatic deletion in Phase 2; erasure on request only                                |

## 8. Testing and acceptance

- Unit tests: transition table, phone/email normalisation, duplicate matching, CSV parsing,
  consent rules.
- Integration tests (real Postgres): public form endpoint (validation, honeypot, rate limit,
  duplicate update, consent and touchpoint written), every staff endpoint's role checks (401/403),
  invalid transitions rejected, timeline and audit entries written, import dry-run vs commit,
  export contents, erasure removes personal data and keeps the suppression entry.
- Acceptance: a form submission appears in the admin list within seconds with its source; a staff
  user can move it through the pipeline and see the full timeline; a CSV of existing leads imports
  without duplicates; an erased lead can no longer be found by name, email or phone.

## 9. Questions for the founder

Answer by number; anything left unanswered uses the default in §7.

1. **Countries**: which countries do prospects come from? (Sets consent wording and evidence.)
2. **Existing data**: is there a current CRM or spreadsheet to import? If so, which tool, and
   roughly how many leads?
3. **Lead sources today**: where do leads come from now (website, Instagram, WhatsApp, ads,
   webinars, referrals)? Which of these should the web form be used on first?
4. **Form fields**: confirm the default form fields in §7, or list the fields you want.
5. **"Qualified"**: what makes someone qualified for a consultation? Any automatic disqualifiers
   besides being under 18?
6. **Ownership**: should new leads be assigned to a specific salesperson automatically
   (round-robin), or stay unassigned until someone picks them up?
7. **Transitions**: approve the transition table in §4, or note changes. Should admins be able to
   override the table (with a reason)?
8. **Erasure**: is "owner only" right for deleting a lead's personal data, or should admins also be
   allowed?
9. **Consent text**: do you have approved consent wording for the form, or should I use a clearly
   marked placeholder for legal review?
