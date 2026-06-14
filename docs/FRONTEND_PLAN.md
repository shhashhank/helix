# Plan: Frontend web app (React)

> **Status:** planned (forward scope — after the GitHub + Secrets/KMS epic, HELIX-166).
> **Jira:** Epic [HELIX-173] → Task [HELIX-174] → sub-tasks HELIX-175…HELIX-179.

## Goal

Build the **first user-facing app** — a thin React web app in `apps/web` over the platform's existing,
already-tested APIs: sign in → submit a build request → watch the agents run it live (SSE) → see artifacts;
plus the approval inbox and the GitHub connect wizard. HELIX-11 was built **API-first by design** (complete,
tested APIs, no screens); this is the screens. See [REMAINING_WORK.md](REMAINING_WORK.md) Theme D
(DEFERRED #6 + #13 + #14's wizard).

## Tech decisions (repo-consistent)

- **React** — the framework the PRODUCT_PLAN architecture names ("Web App (React)"). Scaffolded with `@nx/react`.
- **Bundler: webpack** (already in the repo via `@nx/webpack`) — *not* Vite, to avoid adding a second build
  toolchain. **Tests: Jest** + `@testing-library/react` + jsdom — the repo's test runner everywhere.
- **Routing:** `react-router`. **Styling:** plain CSS / CSS modules, minimal — no UI-component library or
  Tailwind (keep it thin; easy to layer on later).
- **API client:** a small typed `fetch` wrapper that attaches the session bearer token (from the auth context)
  and reads the API base URL from build/runtime config (default `http://localhost:3100`). One module, reused
  by every screen.
- **Auth:** a React context holding the session token (in memory + `localStorage`), the sign-in exchange, and a
  `RequireAuth` route guard.

## Offline-CI fit

The app talks to the orchestrator at **runtime**; in CI it's only **built + unit-tested**. Component tests use
`@testing-library/react` with a **mocked `fetch`** (no live backend), so the suite is fully offline — same
discipline as the rest of the repo. CI gains three steps for `web`: typecheck, `nx build web`, jest.

## What it consumes (all built + tested already)

- **Auth:** `POST /api/auth/session` (idToken → session), `GET /api/auth/me`.
- **Requests/runs:** `POST /api/requests`, `GET /api/requests/overview`, `/:id/run`, `/:id/stream` (SSE),
  `/:id/artifacts`.
- **Approvals:** `GET /api/approvals/inbox` + decision endpoints.
- **GitHub:** `POST /api/integrations/github/connect` + `/callback`, `GET`, `POST /test`.

## Sub-tasks (Jira, in order)

| Ticket | Sub-task | Size |
|---|---|---|
| HELIX-175 | **App scaffold + shell + API client + auth context** — `@nx/react` app (webpack + Jest), router + layout/nav shell, the typed `fetch` API client, the auth context + `RequireAuth`, and CI wiring (typecheck/build/test for `web`). The foundation. | L |
| HELIX-176 | **Sign-in screen** — exchange a dev OIDC ID token for a session (`POST /api/auth/session`) and land an authenticated principal; protected routes redirect here. (Open: a small dev-only mint endpoint vs. paste-a-token — settle in the ticket.) | M |
| HELIX-177 | **Request submission + live run dashboard** — submit a request, list them (`/overview`), and a run detail view with **live per-step status over SSE** (`/:id/stream`) + artifacts. | L |
| HELIX-178 | **Approval inbox** — list pending approvals with context, approve / reject with a comment. | M |
| HELIX-179 | **GitHub connect wizard** — the connect flow (install URL → callback → status → `Test connection`). Completes DEFERRED #14. | M |

## Open decisions (settle per sub-task)

- **Dev sign-in (HELIX-176):** the browser can't mint an ID token (that needs the dev secret). Likely add a
  small **dev-only** `/api/auth/dev-login` on the orchestrator (mint + exchange for an email/org/roles, guarded
  to non-production) — a minor backend add inside that ticket. A real OIDC redirect stays deferred (no live IdP).
- **API base URL:** build-time env (`API_BASE_URL`, default `:3100`) vs. a served runtime config — start with
  build-time + a sensible default.
- **Styling/UX polish:** minimal + functional first; a component library / theming is a later pass.

## Out of scope

- A real OIDC provider redirect (DEFERRED #12) and live GitHub/AWS (separate bindings). Billing screens.
- Server-side rendering — this is a client SPA over the REST/SSE APIs.
