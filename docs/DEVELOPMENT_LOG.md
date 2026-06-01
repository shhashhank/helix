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

## Epic: Core Agent Platform  ✅ done

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

## Epic: Workflow Engine  ✅ done

Chaining agents into multi-step pipelines (e.g. plan → code → review), defined as a graph.

### Story: Workflow Definition & DAG Engine  ✅ done
How a workflow is described and checked before it runs.

#### HELIX-68 — Workflow DSL + validator  ✅
- **What it is:** the "recipe format" for a workflow. You describe it as boxes (**steps** —
  each runs an agent) joined by arrows (**edges** — "after step A succeeds, do step B"),
  optionally branching on success/failure. The validator then checks the recipe makes sense
  *before* anything runs: every arrow points to a real step, names are unique, nothing loops
  back on itself, and there's a clear starting point.
- **Why it matters:** catching a broken workflow at definition time (a typo'd step, an
  accidental loop) is far cheaper than failing halfway through a live, paid run. It's the
  contract the next pieces (the scheduler that actually runs the graph) build on.
- **Where it lives:** [../libs/workflow/src/lib/types.ts](../libs/workflow/src/lib/types.ts)
  (the format) + [validator.ts](../libs/workflow/src/lib/validator.ts) (the checks).

#### HELIX-69 — DAG compiler + scheduler  ✅
- **What it is:** the engine that actually *runs* a workflow. It works out the order — which
  steps can run at the same time vs. which must wait — then executes them, following the
  arrows: only run a step if the branch leading to it was taken (e.g. run "fix" only if
  "code" failed), and skip the branches that weren't. If a step blows up, that counts as a
  "failure" so a recovery branch can kick in. Independent steps run in parallel.
- **Why it matters:** this is what turns a workflow *drawing* into real multi-agent
  execution — plan → code → (review or fix) → … — with the right ordering, branching, and
  parallelism handled for you. The per-step work is plugged in (it'll be the agent loop), so
  this layer just orchestrates.
- **Where it lives:** [../libs/workflow/src/lib/compiler.ts](../libs/workflow/src/lib/compiler.ts)
  (ordering into parallel levels) + [runner.ts](../libs/workflow/src/lib/runner.ts) (running it).

#### HELIX-70 — Workflow versioning  ✅
- **What it is:** a versioned filing system for workflow recipes. Each time you save a
  workflow it gets a new version number (1, 2, 3 …) and the old versions are kept, never
  overwritten. When a run starts it "pins" the version it's using and remembers that pin —
  so it always re-reads the *exact* recipe it began with, even if someone changes the
  workflow later.
- **Why it matters:** runs become reproducible and auditable. If you edit a workflow halfway
  through a long-running job, the in-flight run isn't silently changed underneath it — it
  keeps using the version it started on. And you can always look back at precisely which
  recipe produced a given result.
- **Where it lives:** [../libs/workflow/src/lib/registry.ts](../libs/workflow/src/lib/registry.ts)
  — `WorkflowRegistry` (publish → next version, get/latest, `pin` a version for a run,
  `resolve` a pin back to the saved recipe). Stored versions are deep-frozen so they can't
  be tampered with after the fact.

✅ **Story complete** — Workflow Definition & DAG Engine (HELIX-17): define a workflow
(HELIX-68), compile + run it (HELIX-69), and version it for reproducible runs (HELIX-70).

### Story: Durable Execution & State Persistence  ✅ done
Making a running workflow survive crashes so a long, expensive run isn't lost.

#### HELIX-71 — Temporal integration (workflows + activities)  ✅
- **What it is:** we now run workflows on top of [Temporal](https://temporal.io), a battle-tested
  engine for *durable* execution. Each step of our graph becomes a Temporal **activity** (a
  unit of work Temporal records and can retry), and the overall graph runs as a Temporal
  **workflow**. Crucially, this reuses the exact same ordering/branching logic from HELIX-69 —
  we just swapped "call the step in-process" for "run the step as a durable activity."
- **Why it matters:** if the machine running a workflow crashes or is restarted halfway
  through, Temporal **resumes from the last completed step** instead of starting the whole
  (often long and costly) run over. It also gives us automatic retries for transient errors,
  while a deliberate "this step failed" result still routes the failure branch as before.
  This is the backbone for the rest of this story (idempotency, crash-recovery tests).
- **Where it lives:** [../libs/workflow/src/lib/temporal/](../libs/workflow/src/lib/temporal/)
  — `workflows.ts` (the durable graph, sandbox-safe), `activities.ts` (a step → activity),
  `worker.ts` (the process that runs them), `client.ts` (start/await a run). Verified end-to-end
  against a real in-memory Temporal test server.
- **Note:** Temporal ships a native binary and the tests spin up a local test server, so this
  is the first piece whose tests reach beyond pure-offline — CI downloads the Temporal test
  server (it runs in-memory, no separate service needed).

#### HELIX-72 — Idempotency keys for side effects  ✅
- **What it is:** a safety latch so a *retried* step doesn't repeat its real-world actions.
  When Temporal retries a step (HELIX-71), the step might have already done something with a
  side effect — charged a card, opened a PR, sent an email. Each such action gets a stable
  **idempotency key**; before doing it, we check "have we already done *this exact* action?"
  If yes, we replay the remembered result instead of doing it again.
- **Why it matters:** automatic retries are only safe if they don't double-act. Without this,
  a crash-and-retry could open two PRs or bill twice. The key is derived from the run + step
  (stable across retries, unique per action), so the dedupe survives exactly the situations
  retries create. It also single-flights concurrent calls and deliberately does **not**
  remember failures (so a genuine retry of a failed action can still happen).
- **Where it lives:** [../libs/workflow/src/lib/idempotency.ts](../libs/workflow/src/lib/idempotency.ts)
  — `IdempotencyGuard.runOnce(key, fn)` over a pluggable store (in-memory now; Prisma/Redis
  later) — plus [temporal/idempotency-key.ts](../libs/workflow/src/lib/temporal/idempotency-key.ts)
  which derives the stable key from the running activity's context.
- **Honest limit:** the result is recorded only *after* the action succeeds, so a crash in the
  tiny window between acting and recording can still repeat it. The real fix is to hand the
  same key to the external service so *it* dedupes (the Stripe model) — this makes that key
  available; full at-most-once is out of scope here.

#### HELIX-73 — State persistence + recovery (chaos restart)  ✅
- **What it is:** the proof that all the above actually survives a crash. The test starts a
  real workflow, lets one worker do the first steps and begin the middle step, then **kills
  that worker mid-run** and brings up a fresh one. It checks three things: the run *finishes*
  on the new worker, the already-done first step is **not redone**, and the side effect from
  the middle step is **not repeated**.
- **Why it matters:** "durable" is a claim that's easy to get subtly wrong, so it needs a test
  that genuinely pulls the plug. This one does — and proves the whole story end-to-end:
  Temporal keeps the run's state (HELIX-71), the new worker resumes from the last checkpoint
  rather than restarting, and idempotency keys (HELIX-72) stop the retried step from acting
  twice. It's the safety net under every long, expensive multi-agent run.
- **Where it lives:** [../libs/workflow/src/__tests__/temporal-recovery.spec.ts](../libs/workflow/src/__tests__/temporal-recovery.spec.ts).
  Uses a real local Temporal server so the crash + retry timing is deterministic (the
  in-memory test server can't fast-forward an in-flight step's timeout).

✅ **Story complete** — Durable Execution & State Persistence (HELIX-18): run on Temporal
(HELIX-71), don't double-act on retries (HELIX-72), and a killed worker resumes from the last
checkpoint (HELIX-73).

### Story: Human-in-the-Loop Pause/Resume  ✅ done
Letting a workflow stop and wait for a person to approve a risky action before continuing.

#### HELIX-74 — Pause/await-signal primitive  ✅
- **What it is:** a way for a workflow to **pause and wait for a human's yes/no**, then carry
  on. A step calls `awaitApproval(...)` and the run simply *stops there* — durably — until
  someone sends an "approved"/"rejected" decision (a Temporal **signal**). If nobody answers
  within a time limit, a **timeout policy** decides for them (default: rejected, the safe choice).
- **Why it matters:** some actions shouldn't happen without sign-off (deploying, spending money,
  deleting things). Because the wait is durable, a run can sit paused for hours or days — across
  restarts — without burning resources, and resume the instant a decision arrives. The timeout
  keeps a forgotten approval from blocking forever (or, if you choose, from auto-proceeding).
- **Where it lives:** [../libs/workflow/src/lib/temporal/approval.ts](../libs/workflow/src/lib/temporal/approval.ts)
  — `awaitApproval()` + the `approvalSignal` definition (the channel a decision comes in on) —
  plus a thin `approvalGateWorkflow` in [workflows.ts](../libs/workflow/src/lib/temporal/workflows.ts).

#### HELIX-75 — Approval request emitter  ✅
- **What it is:** when a workflow pauses for sign-off, it first **announces that an approval is
  needed** — it publishes an "approval request" (who/what/why, plus a cost or diff for context)
  to an approval service so a person or UI knows to act. Without this, a paused run is invisible:
  it's waiting, but nobody knows.
- **Why it matters:** it's the *outbound* half of human-in-the-loop. The publish runs as a
  durable, retried Temporal activity, so the "please approve" notice survives a crash and isn't
  lost; the request carries a stable id so the approval service can ignore duplicates. The pause
  itself (HELIX-74) then waits for the answer.
- **Where it lives:** [../libs/workflow/src/lib/approval-request.ts](../libs/workflow/src/lib/approval-request.ts)
  (the request shape + a pluggable `ApprovalRequestSink` — the "approval service" seam, in-memory
  for now) + [temporal/approval-activities.ts](../libs/workflow/src/lib/temporal/approval-activities.ts)
  (the publish activity) + a `requestApprovalWorkflow` that **emits then pauses**.

#### HELIX-76 — Resume-on-decision handler  ✅
- **What it is:** the *inbound* half — taking a person's "approved/rejected" answer and **delivering
  it into the paused run** so it continues. Two small client helpers: `submitApprovalDecision(...)`
  (send the decision — under the hood, a Temporal signal) and `getApprovalStatus(...)` (ask a run
  whether it's still waiting, or what was decided).
- **Why it matters:** it closes the loop. HELIX-74 made a run *wait*, HELIX-75 *announced* the wait;
  this is how the answer actually gets back in, from an API/UI, to resume the run. The status query
  lets a dashboard show "awaiting approval" and, afterwards, the recorded decision — even on a
  finished run. (Submitting after a run already decided/timed out fails loudly: the decision came
  too late.)
- **Where it lives:** [../libs/workflow/src/lib/temporal/decision.ts](../libs/workflow/src/lib/temporal/decision.ts)
  (`submitApprovalDecision`, `getApprovalStatus`) + the `approvalStatusQuery` added to
  [approval.ts](../libs/workflow/src/lib/temporal/approval.ts).

✅ **Story complete** — Human-in-the-Loop Pause/Resume (HELIX-19): a workflow durably pauses for
approval (HELIX-74), announces it (HELIX-75), and resumes when a human's decision is delivered back
in (HELIX-76).

### Story: Retries (minimal)  ✅ done
Per-step control over what happens when a step errors.

#### HELIX-77 — Per-step retry policy  ✅
- **What it is:** each step in a workflow can now carry its own **retry policy** — how many times
  to retry, how long to wait between tries (and how fast that delay grows), and **which errors
  shouldn't be retried at all**. So a flaky network step can retry a few times with backoff, while
  a "bad input" error fails immediately instead of pointlessly retrying.
- **Why it matters:** retries are the difference between a transient blip and a failed run — but
  blindly retrying *everything* wastes time and money (and can repeat a bad request). Per-step
  control + retryable-error classification lets each step be as patient or as strict as it should
  be. The durable engine (Temporal) enforces the policy, with backoff timers that survive crashes.
- **Where it lives:** `StepRetryPolicy` on a step in
  [../libs/workflow/src/lib/types.ts](../libs/workflow/src/lib/types.ts) (validated in
  [validator.ts](../libs/workflow/src/lib/validator.ts)), mapped onto Temporal's activity retry in
  [temporal/workflows.ts](../libs/workflow/src/lib/temporal/workflows.ts) (a per-step activity proxy).

✅ **Story complete** — Retries (HELIX-20): configurable per-step retries with backoff and
retryable-error classification.

### Story: Workflow Orchestrator API & Status  ✅ done
The first **user-facing** surface for the engine — an HTTP API to drive workflow runs.

#### HELIX-78 — Run lifecycle API  ✅
- **What it is:** a real web API (a new **`orchestrator`** service) to **start, check, cancel, and
  retry** workflow runs. `POST /api/runs` starts a run from a workflow definition; `GET /api/runs/:id`
  reports its status (running/completed/failed/…); `POST /api/runs/:id/cancel` stops it;
  `POST /api/runs/:id/retry` re-runs a failed one. There's Swagger docs at `/api/docs`.
- **Why it matters:** until now the whole engine was usable only from code and tests. This is the
  first point a **person (or a UI)** can actually kick off and manage a run over HTTP — the bridge
  from "library" to "product". It validates the workflow at the door (bad definitions get a 400)
  and talks to Temporal as a client, so it stays a thin, stateless front door over the durable engine.
- **Where it lives:** the new [../apps/orchestrator/](../apps/orchestrator/) app —
  [workflow-run.controller.ts](../apps/orchestrator/src/workflow-run/workflow-run.controller.ts) +
  [workflow-run.service.ts](../apps/orchestrator/src/workflow-run/workflow-run.service.ts), over a
  Temporal client. The client-only helpers live behind a worker-free entrypoint
  `@helix/workflow/temporal-client` so the API never loads the heavy worker runtime.

#### HELIX-79 — Live status stream (SSE)  ✅
- **What it is:** a **`GET /api/runs/:id/stream`** endpoint that streams a run's **per-step progress
  live** (Server-Sent Events) — which steps have completed, which were skipped, and when the whole
  run finishes — so a UI can watch a workflow unfold instead of repeatedly asking "are we there yet?".
- **Why it matters:** it's what makes the engine feel *alive* to a user. Combined with the lifecycle
  API (HELIX-78), a person can now start a run **and watch it progress step-by-step** in real time —
  the full "kick it off and watch it" experience the story set out to deliver.
- **How it works (plain words):** the running workflow keeps a little live scoreboard of its steps and
  answers a "what's your progress?" question (a Temporal *query*). The orchestrator checks that
  scoreboard on a short interval, sends an update only when something actually changed, and closes the
  stream once the run is done. (We chose this over a heavier message-bus because it needs no extra
  infrastructure and works across the separate API and worker processes.)
- **Where it lives:** the per-step scoreboard + query in
  [../libs/workflow/src/lib/runner.ts](../libs/workflow/src/lib/runner.ts) (`WorkflowProgress`) and
  [temporal/workflows.ts](../libs/workflow/src/lib/temporal/workflows.ts); the SSE endpoint in
  [../apps/orchestrator/src/workflow-run/workflow-run.controller.ts](../apps/orchestrator/src/workflow-run/workflow-run.controller.ts)
  + `streamProgress` in the service.

✅ **Story complete** — Workflow Orchestrator API & Status (HELIX-21): start/cancel/retry/get
(HELIX-78) plus a live per-step SSE stream (HELIX-79).

🎉 **Epic complete — Workflow Engine (HELIX-2).** All five stories done: define & run a DAG
(HELIX-17), durable execution on Temporal (HELIX-18), human-in-the-loop pause/resume (HELIX-19),
per-step retries (HELIX-20), and a user-facing orchestrator API with live status (HELIX-21).

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
- **Orchestrator deploy-deps prune** (PR #36) — the orchestrator's generated production
  `package.json` was over-listing the whole `@temporalio` set (worker/workflow/activity),
  because Nx rolls up its `@helix/workflow` dependency at the *project* level even though the
  service only ever loads `@temporalio/client`. A small build-time plugin now prunes those
  unused packages from the deploy manifest (only when the bundle genuinely doesn't require
  them), so production no longer installs the heavyweight native worker. (A full lib split was
  ruled out: the pure DAG core is bundled into the Temporal workflow sandbox via relative
  imports, so extracting it would break the workflow bundler.) Runtime behavior is unchanged.
- **Local manual-testing setup** (PR #38) — made the platform runnable by hand end-to-end:
  the dev `docker-compose` Postgres now uses the **pgvector** image (the plain image failed the
  `vector` migration), and a small **dev worker** (`pnpm dev:worker`, stub step executor) lets
  runs started via the orchestrator API actually execute so you can watch them progress over
  SSE. Steps written up in [LOCAL_TESTING.md](LOCAL_TESTING.md). (Real per-role agent execution
  is still to come with the agent epics.)

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
| HELIX-68 | Workflow DSL + validator (DAG definition) | ✅ | #25 |
| HELIX-69 | DAG compiler + scheduler (runs the graph) | ✅ | #26 |
| HELIX-70 | Workflow versioning (pin a recipe per run) | ✅ | #27 |
| HELIX-71 | Temporal integration (durable execution) | ✅ | #28 |
| HELIX-72 | Idempotency keys (retries don't double-act) | ✅ | #29 |
| HELIX-73 | Crash-recovery tests (killed worker resumes) | ✅ | #30 |
| HELIX-74 | Pause/await-signal primitive (human approval) | ✅ | #31 |
| HELIX-75 | Approval request emitter (announce sign-off) | ✅ | #32 |
| HELIX-76 | Resume-on-decision handler (deliver the answer) | ✅ | #33 |
| HELIX-77 | Per-step retry policy (backoff + classification) | ✅ | #34 |
| HELIX-78 | Run lifecycle API (start/get/cancel/retry) | ✅ | #35 |
| HELIX-79 | Live per-step status stream (SSE) | ✅ | #37 |
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

The **Workflow Engine** (HELIX-2) is now underway. Its first story — **Workflow Definition
& DAG Engine** — is ✅ done: you can define a workflow (HELIX-68), compile and run it with
branching + parallelism (HELIX-69), and version it so runs are reproducible (HELIX-70). The
second story — **Durable Execution & State Persistence** — is now in progress: workflows now
run on **Temporal** (HELIX-71), so a run survives a crash and resumes from its last completed
step; a retried step won't repeat its side effects (**idempotency keys**, HELIX-72); and a
crash-recovery test proves a killed worker resumes from the last checkpoint (HELIX-73) — so
the **Durable Execution & State Persistence** story is ✅ done. The third story —
**Human-in-the-Loop Pause/Resume** (HELIX-19) and **Retries** (HELIX-20) are ✅ done: a workflow
durably pauses for approval (HELIX-74), announces it (HELIX-75), resumes on the delivered decision
(HELIX-76), and each step carries a configurable retry policy with backoff + retryable-error
classification (HELIX-77). The **last story** — the **Workflow Orchestrator API & Status**
(HELIX-21) — is ✅ done too: a new `orchestrator` service exposes a run lifecycle API
(start/get/cancel/retry, HELIX-78) plus a live per-step SSE stream (HELIX-79), so a user can kick
off a run and watch it unfold.

🎉 **That completes the Workflow Engine epic (HELIX-2)** — and with the Core Agent Platform epic
(HELIX-1) before it, Helix can now define agents, run a tool-using agent loop within budget,
remember/recall context, trace + cost runs, and chain agents into durable, human-gated,
retrying multi-step workflows you can drive and watch over HTTP. **Next up:** **MCP Integration /
GitHub access**, **sandboxes**, **human approvals**, and the **user-facing SaaS** (auth, run
dashboard) — where all of this gets a real UI.

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
