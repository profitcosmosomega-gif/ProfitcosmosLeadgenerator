# ADR 0001 — Modular monolith

- Status: Accepted
- Date: 2026-10-06

## Context

The MVP must validate quickly whether AI-assisted qualification produces more booked consultations.
Lead volume is modest, the team is small, and requirements will change after first contact with
real prospects. The system must still be able to grow into a multi-tenant SaaS later.

## Decision

Build one TypeScript codebase (Next.js for the web process, a Node worker process) with one
PostgreSQL database. Organise code into domain modules (`src/modules/*`) that talk through service
functions, and put every external service behind an interface (`src/providers/*`,
`src/modules/channels`). Keep `organization_id` on core tables but run single-tenant.

## Consequences

- One deployable image, one database, simple local development and debugging.
- Module boundaries are enforced by convention and review, not by process isolation.
- Modules can be split out later if a real scaling need appears.
- Multi-tenancy can be added without re-keying data.
