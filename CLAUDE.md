# CLAUDE.md — conventions for this repository

ProfitCosmos Omega student-acquisition system. Read `README.md` and `docs/ARCHITECTURE_PLAN.md`
first. Work phase by phase; do not build features from a later phase without approval.

## Non-negotiables

- **Compliance**: never write copy, prompts, templates or code that promises profits, income,
  returns, risk-free trading or financial success, or that gives personalised financial advice.
  See `docs/compliance.md`.
- **No production prompt text** without explicit approval. Prompts live in `config/prompts` as
  versioned files; the loader only serves `status: approved`.
- **Single tenant**: keep `organization_id` on core tables and pass it explicitly, but do not add
  multi-tenant behaviour (tenant switching, RLS, per-tenant config) until Phase 12.
- **No PII in logs**. Log ids, not emails/phones/message bodies. `src/lib/logger.ts` redacts common
  keys as a safety net, not as permission.
- **Deterministic core**: the LLM converses and extracts; rules decide score, stage, consent and
  sending.

## Code conventions

- TypeScript strict; ESM; path aliases `@/*` → `src/*`, `@config/*` → `config/*`
  (files under `src/db` use relative imports because drizzle-kit loads them).
- Validate every boundary with Zod: env (`src/lib/env.ts`), request bodies/queries
  (`parseJson` / `parseQuery`), job payloads (`defineJob`).
- API routes use `apiHandler` / `authedApiHandler(minRole, …)` from `src/lib/api.ts`; return
  `json(data)`; throw `Errors.*` for expected failures. Responses: `{ data }` or
  `{ error: { code, message, details?, requestId } }`.
- Domain logic lives in `src/modules/<module>/service.ts` and takes the `Database` as an argument.
  Modules don't read each other's tables directly.
- External services sit behind interfaces in `src/providers/*` (and `src/modules/channels`).
- Background work = a job in `src/worker/jobs`, registered in `src/worker/jobs/index.ts`.
- Write to `audit_log` (`recordAudit`) for staff actions that change data.
- IDs are UUID v7 generated in the app (`newId()`); timestamps are `timestamptz`.

## Database

- Edit `src/db/schema/*`, then `pnpm db:generate` and commit the SQL in `src/db/migrations`.
  Never edit an applied migration.
- `pnpm db:migrate` also installs the pg-boss schema.

## Before pushing

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm build
```

Tests need Postgres (`docker compose up -d`); the test DB (`TEST_DATABASE_URL`) is reset each run.
