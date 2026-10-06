# ADR 0002 — PostgreSQL for data and the job queue (pg-boss)

- Status: Accepted
- Date: 2026-10-06

## Context

AI turns, follow-up messages, reminders and calendar sync must run asynchronously with retries,
scheduling and idempotency. Adding Redis or a managed queue adds cost and another system to run.

## Decision

Use PostgreSQL 16 as the single datastore, with Drizzle ORM for typed access and SQL migrations
committed to Git. Use **pg-boss** for background jobs; its tables live in the `pgboss` schema of the
same database. `pnpm db:migrate` applies Drizzle migrations and installs the pg-boss schema.
Job payloads are validated with Zod on enqueue and on processing.

## Consequences

- One system to back up, monitor and secure; jobs can be enqueued in the same transaction as data
  changes later.
- Throughput ceiling is far above MVP needs; revisit if job volume reaches sustained thousands per
  second.
- pgvector can be enabled on the same database for knowledge-base search later.
