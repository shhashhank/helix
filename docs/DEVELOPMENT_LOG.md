# Helix — what we've built so far

A plain-English record of what exists in this project today. It's meant to be readable by
anyone, not just engineers. It's updated as each Jira sub-task is completed (see
[How this file stays current](#how-this-file-stays-current) at the bottom).

> **What is Helix?** A platform where you describe a software task in plain English and a
> team of AI "agents" plan it, write the code, test it, review it, and ship it — with
> humans approving the risky steps. That's the big goal. Most of it isn't built yet; this
> file tracks the parts that are.

**Status legend:** ✅ done · 🛠️ in progress · ⬜ not started

---

## The big picture right now

We've built the **foundation for defining and storing AI agents**. An "agent" here is
just a recipe — a configuration that says what role it plays (planner, coder, tester…),
what instructions it uses, which AI model, what tools it may use, and its safety limits.
Today you can **define, validate, store, version, and serve these recipes** over a web
API. Nothing *runs* the agents yet — that's the next phase.

A handy way to picture the finished foundation:
- **The rulebook** (what a valid recipe looks like) — HELIX-50
- **The filing cabinet** (stores recipes, keeps version history) — HELIX-51
- **The front desk** (web API to use the filing cabinet) — HELIX-53
- **The blank-filler** (slots real values into an agent's instructions) — HELIX-52

---

## Epic: Core Agent Platform  🛠️ in progress

### Story: Agent Definition & Registry  ✅ done
Everything needed to define and manage agent recipes. All four sub-tasks below are
finished, so this story is complete.

#### HELIX-50 — Agent definition schema  ✅
- **What it is:** the rulebook for what an agent recipe must contain (name, role,
  instructions, model, tools, safety limits).
- **Why it matters:** the computer can automatically check "is this a valid recipe?"
  before storing anything, so bad data is caught early.
- **Where it lives:** [../schemas/agent-definition/v1/](../schemas/agent-definition/v1/)
  (the rules, plus filled-in example recipes for a planning agent and a coding agent).

#### HELIX-51 — Registry service + persistence  ✅
- **What it is:** the filing cabinet — the core logic that stores recipes in a database.
- **Why it matters:** recipes are saved with **version history** (editing keeps the old
  version, like Google Docs history), **soft delete** (deleting hides rather than
  destroys), and a **one-recipe-per-role rule** per customer.
- **Where it lives:** [../apps/registry/src/agent-definition/](../apps/registry/src/agent-definition/)
  (logic) and [../apps/registry/prisma/schema.prisma](../apps/registry/prisma/schema.prisma)
  (the database table shape). The database is handled by Prisma (our code-to-database
  translator).

#### HELIX-53 — Registry API endpoints  ✅
- **What it is:** the front desk — web addresses so other software can use the filing
  cabinet.
- **Why it matters:** you can now create, list, fetch, version, and delete recipes over
  HTTP. Bad data gets a clear **400** error, duplicates get **409**, and there's
  auto-generated interactive documentation (a Swagger page). Each customer sees only their
  own recipes via an `x-org-id` header.
- **Where it lives:**
  [../apps/registry/src/agent-definition/agent-definition.controller.ts](../apps/registry/src/agent-definition/agent-definition.controller.ts)
  (the endpoints), the doc DTOs in
  [dto/](../apps/registry/src/agent-definition/dto/), and the
  [org-id.decorator.ts](../apps/registry/src/agent-definition/org-id.decorator.ts)
  (reads the customer header). Docs served at `/api/docs` when the app runs.

#### HELIX-52 — Prompt template engine  ✅
- **What it is:** the blank-filler. Agent instructions can contain placeholders like
  *"Plan the work for `{{repo_name}}`."* — this fills them in with real values.
- **Why it matters:** it checks required values are present and the right type, supports
  reusable snippets and defaults, so an agent's instructions are assembled safely at run
  time. It's an internal helper (no web page) because the part that *runs* agents isn't
  built yet.
- **Where it lives:** [../apps/registry/src/prompt-template/](../apps/registry/src/prompt-template/).

### Story: LLM Gateway & Model Router (Anthropic)  🛠️ in progress
The piece that actually calls the AI models. First brick below.

#### HELIX-54 — Provider adapter (Anthropic)  ✅
- **What it is:** a single, tidy "plug" for talking to an AI model. The rest of Helix asks
  it for a response in one common shape; the plug translates that to Anthropic's API and
  back. Swapping in another AI vendor later means writing another plug, not changing
  everything else.
- **Why it matters:** it's the foundation for everything that *runs* agents. It handles
  ordinary requests and live "streaming" replies (text arriving word-by-word), lets the
  model use tools, and records how many tokens each call used (for cost tracking later).
- **Where it lives:** [../libs/llm/](../libs/llm/) — the common interface in
  [types.ts](../libs/llm/src/lib/types.ts) and the Anthropic plug in
  [anthropic.provider.ts](../libs/llm/src/lib/anthropic.provider.ts).

### Story: Agent Execution Runtime, Memory, Tracing  ⬜ not started

---

## Fixes & hardening

Not Jira sub-tasks, but part of keeping the foundation solid:

- **Production build fix** (PR #5) — the app couldn't be packaged for production (a config
  mistake made the build try to compile the test files). Fixed, and the CI checks were
  upgraded to **typecheck + build + test** so this can't silently break again.
- **Duplicate API-doc header fix** (PR #6) — the Swagger docs listed the `x-org-id` header
  twice on some endpoints. Fixed so each shows it once (and endpoints that ignore it don't
  list it).

---

## Summary

| Ticket | What it is (plain words) | Status | PR |
|--------|--------------------------|--------|----|
| HELIX-50 | Rulebook for agent recipes (schema) | ✅ | initial |
| HELIX-51 | Filing cabinet + database (storage) | ✅ | #1 |
| HELIX-53 | Front desk (web API) | ✅ | #3 |
| HELIX-52 | Blank-filler (prompt templates) | ✅ | #4 |
| HELIX-54 | AI-model plug (Anthropic adapter) | ✅ | #8 |
| — | Production build fix + CI hardening | ✅ | #5 |
| — | Duplicate `x-org-id` Swagger fix | ✅ | #6 |

---

## What's next

The "Agent Definition & Registry" story is done, and the **LLM Gateway** story is underway —
the Anthropic model plug (HELIX-54) is in. Next in that story: **HELIX-55 — routing policy**
(pick the right model tier per task within cost limits), then **HELIX-56 — retries/fallback**
and **HELIX-57 — token & cost meter**. After that come the agent loop, the workflow engine,
GitHub access, sandboxes, human approvals, and the user-facing website.

---

## How this file stays current

- **Written by Claude, per sub-task.** When a sub-task is completed, the `helix-pr`
  workflow adds/refreshes that sub-task's entry here in plain words, so the update ships
  inside the same pull request as the work.
- **Guarded by a hook.** A `SessionStart` hook
  ([../.claude/hooks/check-devlog-drift.sh](../.claude/hooks/check-devlog-drift.sh))
  automatically checks whether any HELIX ticket merged into `main` is missing from this
  file. If so, it leaves a gentle reminder so the doc never silently falls behind. The
  hook only *detects and reminds* — the words here are always written by Claude.
