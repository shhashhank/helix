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

### Story: LLM Gateway & Model Router (Anthropic)  ✅ done
The piece that actually calls the AI models — adapter, routing, resilience, and metering.

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

#### HELIX-55 — Routing policy engine  ✅
- **What it is:** the "dispatcher" that decides *which* AI model to use for a given kind of
  job, and how hard it's allowed to think — and sets a dollar limit per call. Planning and
  coding get the most capable (and pricey) model; quick jobs like classification get the
  cheap, fast one.
- **Why it matters:** it keeps quality high where it counts and cost low where it doesn't,
  automatically, instead of every caller hard-coding a model. It also knows each model's
  price, so it can estimate what a call cost and refuse calls that blow past a budget.
- **Where it lives:** [../libs/llm/src/lib/routing.ts](../libs/llm/src/lib/routing.ts)
  (the job→model rules) and [../libs/llm/src/lib/pricing.ts](../libs/llm/src/lib/pricing.ts)
  (prices + budget checks).

#### HELIX-56 — Retry / fallback / timeout middleware  ✅
- **What it is:** a safety wrapper around the AI-model calls. If a call fails for a
  temporary reason (the service is busy or briefly down), it waits a moment and tries
  again; if one model provider keeps failing, it switches to a backup; and it gives up on
  a call that hangs too long. It also stops hammering a provider that's clearly broken for
  a little while ("circuit breaker").
- **Why it matters:** AI APIs occasionally hiccup. This makes the platform shrug those off
  automatically instead of failing the user's request — without retrying genuine mistakes
  (like a malformed request), which would just fail again.
- **Where it lives:** [../libs/llm/src/lib/resilience.ts](../libs/llm/src/lib/resilience.ts).

#### HELIX-57 — Token & cost meter  ✅
- **What it is:** a meter that records every AI call — how many tokens it used, the
  estimated dollar cost, how long it took, and who it was for (which run/org/agent) — and
  saves it to a database table.
- **Why it matters:** it's the raw data for billing and for spotting runaway costs. It
  wraps the model calls invisibly, so usage is captured automatically without each caller
  having to remember. Failed calls aren't charged, and a database hiccup never breaks the
  actual AI call.
- **Where it lives:** the meter in
  [../libs/llm/src/lib/metering.ts](../libs/llm/src/lib/metering.ts); the database table
  ([token_usage](../apps/registry/prisma/schema.prisma)) and the saver in
  [../apps/registry/src/token-usage/](../apps/registry/src/token-usage/).

### Story: Agent Execution Runtime (Agent Loop)  ✅ done
The part that makes an agent actually *work*: think, use a tool, look at the result, repeat —
with safety limits, output checking, and a live event stream.

#### HELIX-58 — Core agent loop  ✅
- **What it is:** the "engine" of an agent. You give it a goal and a set of tools; it asks
  the AI what to do, runs any tool the AI asks for, hands the result back, and keeps going
  until the AI says it's finished (or it hits a safety cap on the number of rounds).
- **Why it matters:** it's the first piece where everything so far comes together — it uses
  the model gateway (the previous story) to do the thinking, and turns a one-shot AI answer
  into a multi-step worker that can look things up and act. If a tool is missing or breaks,
  it tells the AI "that failed" and carries on instead of crashing.
- **Where it lives:** [../libs/agent/](../libs/agent/) — `runAgent()` in
  [agent-loop.ts](../libs/agent/src/lib/agent-loop.ts).

#### HELIX-59 — Budget & guardrail enforcement  ✅
- **What it is:** safety limits on an agent run. You can cap how many steps it takes, how
  many tokens or dollars it's allowed to spend, and it automatically stops if it gets stuck
  repeating the same action ("loop detection"). When a limit is hit, the run stops cleanly
  and says exactly which limit and by how much.
- **Why it matters:** without this, a confused or looping agent could rack up a huge bill
  or run forever. This keeps every run bounded and predictable, and reports the running
  token/cost total for each run.
- **Where it lives:** [../libs/agent/src/lib/guardrails.ts](../libs/agent/src/lib/guardrails.ts),
  wired into `runAgent()`.

#### HELIX-60 — Structured output parser/validator  ✅
- **What it is:** a checker for an agent's final answer. If an agent is supposed to return
  data in a specific shape (say `{ title, count }`), this pulls the JSON out of the reply —
  even if the model wrapped it in code fences or chatty text — and checks it matches the
  expected shape, listing exactly what's wrong if it doesn't.
- **Why it matters:** downstream steps need reliable, structured data, not free-form prose.
  This turns "the model said something JSON-ish" into "validated data, or a clear list of
  problems" — without crashing the run when the output is off.
- **Where it lives:** [../libs/agent/src/lib/output.ts](../libs/agent/src/lib/output.ts),
  surfaced on the run result when an agent declares an `outputSchema`.

#### HELIX-61 — Step event emitter  ✅
- **What it is:** a live play-by-play of an agent run. As the agent works, it announces each
  moment — run started, thinking, called a tool, got a result, step finished, run ended
  (with the final reason and token/cost totals). Anything can listen in.
- **Why it matters:** it's how a UI shows progress in real time, and how tracing and
  monitoring (a later story) will record what happened. Listening is optional and never
  affects the run.
- **Where it lives:** [../libs/agent/src/lib/events.ts](../libs/agent/src/lib/events.ts);
  the loop emits via an `onEvent` handler.

### Story: Agent Memory & Context Store  ✅ done
Giving agents memory: a short-term scratchpad, long-term recall by meaning, and a
retrieval API that ranks and cites what it finds.

#### HELIX-62 — Working-memory store  ✅
- **What it is:** a per-run scratchpad — small notes an agent can jot down and read back
  while it works (e.g. "the user's repo is X", "step 2 done"). Each run gets its own private
  space, so parallel runs never mix up notes.
- **Why it matters:** agents need somewhere to keep track of what they've figured out across
  steps. There's a simple in-memory version for tests/single-machine use, and a
  Redis-backed one so the scratchpad is shared and survives across worker processes, with
  notes auto-expiring so old runs don't pile up.
- **Where it lives:** the interface + in-memory version in
  [../libs/agent/src/lib/memory.ts](../libs/agent/src/lib/memory.ts); the Redis version in
  [../apps/registry/src/working-memory/](../apps/registry/src/working-memory/).

#### HELIX-63 — Vector store integration (pgvector)  ✅
- **What it is:** long-term memory by *meaning*. Text is turned into a list of numbers (an
  "embedding") that captures what it's about; similar text → similar numbers. We store
  these in Postgres (using the `pgvector` extension) and can ask "what's most similar to
  this?" — the basis for an agent recalling relevant past notes/snippets.
- **Why it matters:** keyword search misses paraphrases; similarity search finds related
  content even when the words differ. There's a simple in-memory version for tests and a
  Postgres-backed one for real use.
- **Embeddings:** a deterministic stand-in (`HashingEmbedder`) is the default so tests run
  offline; a **real** embeddings model — `VoyageEmbedder` (Voyage AI, 1024-dim) — drops in
  behind the same interface, selected by `getEmbedder()` when `VOYAGE_API_KEY` is set.
  *Note:* the persistent pgvector column is `vector(64)` (sized for the stand-in); using the
  real 1024-dim embedder with the Postgres store needs a one-line dimension migration.
- **Where it lives:** [../libs/agent/src/lib/vector-store.ts](../libs/agent/src/lib/vector-store.ts)
  + [embeddings.ts](../libs/agent/src/lib/embeddings.ts) + [voyage-embedder.ts](../libs/agent/src/lib/voyage-embedder.ts);
  the Postgres/pgvector store in [../apps/registry/src/vector-store/](../apps/registry/src/vector-store/).

#### HELIX-64 — Retrieval API + ranking  ✅
- **What it is:** the "search" front door over the memory store. Given a question, it finds
  the most relevant saved snippets two ways — by meaning (similarity) *and* by matching the
  actual words — blends the two into one ranked list, and returns each result with a
  citation (where it came from).
- **Why it matters:** meaning-search alone can miss exact terms (names, IDs, error codes),
  and word-search alone misses paraphrases; combining them gives better results than either.
  The citations let an agent show its sources rather than make claims out of thin air.
- **Where it lives:** [../libs/agent/src/lib/retriever.ts](../libs/agent/src/lib/retriever.ts).

### Story: Agent Tracing & Cost Accounting  ✅ done
A replayable record of what each run did, exported to standard tooling, plus cost roll-ups.

#### HELIX-65 — Trace schema + writer  ✅
- **What it is:** turns the live play-by-play of a run (the event stream) into a tidy,
  structured **trace** — a timeline of "spans": the whole run, each step inside it, and each
  model call and tool call inside those, with start/end times, how long each took, whether
  it succeeded, and useful details (model, tokens, tool name, why it stopped).
- **Why it matters:** when a run misbehaves or costs too much, you need to see exactly what
  happened and where the time/tokens went. This is the debugging + audit backbone; the next
  pieces export it to standard tools and roll the costs up.
- **Where it lives:** [../libs/agent/src/lib/trace.ts](../libs/agent/src/lib/trace.ts)
  (`buildSpans` + `TraceCollector`).

#### HELIX-66 — OpenTelemetry instrumentation  ✅
- **What it is:** sends those run traces out in the **industry-standard OpenTelemetry**
  format, so they show up in normal observability tools (Jaeger, Grafana Tempo, etc.) next
  to everything else. It also adds the standard "trace ID" plumbing (`traceparent`) so a
  single request can be followed *across* services, not just within one run.
- **Why it matters:** teams already have dashboards and alerting for OpenTelemetry — this
  plugs Helix into them instead of inventing a private format, and lets one user request be
  traced end-to-end through every service it touches.
- **Where it lives:** [../libs/agent/src/lib/otel-trace-sink.ts](../libs/agent/src/lib/otel-trace-sink.ts)
  (export) + [correlation.ts](../libs/agent/src/lib/correlation.ts) (cross-service IDs).

#### HELIX-67 — Cost roll-up jobs  ✅
- **What it is:** adds up all those per-call cost records into totals — per run, per
  organization, and per day. Ask "what did run X cost?" or "what did org Y spend each day
  this month?" and get tokens + dollars back.
- **Why it matters:** the meter records every call individually; this turns that firehose
  into the numbers billing and cost dashboards actually need. Unpriced calls are skipped so
  totals stay honest.
- **Where it lives:** [../apps/registry/src/token-usage/token-usage-rollup.service.ts](../apps/registry/src/token-usage/token-usage-rollup.service.ts).

---

## Fixes & hardening

Not Jira sub-tasks, but part of keeping the foundation solid:

- **Production build fix** (PR #5) — the app couldn't be packaged for production (a config
  mistake made the build try to compile the test files). Fixed, and the CI checks were
  upgraded to **typecheck + build + test** so this can't silently break again.
- **Duplicate API-doc header fix** (PR #6) — the Swagger docs listed the `x-org-id` header
  twice on some endpoints. Fixed so each shows it once (and endpoints that ignore it don't
  list it).
- **Cost-meter pricing fix** (PR #12) — a real Haiku test call revealed the cost meter
  recorded **$0** (null) instead of the real cost: the AI returns a dated model name
  (`claude-haiku-4-5-20251001`) but our price list was keyed by the short name. Now we
  strip the date and match, so dated models price correctly. Caught only by a live call —
  the mocked tests used the short name — so a regression test was added.

---

## Summary

| Ticket | What it is (plain words) | Status | PR |
|--------|--------------------------|--------|----|
| HELIX-50 | Rulebook for agent recipes (schema) | ✅ | initial |
| HELIX-51 | Filing cabinet + database (storage) | ✅ | #1 |
| HELIX-53 | Front desk (web API) | ✅ | #3 |
| HELIX-52 | Blank-filler (prompt templates) | ✅ | #4 |
| HELIX-54 | AI-model plug (Anthropic adapter) | ✅ | #8 |
| HELIX-55 | Model dispatcher + cost limits (routing) | ✅ | #9 |
| HELIX-56 | Retry / failover / timeout safety wrapper | ✅ | #10 |
| HELIX-57 | Token & cost meter (usage table) | ✅ | #11 |
| HELIX-58 | Core agent loop (the agent engine) | ✅ | #13 |
| HELIX-59 | Budget & guardrail enforcement | ✅ | #14 |
| HELIX-60 | Structured output parser/validator | ✅ | #15 |
| HELIX-61 | Step event emitter (live run events) | ✅ | #16 |
| HELIX-62 | Working-memory store (per-run scratchpad) | ✅ | #17 |
| HELIX-63 | Vector store (pgvector similarity recall) | ✅ | #18 |
| HELIX-64 | Retrieval API + ranking (hybrid + citations) | ✅ | #19 |
| HELIX-65 | Trace schema + writer (run spans) | ✅ | #20 |
| HELIX-66 | OpenTelemetry export + correlation | ✅ | #21 |
| HELIX-67 | Cost roll-up jobs (run/org/day totals) | ✅ | #22 |
| — | Production build fix + CI hardening | ✅ | #5 |
| — | Duplicate `x-org-id` Swagger fix | ✅ | #6 |
| — | Cost-meter dated-model pricing fix | ✅ | #12 |

---

## What's next

🎉 **The Core Agent Platform epic (HELIX-1) is complete** — all five stories done:
Agent Definition & Registry, LLM Gateway & Model Router, Agent Execution Runtime, Agent
Memory & Context Store, and Agent Tracing & Cost Accounting. An agent can now be defined,
routed to a model, run a tool-using loop within budget, return validated output, remember
across runs, recall by similarity, and be traced and costed end-to-end.

Next epics, per the product plan: the **Workflow Engine** (chaining agents into durable
pipelines), then **MCP Integration / GitHub access**, **sandboxes**, **human approvals**,
and the **user-facing SaaS** (auth, run dashboard).

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
