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
| 2     | Lead database and CRM                                       | Planned |
| 3     | AI qualification agent                                      | Planned |
| 4     | Knowledge base                                              | Planned |
| 5     | Lead scoring                                                | Planned |
| 6     | Calendar and appointment booking                            | Planned |
| 7     | Human sales handoff                                         | Planned |
| 8     | Follow-up automation                                        | Planned |
| 9     | Analytics dashboard                                         | Planned |
| 10–12 | Additional channels, campaign automation, multi-tenant SaaS | Planned |

### Phase 1 boundary

Phase 1 is the foundation only. The following are **intentionally not implemented yet**:

| Not implemented                                        | Planned phase | What exists today                                           |
| ------------------------------------------------------ | ------------- | ----------------------------------------------------------- |
| Lead capture (forms, chat widget, lead/CRM tables)     | 2             | Nothing — no lead data is collected or stored               |
| AI conversations / qualification agent                 | 3             | `LlmProvider` interface (types only); `AI_ENABLED=false`    |
| Production prompt content                              | 3+            | Versioned stubs with TODO placeholders; loader refuses them |
| Knowledge base                                         | 4             | Nothing                                                     |
| Lead scoring                                           | 5             | Ruleset types and band thresholds only, no rules or engine  |
| Calendar / appointment booking workflow                | 6             | `CalendarProvider` interface (types only)                   |
| Human sales handoff                                    | 7             | Nothing                                                     |
| Follow-up automation, outbound messaging               | 8             | `ChannelAdapter` interface; email sender used by no feature |
| Analytics, additional channels, multi-tenant behaviour | 9–12          | `organization_id` columns only; runs single-tenant          |

What Phase 1 does provide: staff sign-in and roles, an audit log, a health check, the background
worker, database migrations and seed, provider interfaces, tests, CI and Docker images.

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

| Variable                           | Required | Default                     | Purpose                                 |
| ---------------------------------- | -------- | --------------------------- | --------------------------------------- |
| `DATABASE_URL`                     | yes      | —                           | Postgres connection string              |
| `BETTER_AUTH_SECRET`               | yes      | —                           | Session signing secret (≥ 32 chars)     |
| `APP_URL`                          | no       | `http://localhost:3000`     | Public base URL (auth, trusted origin)  |
| `LOG_LEVEL`                        | no       | `info`                      | pino log level                          |
| `DEFAULT_ORGANIZATION_SLUG`        | no       | `profitcosmos-omega`        | The single tenant                       |
| `EMAIL_PROVIDER`                   | no       | `console`                   | `console` (log only) or `smtp`          |
| `EMAIL_FROM`, `SMTP_*`             | no       | Mailpit on `localhost:1025` | Outbound email                          |
| `AI_ENABLED`                       | no       | `false`                     | AI kill-switch (unused in Phase 1)      |
| `ANTHROPIC_API_KEY`, `LLM_MODEL_*` | no       | —                           | Reserved for Phase 3                    |
| `SEED_OWNER_EMAIL` / `_PASSWORD`   | seed     | —                           | Owner account created by `pnpm db:seed` |
| `TEST_DATABASE_URL`                | tests    | `…/profitcosmos_test`       | Database the test suite **resets**      |

## Project structure

```
src/
  app/                 Next.js routes
    (auth)/login       staff sign-in page
    (admin)/admin      protected admin shell
    api/auth/[...all]  Better Auth endpoints
    api/health         health check (database + queue)
    api/v1/            versioned REST API (me, admin/audit-log)
  db/                  Drizzle client, schema, migrations, migrate + seed logic
  lib/                 env, logger, errors, api handler, auth, session, rbac, queue, prompts
  modules/             domain modules (audit, organizations, health, channels contract)
  providers/           external-service contracts and adapters (llm, calendar, email)
  worker/              pg-boss worker, job registry, jobs
config/
  pipeline.ts          CRM stage names (transitions: Phase 2)
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
  email provider, prompt registry guards.
- **Integration tests** (`tests/integration`): real Postgres. The test database named by
  `TEST_DATABASE_URL` is **dropped and re-migrated** at the start of each run (the setup refuses any
  database whose name does not contain `test`). Covers health, seed, auth (401/403), audit log and
  the worker runtime.
- **AI evaluations** (`tests/evals`): arrive with the AI agent in Phase 3.

## Domain concepts

- **Funnel stages**: `NEW_LEAD → ENGAGED → QUALIFYING → QUALIFIED → CONSULTATION_BOOKED →
CONSULTATION_COMPLETED → ENROLLMENT_PENDING → ENROLLED`, plus `NURTURE` and `LOST`
  ([config/pipeline.ts](config/pipeline.ts)).
- **Lead scoring**: explainable 0–100 score from deterministic, versioned rules; the AI extracts
  signals, it never decides the score. Bands: 0–39 Nurture, 40–69 Interested, 70–100 High intent.
- **Human handoff**: high-intent or out-of-scope conversations go to a person with a concise brief.
- **Knowledge base**: the AI answers only from approved content and escalates when it doesn't know.

## Staff authentication and roles

Only **staff** sign in. Prospects and students never have accounts in this system.

- **Method**: email + password via [Better Auth](https://www.better-auth.com/) (minimum 12
  characters, hashed with scrypt). Sessions are stored in Postgres and carried in an HTTP-only
  cookie (`Secure` in production); they last 7 days and are refreshed daily.
- **No self-signup**: public sign-up is disabled (`disableSignUp`); the sign-up endpoint rejects
  every request.
- **Provisioning**: staff accounts are created deliberately, never by the person themselves. In
  Phase 1 the only path is `pnpm db:seed`, which creates the organization and its **owner**
  account from `SEED_OWNER_*` variables. An admin screen for inviting staff comes in a later phase.
- **Roles are hierarchical**: `viewer` < `sales` < `admin` < `owner`. A higher role can do
  everything a lower role can. New users default to `viewer`.

| Role     | Intended use                                  | Phase 1 access                  |
| -------- | --------------------------------------------- | ------------------------------- |
| `viewer` | Read-only access to dashboards                | Admin shell, `GET /api/v1/me`   |
| `sales`  | Work leads, handoffs and appointments (later) | Same as viewer                  |
| `admin`  | Manage configuration, knowledge base, staff   | + `GET /api/v1/admin/audit-log` |
| `owner`  | Business owner; everything an admin can do    | Same as admin                   |

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
