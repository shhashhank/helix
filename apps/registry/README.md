# @helix/registry

Agent registry service — Postgres-backed CRUD + version history + soft delete for agent definitions.

Persistence layer only. HTTP controllers + REST API land with **HELIX-53**.

## What's in here (HELIX-51 scope)

- `prisma/schema.prisma` — `agent_definitions` table with `UNIQUE (org_id, role, version)`, `deleted_at` for soft delete, JSONB columns for `system_prompt`, `model_policy`, `tools`, `guardrails`, `output_schema`, `metadata`.
- `src/validators/agent-definition.validator.ts` — AJV-backed validator that compiles the canonical JSON Schema from `schemas/agent-definition/v1/` at module init. Every write goes through it.
- `src/agent-definition/agent-definition.repository.ts` — thin Prisma wrapper; one method per service operation.
- `src/agent-definition/agent-definition.service.ts` — business logic. `create` rejects if `(orgId, role)` already exists; `update` always inserts a new version (older rows are preserved); `softDelete` flips `deleted_at`; `findLatest` returns the highest-version non-deleted row.
- `src/prisma/prisma.module.ts` + `prisma.service.ts` — `@Global()` Prisma module injected wherever needed.
- `src/__tests__/` — 9 unit tests (mocked repo) + 6 integration tests against a testcontainers Postgres.

## Schema dependency

The validator imports `../../../../schemas/agent-definition/v1/agent-definition.schema.json` directly. **If you move or rename the schema files, this import breaks.** Bumped via `resolveJsonModule` + an explicit `include` in `tsconfig.app.json` / `tsconfig.spec.json` so both build and Jest resolve it.

## Run locally

```bash
# From the repo root
docker compose up -d postgres                    # Postgres 16 on host port 5433
cp .env.example .env                             # already wired to localhost:5433
pnpm install
pnpm exec prisma migrate dev \
  --schema apps/registry/prisma/schema.prisma    # apply migrations
pnpm exec jest --config apps/registry/jest.config.ts   # all 15 tests
```

The integration suite spins up its **own** Postgres via testcontainers — you don't need `docker compose up` for tests to pass, but you do need a running Docker daemon.

## Behavior summary

| Operation | What happens |
|---|---|
| `create(orgId, payload)` | validate → if `(orgId, role)` exists → 409; else insert with `version=1`. |
| `update(id, payload)` | validate → fetch current row (including soft-deleted) → if `role` differs → 409; else insert new row with `version = max(version) + 1`. Old rows stay. |
| `findById(id, includeDeleted=false)` | by primary key; 404 if missing or soft-deleted (unless `includeDeleted`). |
| `findLatest(orgId, role)` | highest-version non-deleted row for `(orgId, role)`. |
| `findAll(orgId, opts)` | paginated; latest-version-per-role by default; `includeAllVersions` returns full history. |
| `softDelete(id)` | sets `deleted_at = now()` on the specific row. Does **not** cascade to older versions — you can resurrect a specific version by un-deleting. |

## Out of scope

- HTTP controllers / REST endpoints → **HELIX-53**.
- `org_id` enforcement / auth context binding → comes via the auth middleware in **HELIX-142**.
- Prompt template interpolation → **HELIX-52**.
- The agent runtime that loads definitions for execution → **HELIX-58** (Story HELIX-14).
