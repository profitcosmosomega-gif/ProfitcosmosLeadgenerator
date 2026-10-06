# ProfitCosmos Omega — AI Student Acquisition System

Marketing, qualification, CRM, booking and follow-up platform for **ProfitCosmos Omega Academy**, a
trading and financial-market education business. Its job is to turn prospective students into
booked consultations and, eventually, enrolled students while reducing manual work for the team.

> **Education, not financial advice.** This system markets trading _education_. It is not a trading
> bot, never gives personalised financial advice, and never promises profits, income, returns,
> risk-free trading or financial success. See [docs/compliance.md](docs/compliance.md).

## Status and roadmap

| Phase | Scope                                                       | Status  |
| ----- | ----------------------------------------------------------- | ------- |
| 1     | Architecture and repository foundation                      | ✅ Done |
| 2     | Lead database and CRM                                       | ✅ Done |
| 3     | AI qualification agent                                      | Planned |
| 4     | Knowledge base                                              | Planned |
| 5     | Lead scoring                                                | Planned |
| 6     | Calendar and appointment booking                            | Planned |
| 7     | Human sales handoff                                         | Planned |
| 8     | Follow-up automation                                        | Planned |
| 9     | Analytics dashboard                                         | Planned |
| 10–12 | Additional channels, campaign automation, multi-tenant SaaS | Planned |

### Current boundary (Phases 1–2 implemented)

**Implemented**: staff sign-in and roles, audit log, health check, background worker, migrations
and seed, provider interfaces, **the lead database and CRM** (see
[Lead database and CRM](#lead-database-and-crm-phase-2)), tests, CI and Docker images.

The following are **intentionally not implemented yet**:

| Not implemented                                     | Planned phase | What exists today                                             |
| --------------------------------------------------- | ------------- | ------------------------------------------------------------- |
| AI conversations / qualification agent, chat widget | 3             | `LlmProvider` interface (types only); `AI_ENABLED=false`      |
| Production prompt content                           | 3+            | Versioned stubs with TODO placeholders; loader refuses them   |
| Knowledge base                                      | 4             | Nothing                                                       |
| Lead scoring                                        | 5             | Ruleset types and band thresholds only; "qualified" is manual |
| Calendar / appointment booking workflow             | 6             | `CalendarProvider` interface (types only)                     |
| Human sales handoff                                 | 7             | Nothing                                                       |
| Follow-up automation, outbound messaging            | 8             | `ChannelAdapter` interface; nothing is ever sent to leads     |
| Analytics dashboard, ad-spend import                | 9             | Attribution data is captured; no reports                      |
| Additional channels (WhatsApp, Instagram, …)        | 10            | `channel_identities` table and link/resolve service only      |
| Multi-tenant behaviour (tenant UI, RLS)             | 12            | `organization_id` on every table; runs single-tenant          |

## Architecture overview

A **modular monolith**: one TypeScript codebase, one PostgreSQL database, two processes.

```
 Browser ──▶ web (Next.js: admin UI, REST API, auth, webhooks) ──┐
                                                                  ├──▶ PostgreSQL (data + job queue)
            worker (pg-boss jobs: AI turns, follow-ups, …) ──────┘
```

- Full plan: [docs/ARCHITECTURE_PLAN.md](docs/ARCHITECTURE_PLAN.md)
- Decisions: [docs/adr/](docs/adr/)

**Single tenant for now.** Core tables carry `organization_id` for future multi-tenancy, but the
system operates on one seeded organization (`DEFAULT_ORGANIZATION_SLUG`).

## Tech stack

| Concern    | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Language   | TypeScript (strict), Node.js 22                               |
| Web        | Next.js (App Router), Tailwind CSS                            |
| Database   | PostgreSQL 16, Drizzle ORM + drizzle-kit migrations           |
| Validation | Zod (env, API input, job payloads)                            |
| Jobs       | pg-boss (queue stored in Postgres — no Redis)                 |
| Auth       | Better Auth (email + password, staff only), role-based access |
| Logging    | pino (JSON, request ids, PII redaction)                       |
| Tests      | Vitest against a real Postgres                                |
| CI         | GitHub Actions                                                |

## Getting started

Prerequisites: Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env              # then set BETTER_AUTH_SECRET, SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD
docker compose up -d              # Postgres on :5432, Mailpit on :1025 / http://localhost:8025
pnpm install
pnpm db:migrate                   # Drizzle migrations + job-queue schema
pnpm db:seed                      # organization + owner account (idempotent)
pnpm dev                          # http://localhost:3000 → sign in with the seed owner
pnpm worker:dev                   # background worker (separate terminal)
```

Generate a secret with `openssl rand -base64 32`.

To run everything in containers: `docker compose --profile app up -d --build`.

## Environment variables

All variables are validated at startup by [`src/lib/env.ts`](src/lib/env.ts); the process fails
fast with a list of invalid variables. See [`.env.example`](.env.example) for the full list.

**Secrets**: `.env` is gitignored and must never be committed. `.env.example` contains placeholders
only: secrets (`BETTER_AUTH_SECRET`, `SEED_OWNER_PASSWORD`, `SMTP_PASSWORD`, `ANTHROPIC_API_KEY`)
are left empty, and the `postgres:postgres` database credentials match the local Docker Compose
database only. In production, supply values through the host's secret manager.

| Variable                            | Required | Default                     | Purpose                                 |
| ----------------------------------- | -------- | --------------------------- | --------------------------------------- |
| `DATABASE_URL`                      | yes      | —                           | Postgres connection string              |
| `BETTER_AUTH_SECRET`                | yes      | —                           | Session signing secret (≥ 32 chars)     |
| `APP_URL`                           | no       | `http://localhost:3000`     | Public base URL (auth, trusted origin)  |
| `LOG_LEVEL`                         | no       | `info`                      | pino log level                          |
| `DEFAULT_ORGANIZATION_SLUG`         | no       | `profitcosmos-omega`        | The single tenant                       |
| `PUBLIC_FORM_ORIGINS`               | no       | — (only `APP_URL`)          | Extra origins allowed to post the form  |
| `PUBLIC_FORM_RATE_LIMIT_PER_MINUTE` | no       | `10`                        | Public form submissions per IP / minute |
| `EMAIL_PROVIDER`                    | no       | `console`                   | `console` (log only) or `smtp`          |
| `EMAIL_FROM`, `SMTP_*`              | no       | Mailpit on `localhost:1025` | Outbound email                          |
| `AI_ENABLED`                        | no       | `false`                     | AI kill-switch (unused in Phase 1)      |
| `ANTHROPIC_API_KEY`, `LLM_MODEL_*`  | no       | —                           | Reserved for Phase 3                    |
| `SEED_OWNER_EMAIL` / `_PASSWORD`    | seed     | —                           | Owner account created by `pnpm db:seed` |
| `TEST_DATABASE_URL`                 | tests    | `…/profitcosmos_test`       | Database the test suite **resets**      |

## Project structure

```
src/
  app/                 Next.js routes
    (auth)/login       staff sign-in page
    (admin)/admin      protected admin: leads list, lead detail, CSV import
    api/auth/[...all]  Better Auth endpoints
    api/health         health check (database + queue)
    api/public/leads   public lead-capture endpoint for website forms
    api/v1/            versioned staff REST API (me, leads, imports, admin/audit-log)
  db/                  Drizzle client, schema, migrations, migrate + seed logic
  lib/                 env, logger, errors, api handler, auth, session, rbac, queue, prompts
  modules/             domain modules: leads, crm (stage transitions), consents, attribution,
                       imports, channels (contract + identities), audit, organizations, staff, health
  providers/           external-service contracts and adapters (llm, calendar, email)
  worker/              pg-boss worker, job registry, jobs
config/
  pipeline.ts          CRM stages and allowed transitions
  consent.ts           consent wording shown on forms (PLACEHOLDER, pending legal review)
  scoring/             scoring ruleset shapes and bands (rules: Phase 5)
  prompts/             versioned prompt stubs + registry (no production text)
scripts/               migrate / seed entrypoints
tests/                 unit and integration tests
docs/                  architecture plan, ADRs, compliance
```

## Scripts

| Command                | Does                                                   |
| ---------------------- | ------------------------------------------------------ |
| `pnpm dev`             | Next.js dev server                                     |
| `pnpm build` / `start` | Production build / server                              |
| `pnpm worker`          | Run the background worker (`worker:dev` watches files) |
| `pnpm lint`            | ESLint                                                 |
| `pnpm typecheck`       | `tsc --noEmit`                                         |
| `pnpm format`          | Prettier (`format:check` in CI)                        |
| `pnpm test`            | Vitest (unit + integration; needs Postgres)            |
| `pnpm db:generate`     | Generate a migration from schema changes               |
| `pnpm db:migrate`      | Apply migrations and install the queue schema          |
| `pnpm db:seed`         | Seed the organization and owner (idempotent)           |
| `pnpm db:check`        | Validate migration consistency                         |
| `pnpm check`           | lint + typecheck + format check + tests                |

## Testing strategy

- **Unit tests** (`tests/unit`): pure logic — env validation, error mapping, RBAC, API handler,
  email provider, prompt registry guards, phone/email normalisation, CSV parsing, pipeline table,
  rate limiter, log redaction.
- **Integration tests** (`tests/integration`): real Postgres. The test database named by
  `TEST_DATABASE_URL` is **dropped and re-migrated** at the start of each run (the setup refuses any
  database whose name does not contain `test`). Covers health, seed, auth (401/403), audit log, the
  worker runtime and the CRM: role permissions per route, cross-organization isolation, stage
  transitions, append-only history, public capture, CSV import, merge, export and erasure.
- **AI evaluations** (`tests/evals`): arrive with the AI agent in Phase 3.

## Domain concepts

- **Funnel stages**: `NEW_LEAD → ENGAGED → QUALIFYING → QUALIFIED → CONSULTATION_BOOKED →
CONSULTATION_COMPLETED → ENROLLMENT_PENDING → ENROLLED`, plus `NURTURE` and `LOST`
  ([config/pipeline.ts](config/pipeline.ts)). See [Lead database and CRM](#lead-database-and-crm-phase-2).
- **Lead scoring**: explainable 0–100 score from deterministic, versioned rules; the AI extracts
  signals, it never decides the score. Bands: 0–39 Nurture, 40–69 Interested, 70–100 High intent.
- **Human handoff**: high-intent or out-of-scope conversations go to a person with a concise brief.
- **Knowledge base**: the AI answers only from approved content and escalates when it doesn't know.

## Lead database and CRM (Phase 2)

**Leads** hold contact details (email lower-cased, phone in E.164 international format),
qualification answers, pipeline stage, owner and attribution. One active lead per email and per
phone number per organization. New leads start at `NEW_LEAD` and are **unassigned** until staff
assign an owner. "Qualified" is a manual staff decision until scoring arrives in Phase 5.

**Pipeline**: the only way to change a stage is the transition service
(`src/modules/crm/service.ts`, `POST /api/v1/leads/:id/transition`). It checks the move against the
table in [`config/pipeline.ts`](config/pipeline.ts), requires a reason for `LOST` and `NURTURE`, and
writes the stage, a `stage_transitions` row, a timeline event and an audit entry in one
transaction. There is no override; invalid moves return `409 INVALID_STATE_TRANSITION`.

**History**: every change is recorded on the lead's timeline (`lead_events`) and in `audit_log`.
Both store ids and changed field names only, never names, emails, phone numbers or note text.
`lead_events` and `stage_transitions` are append-only (database triggers block updates and
deletes).

**Lead sources**

- **Website / landing-page form** → `POST /api/public/leads` (no login). Requires `email`,
  `ageConfirmed18plus: true` and `consent.wordingVersion` matching [`config/consent.ts`](config/consent.ts);
  optional name, phone, country, experience, markets, marketing consents (email / SMS / WhatsApp)
  and `attribution` (UTM fields, landing page, referrer, click ids). Protected by an origin
  allow-list (`APP_URL` + `PUBLIC_FORM_ORIGINS`, with CORS), a per-IP rate limit, a hidden
  `website` honeypot field and strict validation. It always answers `202`, so it never reveals
  whether an email is already known. Submitting again updates the existing lead: empty fields are
  filled, staff edits are never overwritten, and a new touchpoint is added.
- **CSV import** (admin) → `/admin/leads/import` or `POST /api/v1/imports`. Preview (dry run)
  first; the preview runs the real import inside a rolled-back transaction, so it matches exactly.
- **By hand** (sales and above).

**Consent**: recorded per channel (email, SMS, WhatsApp, phone) and purpose (transactional,
marketing) with evidence (method, wording version, who recorded it). The latest record is the
current state. ⚠️ The consent wording in `config/consent.ts` is a **placeholder marked for legal
review**; it is stored with `approved: false` on every consent record until replaced.

**Data-subject requests**: admins can export everything stored about a lead as JSON. The owner can
erase a lead's personal data: contact details, free-text answers, notes, consents and channel
identities are removed, and the email/phone hashes are added to the do-not-contact list so the
person is never re-imported or re-captured. Anonymous stage history is kept.

**Duplicates**: admins can merge a duplicate into another lead; missing details and answers are
copied, notes/consents/touchpoints move over, and both histories stay visible on the target.

| Endpoint                            | Min. role | Purpose                            |
| ----------------------------------- | --------- | ---------------------------------- |
| `POST /api/public/leads`            | public    | Website form capture               |
| `GET /api/v1/leads`                 | viewer    | List / filter / search             |
| `POST /api/v1/leads`                | sales     | Create                             |
| `GET /api/v1/leads/:id`             | viewer    | Detail                             |
| `PATCH /api/v1/leads/:id`           | sales     | Edit contact, owner, qualification |
| `GET /api/v1/leads/:id/timeline`    | viewer    | Timeline                           |
| `POST /api/v1/leads/:id/transition` | sales     | Change stage                       |
| `POST /api/v1/leads/:id/notes`      | sales     | Add note                           |
| `POST /api/v1/leads/:id/consents`   | sales     | Record consent given / withdrawn   |
| `POST /api/v1/leads/merge`          | admin     | Merge duplicates                   |
| `POST /api/v1/imports`              | admin     | CSV import (dry run by default)    |
| `GET /api/v1/leads/:id/export`      | admin     | Export a lead's data               |
| `DELETE /api/v1/leads/:id`          | owner     | Erase a lead's personal data       |

Every staff route is scoped to the signed-in user's organization; a lead in another organization
is reported as `404`.

## Staff authentication and roles

Only **staff** sign in. Prospects and students never have accounts in this system.

- **Method**: email + password via [Better Auth](https://www.better-auth.com/) (minimum 12
  characters, hashed with scrypt). Sessions are stored in Postgres and carried in an HTTP-only
  cookie (`Secure` in production); they last 7 days and are refreshed daily.
- **No self-signup**: public sign-up is disabled (`disableSignUp`); the sign-up endpoint rejects
  every request.
- **Provisioning**: staff accounts are created deliberately, never by the person themselves. In
  Phases 1–2 the only path is `pnpm db:seed`, which creates the organization and its **owner**
  account from `SEED_OWNER_*` variables. An admin screen for inviting staff comes in a later phase.
- **Roles are hierarchical**: `viewer` < `sales` < `admin` < `owner`. A higher role can do
  everything a lower role can. New users default to `viewer`.

| Role     | Intended use                               | Access today                                                    |
| -------- | ------------------------------------------ | --------------------------------------------------------------- |
| `viewer` | Read-only access                           | View leads, lead detail and timelines                           |
| `sales`  | Work leads (handoffs, appointments later)  | + create/edit leads, change stage, add notes, record consent    |
| `admin`  | Manage data, configuration and staff       | + CSV import, merge duplicates, export a lead's data, audit log |
| `owner`  | Business owner; everything an admin can do | + erase a lead's personal data                                  |

- **Enforcement**: API routes declare a minimum role with `authedApiHandler(minRole, …)`
  (`src/lib/api.ts`). No session → `401 UNAUTHENTICATED`; insufficient role →
  `403 FORBIDDEN`. Admin pages redirect to `/login` without a session.
- **Audit**: every sign-in is written to `audit_log`.
- **Brute-force protection**: Better Auth's rate limiter is on in production. It keeps counts in
  memory, so it applies per server instance.

## Compliance and data protection

See [docs/compliance.md](docs/compliance.md): prohibited claims, education-vs-advice boundary,
consent, unsubscribe, auditability, data minimisation and deletion.

## Deployment

Two Docker targets from one [Dockerfile](Dockerfile):

- `web` — Next.js standalone server (`node server.js`, port 3000, health check `/api/health`).
- `worker` — background jobs; also runs migrations: `node --import tsx scripts/migrate.ts`.

Run migrations before starting a new release. Any host that runs containers next to managed
Postgres works (Railway, Render, Fly.io, …).

## Contributing workflow

- Branch from `main`, open a pull request; CI must pass (lint, typecheck, format, migration
  check, tests, build, Docker images).
- Schema changes: edit `src/db/schema`, run `pnpm db:generate`, commit the generated SQL.
- Prompt changes: new version file under `config/prompts`, never edit an approved version.
- Conventions for contributors and AI assistants: [CLAUDE.md](CLAUDE.md).

## License

Proprietary — © ProfitCosmos Omega Academy. All rights reserved.
