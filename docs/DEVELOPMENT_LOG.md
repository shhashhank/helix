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

## Epic: MCP Integration Layer  ✅ done

The governed layer that lets agents use external tools (GitHub, etc.) through the **Model
Context Protocol (MCP)** — so agents can actually *do* things, not just think.

### Story: MCP Client & Server Registry  ✅ done
Connecting to MCP servers and discovering the tools they offer.

#### HELIX-80 — MCP client implementation  ✅
- **What it is:** the piece that **talks to an MCP server** — it connects (the "handshake"),
  **asks what tools the server offers** (discovery), and **calls a tool** with arguments
  (invocation), handing back the result. Think of it as a universal adapter: any tool server
  that speaks MCP (GitHub, a filesystem, a database…) can be plugged in through this one client.
- **Why it matters:** it's the doorway from "an agent decided to use a tool" to "the tool
  actually ran". Everything in this epic — the GitHub tools, permissioning, the tool catalog —
  builds on having a reliable client. Tool *failures* come back as a flagged result (so the agent
  can react), while connection/protocol problems are raised as errors.
- **Where it lives:** [../libs/mcp/](../libs/mcp/) (`@helix/mcp`) — `HelixMcpClient`
  ([client.ts](../libs/mcp/src/client.ts)) wrapping the official `@modelcontextprotocol/sdk`,
  with a small Helix-facing shape ([types.ts](../libs/mcp/src/types.ts)). It's transport-agnostic
  (in-memory for tests, a subprocess for a real server), verified with an in-memory MCP server.
- **Note:** the MCP SDK is ESM-first, so this lib type-checks with `moduleResolution: bundler`
  and runs as CommonJS (loading the SDK's CJS build) — keeping it consistent with the rest of the
  workspace.

#### HELIX-81 — Server registry + health checks  ✅
- **What it is:** a **directory of the MCP tool servers** the platform knows about. You can
  register a server (how to reach it — a local command or a URL), **enable/disable** it, and
  **health-check** it: the registry connects (using the HELIX-80 client) and lists the server's
  tools — healthy if that works (with a tool count), unhealthy if it can't connect, "disabled" if
  it's been turned off.
- **Why it matters:** before agents can use tools, the platform needs to know *which* tool servers
  exist and *whether they're alive*. The enable/disable switch is an operator's kill switch, and
  the liveness probe means a dead server is spotted up front rather than mid-run.
- **Where it lives:** [../libs/mcp/src/registry.ts](../libs/mcp/src/registry.ts) — `McpServerRegistry`
  (register/list/get/enable/disable/remove + `healthCheck`/`healthCheckAll`). How to *connect* to a
  server is an injected `McpServerConnector` (so the logic is testable without spawning real
  servers); a `createDefaultConnector` builds real stdio/HTTP transports for production.

#### HELIX-82 — Tool catalog sync  ✅
- **What it is:** the **master list of every tool available across all the servers**. It connects
  to each enabled server, asks what tools it has, and merges everything into one flat catalog —
  each tool tagged with which server it came from and given a unique name like `gh:create_pr` (so
  two servers can both have a "search" tool without clashing).
- **Why it matters:** this is what the agent actually reads to decide "what can I do?". One server
  being down doesn't break the catalog — that server is just skipped and noted, and the rest still
  show up. The server tag on each tool is the routing info needed to send a tool call to the right
  place.
- **Where it lives:** [../libs/mcp/src/catalog.ts](../libs/mcp/src/catalog.ts) — `McpToolCatalog`
  (`sync` to (re)build from the registry's enabled servers, then `list`/`byServer`/`find`).

✅ **Story complete** — MCP Client & Server Registry (HELIX-22): a client that speaks MCP
(HELIX-80), a registry of servers with health checks (HELIX-81), and an aggregated tool catalog
for the agent runtime (HELIX-82).

### Story: Tool Permissioning & Policy (basic)  ✅ done
Deciding which tools an agent is actually *allowed* to use — and recording it.

#### HELIX-83 — Policy model + evaluator  ✅
- **What it is:** a **rulebook for tool permissions**. For a given request — "this org / this agent
  role wants to call this tool on this server" — it returns **allow**, **deny**, or
  **needs-approval**. Rules match on whatever you specify (org, role, server, tool name — anything
  left blank is a wildcard), and when several rules apply the **strictest wins** (a deny always
  beats an allow). If no rule matches, the safe default is **deny**.
- **Why it matters:** agents will soon be able to do real things (open PRs, run commands), so the
  platform needs a gate in front of every tool call. "Deny wins" + "default deny" make it
  *fail-closed* — nothing slips through by accident — and every decision (allow or deny) is written
  to an audit trail. The third outcome, **needs-approval**, is the hook that will route risky tools
  through the human Approval Service (HELIX-85).
- **Where it lives:** [../libs/mcp/src/policy.ts](../libs/mcp/src/policy.ts) — `evaluatePolicy`
  (the decision), `ToolPolicyEnforcer` (evaluate + audit + **block** denied calls), and a pluggable
  audit sink.

#### HELIX-84 — Rate limiting + quotas  ✅
- **What it is:** a **usage cap** on tool calls — "no more than N calls per time window" — that
  you can set **per org, per server, or per tool**. A request that would exceed the cap is blocked.
- **Why it matters:** permission says *whether* a tool may be used; this says *how much*. It stops
  a runaway agent (or a buggy loop) from hammering an external service or burning through an org's
  budget, and lets different orgs/tools have different ceilings. The cap's granularity follows the
  rule: an org-scoped limit caps that org's *total* calls, a tool-scoped limit caps that one tool.
- **Where it lives:** [../libs/mcp/src/rate-limit.ts](../libs/mcp/src/rate-limit.ts) —
  `FixedWindowRateLimiter` (a counter with an injectable clock, so it's deterministic to test) +
  `ToolQuotaEnforcer` (`check`/`enforce`, throwing `RateLimitExceededError` when over). In-memory
  for now; a shared store (Redis) would enforce it across replicas.

#### HELIX-85 — Approval-gated tool routing  ✅
- **What it is:** the bridge that sends **risky tool calls to a human for sign-off**. When the
  policy marks a tool `require_approval`, the call isn't run outright — it's routed to the Approval
  Service, and only proceeds if a person approves (it's blocked if they reject).
- **Why it matters:** some actions are too consequential to leave to an agent alone (merging to
  main, deleting infra, spending money). This connects two things already built — the policy's
  `require_approval` outcome (HELIX-83) and the durable human approval flow from the Workflow epic
  (HELIX-74/75/76) — so high-risk tools get a human in the loop without the agent having to know
  the details. Plain allows pass straight through; denials are still blocked up front.
- **Where it lives:** [../libs/mcp/src/tool-approval.ts](../libs/mcp/src/tool-approval.ts) —
  `ApprovalGatedToolPolicy.authorize()` (enforce → allow / block / route-for-approval) over a
  pluggable `ToolApprovalGateway` (the "Approval Service" seam; the real one publishes a request
  and durably waits via `awaitApproval`).

✅ **Story complete** — Tool Permissioning & Policy (HELIX-23): a policy gate (HELIX-83),
rate limits/quotas (HELIX-84), and approval routing for risky tools (HELIX-85) — fail-closed,
audited, and human-gated where it matters.

### Story: GitHub MCP Server  ✅ done
The first **real** tool server — gives agents actual GitHub abilities over MCP.

#### HELIX-86 — Repo read/search tools  ✅
- **What it is:** the first batch of real GitHub tools, exposed as an MCP server: **read a file**,
  **list a repo's files/folders**, and **search code**. An agent connected through the MCP client
  can now actually look inside a repository.
- **Why it matters:** until now the MCP layer had only a stub for testing. This is the first
  *concrete* tool server — the read side of "as a coding agent, I want GitHub tools." It's written
  against a small `GitHubClient` interface, so the tools are fully testable with a stub today; the
  real GitHub-backed client (with short-lived GitHub App tokens) plugs in at HELIX-89. Expected
  failures (a missing file) come back as a tool error rather than crashing the call.
- **Where it lives:** the new [../libs/github-mcp/](../libs/github-mcp/) (`@helix/github-mcp`) —
  `createGitHubMcpServer` + [repo-tools.ts](../libs/github-mcp/src/repo-tools.ts)
  (`github_get_file` / `github_get_tree` / `github_search_code`) over the
  [GitHubClient](../libs/github-mcp/src/github-client.ts) seam. Verified end-to-end against an
  in-memory MCP client.

#### HELIX-87 — Branch/commit/push tools  ✅
- **What it is:** the *write* side of the GitHub server — **create a branch** and **commit files**
  (add/update files in one commit on a branch). With HELIX-86's read tools, an agent can now look
  at a repo *and* make changes to it.
- **Why it matters:** this is what lets a coding agent actually produce work — branch off, write
  the code, commit it. These mutate the repo, so in production they run with a short-lived,
  repo-scoped GitHub App token (HELIX-89) and sit behind the tool policy/approval gate. Like the
  read tools, they're built on the `GitHubClient` seam (stub-tested) and return tool errors on
  expected failures (e.g. a branch that already exists).
- **Where it lives:** [../libs/github-mcp/src/write-tools.ts](../libs/github-mcp/src/write-tools.ts)
  (`github_create_branch`, `github_commit_files`), registered on the same server; the shared
  tool-result helpers were factored into [tool-result.ts](../libs/github-mcp/src/tool-result.ts).

#### HELIX-88 — PR + review-comment tools  ✅
- **What it is:** the pull-request abilities — **open a PR**, **comment on it**, and **request a
  review**. With read (HELIX-86) and write (HELIX-87), the agent can now do the whole loop: read a
  repo → branch + commit → open a PR for review.
- **Why it matters:** opening a PR (rather than pushing to main) is exactly the human-checkpoint
  the product is built around — the agent proposes changes and a person reviews. These are the last
  GitHub tools the coding agent needs; like the rest they're built on the `GitHubClient` seam and
  return tool errors on expected failures (e.g. a PR that already exists for the branch).
- **Where it lives:** [../libs/github-mcp/src/pr-tools.ts](../libs/github-mcp/src/pr-tools.ts)
  (`github_create_pull_request`, `github_comment_on_pull_request`, `github_request_review`),
  registered on the same server. Last in this story: **GitHub App auth** (HELIX-89) — how the
  server authenticates behind all these tools.

#### HELIX-89 — GitHub App auth (short-lived installation tokens)  ✅
- **What it is:** how the GitHub server proves who it is — as a **GitHub App**, not with a person's
  password or a long-lived token. It mints a short, signed "I am this app" pass (a JWT, good for a
  few minutes), trades it for an **installation token** scoped to just the repos we allow and good
  for about an hour, and quietly refreshes it before it lapses.
- **Why it matters:** it's the security backbone the whole MCP epic insists on — **no standing
  secret, least privilege, and credentials never reach the AI**. The private key stays inside the
  server process; the model only ever drives the tools, never sees a token. Short-lived +
  repo-scoped means even a leaked token is near-worthless within the hour.
- **Where it lives:** [../libs/github-mcp/src/app-auth.ts](../libs/github-mcp/src/app-auth.ts) —
  `GitHubAppTokenProvider` (caches and auto-refreshes the token, coalescing concurrent refreshes),
  `createAppJwt` (signs the app pass with Node's built-in crypto — **no extra dependency**), and
  `appTokenProviderFromEnv` (reads the App ID, private key, and installation from the environment).
  Fully unit-tested offline: a throwaway RSA key signs a real JWT we then verify, plus the caching,
  refresh-on-expiry, concurrent-refresh coalescing, and repo-scoping behaviour.
- **Still to wire (follow-up):** the live binding — a thin Octokit-backed `GitHubClient` that calls
  GitHub with these tokens, plus a runnable stdio process so the registry can launch the server — is
  deliberately a separate step. It pulls in the heavyweight Octokit dependency and is best shaped by
  the agent runtime's real needs, so it's kept out of this auth-focused change. The tools
  (HELIX-86/87/88) and this auth together are the finished GitHub-server **surface**; the concrete
  network client is the remaining go-live glue.

---

### Story: Secrets & Credential Vault  ✅ done

The vault so that **tool credentials (API keys, the GitHub App private key, …) never reach the AI**.
Three sub-tasks: a secrets manager that keeps them encrypted at rest (HELIX-90), just-in-time
injection at call time (HELIX-91), and redaction from logs/traces (HELIX-92).

#### HELIX-90 — Secrets manager integration  ✅
- **What it is:** a small **credential vault** — you hand it a secret (say a token) under a name,
  it stores it **encrypted**, and later hands it back only when explicitly asked. It uses the same
  "envelope" scheme the big cloud key services use: every secret is locked with its own throwaway
  key, and that throwaway key is itself locked by one **master key** that never gets stored next to
  the data. Secrets also come back wrapped in a **redaction-safe holder** that prints `[REDACTED]`
  if it ever lands in a log or `JSON.stringify`, so it can't leak by accident.
- **Why it matters:** it's the foundation of the epic's promise — *secrets are encrypted at rest and
  never reach the model*. Tools that need a credential will pull it from here at the last moment;
  the AI only ever drives the tool, it never sees the key.
- **Where it lives:** the new [../libs/secrets](../libs/secrets) library (`@helix/secrets`) —
  [secret-store.ts](../libs/secrets/src/secret-store.ts) (`SecretsManager` interface +
  `EncryptedSecretStore` + an in-memory record repository), [kms.ts](../libs/secrets/src/kms.ts)
  (`LocalKms` envelope key manager), [secret-value.ts](../libs/secrets/src/secret-value.ts) (the
  redaction-safe `SecretValue`), and [crypto.ts](../libs/secrets/src/crypto.ts) (AES-256-GCM via
  Node's built-in crypto — **no dependency to install**). 20 offline tests cover the encryption
  round-trip, "plaintext never reaches storage", per-secret keys, wrong-key/tamper rejection,
  survive-restart, and the redaction behaviour.
- **Deferred (see [../DEFERRED.md](../DEFERRED.md)):** the real **AWS Secrets Manager / KMS**
  backend. The local store already uses AWS's envelope-encryption shape, so swapping `LocalKms` for
  AWS KMS and the in-memory repo for Secrets Manager is a drop-in with no change to callers — done
  when we deploy to AWS.

#### HELIX-91 — Just-in-time credential injection  ✅
- **What it is:** the rule that a tool server's secret (an API key, the GitHub App key) is named in
  its config only as a **reference**, and the real value is fetched from the vault **at the last
  possible moment** — when we actually open the connection to that server — and handed straight to
  where it's needed (a stdio process's environment variable, or an HTTP header). It's resolved,
  used, and gone; it's never written into the registry and never put in front of the AI.
- **Why it matters:** this is the *"injected only at call time"* half of the vault's promise. The
  registry that lists tool servers holds only pointers to secrets, the tool catalogue the model sees
  holds none, so a credential can't leak through saved config or through the arguments the AI
  produces. If a required secret is missing we **fail closed** — we don't connect a server without
  the credential it needs.
- **Where it lives:** [../libs/mcp/src/credentials.ts](../libs/mcp/src/credentials.ts)
  (`TransportCredentials` = env/header → vault refs; `resolveTransportCredentials` resolves them at
  call time) and [../libs/mcp/src/registry.ts](../libs/mcp/src/registry.ts)
  (`createCredentialInjectingConnector` resolves + injects when connecting; `injectResolvedSecrets`
  merges the plaintext into a transport config without mutating the stored, ref-only config). The
  MCP layer depends on `@helix/secrets` for types only — no runtime coupling. Covered by tests for
  the resolution, the fail-closed path, the env/header merge, and "the registry only ever stores
  references."

#### HELIX-92 — Trace/log redaction  ✅
- **What it is:** a scrubber that strips credentials out of **telemetry** — the run traces (and any
  logs) the platform emits — so even if a token gets interpolated into some string along the way, it
  never appears in a recorded trace. It works two ways: it masks **known secret values** (e.g. a
  credential just resolved for a tool call) and it recognises **common credential shapes** (PEM
  private keys, JWTs, GitHub / OpenAI / AWS tokens, `Bearer …`, `secret=…`) even when it doesn't
  hold the literal value. A `SecretValue` is always rendered as `[REDACTED]`.
- **Why it matters:** it's the third and final guarantee of the vault — *secrets redacted from
  logs/traces*. With it, completing the story means credentials are encrypted at rest (HELIX-90),
  handed over only at call time (HELIX-91), and scrubbed from everything we record (HELIX-92).
- **Where it lives:** the `Redactor` in [../libs/secrets/src/redaction.ts](../libs/secrets/src/redaction.ts)
  (`redact` for a string, `redactDeep` for a whole object/array, plus the default credential rules),
  and a `RedactingTraceSink` in
  [../libs/agent/src/lib/redacting-trace-sink.ts](../libs/agent/src/lib/redacting-trace-sink.ts)
  that wraps **any** trace sink (in-memory, OpenTelemetry, …) and deep-redacts each span's name +
  attributes at the export boundary, leaving structural fields (ids, timing, status) intact. Tested
  for the credential patterns, value-based scrubbing, no over-redaction of ordinary words, deep/cyclic
  objects, and the wrapped-sink behaviour.

---

## Epic: Planning Agent  ✅ done

The first real **agent**: it turns a plain-language request into a validated requirements spec and,
eventually, a structured implementation plan that becomes the Coding Agent's input contract.

### Story: Requirement Analysis & Clarification  ✅ done

Understand what's actually being asked: extract a structured spec (HELIX-93), spot the ambiguous
bits and ask about them (HELIX-94), and loop the answers back in (HELIX-95).

#### HELIX-93 — Requirement extraction prompt + schema  ✅
- **What it is:** the step that reads a free-text request (e.g. *"build me a URL shortener"*) and
  produces a tidy, structured **requirements specification** — a title and summary, the goals,
  concrete functional and non-functional requirements (each with a MoSCoW *must/should/could/won't*
  priority), constraints, explicit assumptions, what's out of scope, any **open questions** it
  couldn't answer from the request, and testable acceptance criteria.
- **Why it matters:** it's the front door of the whole build pipeline — everything downstream
  (clarifying questions, the implementation plan, the coding agent) keys off this spec. Two design
  choices make it dependable: the model is **forced to return the spec through a single tool call**
  (so we get structured data, not prose to scrape), and that data is **validated against the schema**
  before we trust it. The prompt also tells the model to record guesses as *assumptions* and genuine
  gaps as *openQuestions* rather than inventing details — which is exactly what HELIX-94 will act on.
- **Where it lives:** the new [../libs/planning](../libs/planning) library (`@helix/planning`) —
  [requirements.ts](../libs/planning/src/lib/requirements.ts) (the spec schema, defined once in Zod
  and reused as the TypeScript type, the runtime validator, and the tool's JSON Schema) and
  [requirement-extraction.ts](../libs/planning/src/lib/requirement-extraction.ts) (the analyst prompt
  + `extractRequirements`, which drives any `@helix/llm` provider and validates the result). 11
  offline tests cover schema validation and the extraction flow against a fake provider (forced tool,
  passthrough of tier/effort/metering, and the no-tool / malformed / empty-input error paths).

#### HELIX-94 — Ambiguity detection + question generation  ✅
- **What it is:** the step that reads the spec from HELIX-93, spots the parts that are genuinely
  unclear or could be read more than one way, and turns each into a **specific clarification
  question**. Every question comes with an **importance** (*blocking / important / optional*), a
  **confidence** score (how safe it is to just proceed on a default guess without asking), a proposed
  **default assumption**, and — where it helps — a short list of likely answer options.
- **Why it matters:** it's how the planner avoids two failure modes — silently guessing on something
  important, or pestering the user about trivia. A **confidence threshold** decides what actually
  gets asked: anything *blocking*, or below the threshold, is surfaced to the user; the rest can
  proceed on its default assumption. That triage is exactly what the clarification loop (HELIX-95)
  will drive next.
- **Where it lives:** [../libs/planning/src/lib/clarification.ts](../libs/planning/src/lib/clarification.ts)
  — `generateClarifications` (forced-tool, schema-validated, like extraction), `triageByConfidence`
  (the threshold gate splitting *ask* vs *auto-resolve*), `hasBlockingQuestions`, and a deterministic
  `openQuestionsToClarifications` baseline that structures the spec's free-text open questions without
  an LLM. 11 more offline tests cover the schema (importance + 0–1 confidence), the generation flow
  (forced tool, spec/request embedded, empty-list + error paths), and the confidence triage.

#### HELIX-95 — Clarification loop integration  ✅
- **What it is:** the loop that ties the previous two steps together and **pauses for the user**.
  Each round it generates clarification questions, keeps only the ones worth asking (blocking or
  below the confidence threshold), hands those to whoever is driving the conversation, waits for the
  answers, then revises the spec to fold them in — repeating until nothing important is left to ask
  (or a safety cap of rounds is reached).
- **Why it matters:** it turns the planner from a one-shot guess into an actual back-and-forth that
  converges on a spec everyone agrees on. Crucially, **how** the user is asked is left to the caller
  via an injected responder (`ClarificationResponder`) — a CLI prompt, an approval UI, or a test
  stub — so the loop has no opinion about the UI and stays fully testable offline. The whole
  Requirement Analysis pipeline now has a single entry point, `extractAndClarify(request, …)`.
- **Where it lives:** [../libs/planning/src/lib/clarification-loop.ts](../libs/planning/src/lib/clarification-loop.ts)
  — `clarifyRequirements` (the round loop), `refineRequirements` (re-emits a validated spec that
  incorporates the answers + any auto-applied assumptions, reusing the HELIX-93 schema/tool), and
  `extractAndClarify` (extract → clarify in one call). 5 more offline tests, driven by a scripted
  fake provider + a stub responder: ask→refine→stop-when-clear, no-questions short-circuit, the
  round cap, the user-declines path, and the full extract-then-clarify flow with aggregated usage.

### Story: Implementation Plan Generation  ✅ done

Turn the agreed spec into a concrete plan: break it into tasks (HELIX-96), order them by dependency
and check the graph (HELIX-97), and pick the tech stack / scaffold (HELIX-98).

#### HELIX-96 — Task decomposition prompt + schema  ✅
- **What it is:** the step that takes the finished requirements spec and breaks it into a list of
  concrete **engineering tasks** — the nodes of the implementation plan. Each task has a stable id, a
  title and description, a category (backend / data / testing / …), the **requirement ids it
  implements** (so every requirement is traceable to work), and the **ids of tasks that must come
  first** (`dependsOn` — the edges of the task graph).
- **Why it matters:** it's the bridge from *what* to build (the spec) to *how* to build it in
  reviewable pieces. Declaring dependencies as `dependsOn` rather than relying on list order is what
  lets the next step (HELIX-97) assemble and validate a real dependency graph, and ultimately makes
  the plan the Coding Agent's input contract.
- **Where it lives:** [../libs/planning/src/lib/task-plan.ts](../libs/planning/src/lib/task-plan.ts)
  (the `TaskPlan` / `ImplementationTask` schema — Zod as the single source of truth for the type, the
  validator, and the tool's JSON Schema — plus `taskIds`) and
  [../libs/planning/src/lib/task-decomposition.ts](../libs/planning/src/lib/task-decomposition.ts)
  (the tech-lead prompt + `decomposeTasks`, forced-tool + schema-validated like the earlier steps). 9
  more offline tests cover schema validation and the decomposition flow against a fake provider.

#### HELIX-97 — Dependency ordering + validation  ✅
- **What it is:** the step that takes the tasks from HELIX-96 (each saying which other tasks it
  `dependsOn`) and turns those links into a usable plan. It **checks the graph** — no two tasks share
  an id, no task points at a task that doesn't exist, nothing depends on itself, and there are **no
  cycles** (A → B → A) — then computes a safe **order** (every task after the things it needs) grouped
  into **waves**: each wave is a batch of tasks whose prerequisites are all done, so they can run in
  parallel.
- **Why it matters:** the decomposition gives raw tasks; this is what makes them *executable in the
  right order*. The waves map cleanly onto the workflow engine's parallel steps, and the validation
  catches an LLM that produced an impossible plan (a cycle or a dangling reference) before any code
  is written. It's pure, deterministic graph code — no model call — so it's cheap and exhaustively
  testable.
- **Where it lives:** [../libs/planning/src/lib/task-graph.ts](../libs/planning/src/lib/task-graph.ts)
  — `validateTaskGraph` (duplicate ids / unknown + self dependencies), `findCycles` (DFS cycle
  detection, deduped), and `orderTaskGraph` (validate → topological order + parallel waves, throwing
  `TaskGraphError` with the issues on a bad graph). 11 more offline tests cover validation, cycle
  detection (2-node, longer, deduped), the wave/topo ordering, independent-task batching, and every
  error path.

#### HELIX-98 — Tech-stack / scaffold selection  ✅
- **What it is:** the step that decides *what to build it with* — the language and runtime, the
  framework, database, testing tool and package manager, the key dependencies to install, and a
  minimal starting **project scaffold** (the first directories and files). It reads the agreed spec
  (and optionally the task list) and makes those choices, grounded in the spec's **constraints** — so
  "must run on the existing Postgres" actually forces Postgres, rather than a preference winning.
- **Why it matters:** it's the final piece that makes the plan something you can *start building*
  from: with the spec, the ordered task graph, and now a concrete stack + scaffold, the plan is the
  full input contract the Coding Agent will work against. The prompt is told constraints always beat
  preferences and to prefer mainstream, well-supported choices over cleverness.
- **Where it lives:** [../libs/planning/src/lib/tech-stack.ts](../libs/planning/src/lib/tech-stack.ts)
  — the `TechStackSelection` schema (language, runtime, a list of area→choice decisions, dependencies,
  a scaffold of dir/file entries, setup commands, notes — Zod as the single source of truth) plus
  `selectTechStack` (the architect prompt, forced-tool + schema-validated like every other step). 8
  more offline tests cover schema validation and the selection flow against a fake provider (spec +
  task-plan grounding, and the error paths).

### Story: Plan Grounding (basic)  ✅ done

#### HELIX-99 — Codebase context retrieval  ✅
- **What it is:** the step that pulls **relevant bits of the existing codebase** into the planner, so
  it plans against what's actually there (conventions, similar modules, the files it'll touch) rather
  than from a blank page. It builds a few search queries out of the spec — the title/summary, the
  functional requirements, the goals — runs them against a code search index, then merges the results,
  removes duplicates (keeping the best-scoring hit per file), ranks them, and trims to a handful.
- **Why it matters:** grounding is what stops the agent from reinventing things that already exist or
  fighting the repo's conventions — the retrieved snippets get dropped into the planning prompts so the
  spec, tasks, and stack choices reflect the real code. *How* the code is searched is left to an
  injected `CodebaseRetriever` seam (the host wires it to `@helix/agent`'s hybrid retriever over an
  embedded repo in a few lines), so the planner stays dependency-free and fully testable offline.
- **Where it lives:** [../libs/planning/src/lib/plan-grounding.ts](../libs/planning/src/lib/plan-grounding.ts)
  — `buildGroundingQueries` (spec → queries), `groundRequirements` (retrieve → dedupe by file → rank →
  cap), and `formatGrounding` (render a prompt-ready `<codebase_context>` block). 7 offline tests cover
  query derivation, the dedupe/rank/cap and per-/max-query limits, the empty case, and formatting.

---

## Epic: Coding Agent  ✅ done

The agent that takes the plan and actually writes code: edit multiple files in an **isolated
sandbox**, build and lint, and self-correct on the feedback until it compiles cleanly — then commit
to a branch.

### Story: Isolated Workspace / Sandbox  🛠️ in progress

Give the coding agent a throwaway, isolated place to work: provision it (HELIX-100), check out the
repo into it (HELIX-101), and fence it in with egress controls + resource limits (HELIX-102).

#### HELIX-100 — Ephemeral sandbox provisioning  ✅
- **What it is:** the bit that hands the coding agent a fresh, **throwaway workspace** to work in and
  cleans it up afterwards. Ask the provider for a sandbox → you get one with a unique id and its own
  directory; when you're done, dispose it and the whole thing is deleted. It also includes a small
  **safety rail**: a `resolve()` that turns a workspace-relative path into a real one but **refuses
  paths that try to escape** the sandbox (`../…` or absolute paths), so edits can't wander outside.
- **Why it matters:** every later coding step — checkout, file edits, build/lint, tests — happens
  *inside* one of these, so nothing the agent does touches the real machine or another run. Disposing
  on completion keeps things clean and ephemeral.
- **Where it lives:** the new [../libs/sandbox](../libs/sandbox) library (`@helix/sandbox`) —
  [sandbox.ts](../libs/sandbox/src/sandbox.ts) (the `SandboxProvider` / `Sandbox` seam + the
  path-escape `SandboxPathError`) and
  [local-sandbox.ts](../libs/sandbox/src/local-sandbox.ts) (`LocalSandboxProvider`, which provisions
  each sandbox as a temp directory, tracks the active set, and disposes by removing it). 6 offline
  tests cover provisioning, unique ids/dirs + tracking, the path-escape guard, writing within the
  workspace, idempotent dispose, and `disposeAll`.
- **Deferred (see [../DEFERRED.md](../DEFERRED.md)):** the real **container / microVM** backend
  (Firecracker / Fargate — the L-sized, high-risk infra spike the ticket flags). The local provider
  gives a real, testable ephemeral *filesystem* workspace today; OS-level process/network/resource
  isolation drops in behind the same seam, with the limits defined by HELIX-102.

#### HELIX-101 — Repo checkout + workspace mount  ✅
- **What it is:** the step that puts the **target repo into the sandbox** so the agent has code to
  work on. Point it at a repo + branch and it writes every file into the workspace (creating folders
  as needed), either at the root or under a chosen subfolder. *Where* the files come from is pluggable
  — the real version will `git clone` the branch (or read it via the GitHub tools) — while the
  *mounting* (writing the files in) is what this step owns.
- **Why it matters:** the coding agent edits real files; this is how they get there. And it reuses the
  sandbox's **path-escape guard** on every write, so a repo that contains a sneaky path (`../…`) can't
  trick the checkout into writing outside the sandbox — it's rejected before anything lands.
- **Where it lives:** [../libs/sandbox/src/repo-checkout.ts](../libs/sandbox/src/repo-checkout.ts) —
  `checkoutRepo` (fetch → write each file through `sandbox.resolve`, returning what was mounted), the
  `RepoFetcher` seam (the swappable "where the files come from"), and `InMemoryRepoFetcher` for tests
  and composition. 5 offline tests cover materializing files (incl. nested dirs), the `mountDir`
  subdir option, the escape-path rejection (nothing written outside), and ref pass-through.
- **Deferred:** the real `RepoFetcher` — a `git clone --depth 1` (needs the git binary + network/egress,
  which HELIX-102 governs) or a GitHub-tools-backed reader (needs the deferred Octokit client). The
  mount logic + seam are done; wiring a concrete fetcher is the remaining integration.

#### HELIX-102 — Egress controls + resource limits  ✅
- **What it is:** the sandbox's **safety fence** — a definition of what the workspace is allowed to
  do. Two parts: a **network allowlist** (which hosts it may reach — default **deny everything**
  except a small list like the npm registry and GitHub) and **resource caps** (CPU, memory, disk,
  a wall-clock time limit, and a max process count). It also includes the bits that can actually be
  enforced in-process right now: an egress *decision* (is this host allowed?) and a wall-clock timer
  that trips an operation that runs too long.
- **Why it matters:** the coding agent runs code it wrote itself, so the workspace must be fenced in —
  it shouldn't phone home anywhere it likes or chew up the machine. The egress rules use the same
  **`deny > allow > default`, default-deny** precedence as the MCP tool policy, so nothing is reachable
  unless explicitly permitted. The OS-level enforcement of CPU/mem/disk is applied by the real
  container backend; this defines the knobs it uses, and what *can* be enforced without it is.
- **Where it lives:** [../libs/sandbox/src/policy.ts](../libs/sandbox/src/policy.ts) — `SandboxPolicy`
  / `ResourceLimits` / `EgressPolicy` with secure defaults, `resolveSandboxPolicy` (merge a partial
  over the defaults + validate), `evaluateEgress` / `isHostAllowed` (host allow/deny with `*.suffix`
  wildcards, default-deny), and `enforceWallClock` (cap an in-process operation, `SandboxTimeoutError`
  on overrun). 11 offline tests cover defaults/merge/validation, the egress precedence + wildcard +
  case rules, and the wall-clock pass/timeout paths. Closes the Isolated Workspace story.

### Story: Code Generation & Multi-File Editing  ✅ done

The agent's hands: the tools to change files (HELIX-103), scaffold from templates (HELIX-104), and
group the changes into commits (HELIX-105).

#### HELIX-103 — File edit tools (read/write/patch)  ✅
- **What it is:** the three basic tools the coding agent uses to change code, all working **inside the
  sandbox**: **read** a file, **write** (create or overwrite) a file, and **patch** a file (replace an
  exact snippet with new text). Patch is deliberately strict — if the snippet isn't there, or appears
  more than once and you didn't say "replace all", it refuses and says why, so the agent fixes a bad
  edit instead of silently corrupting a file.
- **Why it matters:** these are the actual hands of the agent. Every edit goes through the sandbox's
  path guard, so the agent can't touch anything outside its workspace, and the tools hand back plain
  error messages (file missing, snippet not found, path escape, bad arguments) as **tool errors** —
  exactly the feedback the self-correction loop (HELIX-31) will read and retry against.
- **Where it lives:** the new [../libs/coding-agent](../libs/coding-agent) library
  (`@helix/coding-agent`) — [file-edits.ts](../libs/coding-agent/src/lib/file-edits.ts) (the
  `readFile` / `writeFile` / `patchFile` operations + `FileNotFoundError` /
  `PatchNotApplicableError`) and
  [file-edit-tools.ts](../libs/coding-agent/src/lib/file-edit-tools.ts) (`FILE_EDIT_TOOLS` LLM tool
  defs with Zod-derived schemas, and `createFileEditToolHandler(sandbox)` which validates input, runs
  the op, and returns results — failures as `isError`). Depends on `@helix/sandbox` for the `Sandbox`
  type only. 15 offline tests run the ops against a real local sandbox (write/read/overwrite, missing
  file, escape rejection, all the patch cases) and the tool dispatcher (round-trip + every error path).

#### HELIX-104 — Scaffolding / templates (NestJS CRUD exemplar)  ✅
- **What it is:** a way to drop a batch of **starter files** into the workspace from a template, so the
  agent isn't typing boilerplate from scratch. The worked example is a **NestJS CRUD resource**: give it
  a name like `note` and it produces the module, controller (with the `notes` routes), service (an
  in-memory store with create/findAll/findOne/update/remove), and the create/update DTOs — with the
  class names, file names, and route correctly cased and pluralised (`note-item` → `NoteItem`,
  `note-items`, …).
- **Why it matters:** it turns the planner's tech-stack/scaffold choice (HELIX-98) into actual files.
  Writing is **conflict-safe** — it checks all target paths first and refuses to overwrite existing
  files unless told to, so scaffolding can never silently clobber work the agent already did. And it's
  a pure, deterministic generator (no LLM), so it's fast and exhaustively testable.
- **Where it lives:** [../libs/coding-agent/src/lib/scaffold.ts](../libs/coding-agent/src/lib/scaffold.ts)
  (`resourceNames` casing/pluralisation, `applyScaffold` — write a file set into the sandbox with the
  up-front conflict check + `ScaffoldConflictError`) and
  [../libs/coding-agent/src/lib/templates/nest-crud.ts](../libs/coding-agent/src/lib/templates/nest-crud.ts)
  (`nestCrudResource(name)` → the five files). 12 more offline tests cover the name forms (incl. `-y` /
  sibilant plurals), conflict-safe + overwrite applies, and the generated NestJS code (class names,
  route, DI, `PartialType` DTO), including writing a full resource into a real sandbox.

#### HELIX-105 — Diff generation + commit grouping  ✅
- **What it is:** the part that figures out **what the agent changed** and splits it into sensible
  commits. Snapshot the workspace after checkout, let the agent edit, snapshot again — and it reports
  the **added / modified / deleted** files with a line-level diff and add/delete counts. Then it
  **groups** those changes into logical commits: by default everything under a module folder (e.g.
  `src/note/`) commits together and top-level files go in `(root)`, but the grouping key is pluggable,
  so changes can be grouped **per task** instead.
- **Why it matters:** an agent that edits a dozen files shouldn't dump them into one giant unreviewable
  commit. Grouping gives clean, logical commits (the input the Commit & Branch story, HELIX-32, turns
  into real commits with generated messages), and the diff is what review/approval reads. It's pure and
  deterministic — no `git` needed (the actual commit is the deferred git binding) — so it's fully
  offline-testable.
- **Where it lives:** [../libs/coding-agent/src/lib/diff.ts](../libs/coding-agent/src/lib/diff.ts)
  (`listWorkspaceFiles` — recursive, skips node_modules/.git/…; `snapshotWorkspace`; `diffSnapshots` →
  `FileChange[]`; `lineDiff` — an LCS line diff with counts) and
  [../libs/coding-agent/src/lib/commit-grouping.ts](../libs/coding-agent/src/lib/commit-grouping.ts)
  (`groupChanges` + `defaultGroupKey`, returning `CommitGroup`s with per-group add/delete totals). 9
  more offline tests cover the line diff (add/modify/delete, from-empty), snapshot/diff classification
  against a real sandbox, ignored-dir skipping, and grouping by dir + by a custom per-task key.

### Story: Build, Lint & Self-Correction Loop  ✅ done

Make the agent's code actually compile + lint, and fix itself when it doesn't: run the checks
(HELIX-106), feed failures back as fix instructions (HELIX-107), and cap the retries (HELIX-108).

#### HELIX-106 — Build/lint runner in sandbox  ✅
- **What it is:** the ability to **run commands** (the build, the linter) inside the workspace and
  capture how they went — exit code, stdout, stderr, whether they timed out. On top of that, a small
  runner that executes a list of **language-aware checks** (e.g. `pnpm build`, `pnpm lint`) in order and
  reports a single pass/fail plus each check's output.
- **Why it matters:** this is the gate that tells the agent whether its code is actually good. Capturing
  the real compiler/linter output (not just "it failed") is what the next step (HELIX-107) feeds back so
  the agent can fix the specific errors — the self-correction loop. Commands run as **real child
  processes** rooted at the sandbox (cwd through the path guard) and are **killed if they overrun** a
  wall-clock timeout, so a hanging build can't wedge a run.
- **Where it lives:** the command primitive is in
  [../libs/sandbox/src/command-runner.ts](../libs/sandbox/src/command-runner.ts) (`CommandRunner` seam +
  `LocalCommandRunner`, which spawns via `child_process`, captures output, and SIGKILLs on timeout); the
  build/lint orchestration is in [../libs/coding-agent/src/lib/checks.ts](../libs/coding-agent/src/lib/checks.ts)
  (`runChecks` → `ChecksOutcome`, with `stopOnFailure`, plus `nodeChecks` language-aware presets). 12
  more offline tests: the runner against **real subprocesses** (stdout/exit, stderr/non-zero, cwd =
  workspace, timeout kill, unknown command, cwd escape) and the checks aggregation (pass/fail,
  stop-on-failure, timed-out = failure) with a fake runner. *(The real container-exec backend is
  deferred; the local spawn is genuine.)*

#### HELIX-107 — Error feedback to fix loop  ✅
- **What it is:** the step that takes the raw build/lint output from HELIX-106 and turns it into a
  **clear list of what to fix**. It reads the compiler/linter text, pulls out each problem (file, line,
  column, the message, the error code or lint rule), and writes a tidy re-prompt — "these checks
  failed, here are the exact errors, fix them" — that the agent reads before trying again. If it can't
  recognise the format, it falls back to including the raw output so nothing is lost, and it **caps**
  how much it includes so a thousand errors can't blow up the prompt.
- **Why it matters:** this is the feedback half of the self-correction loop — the difference between
  telling the agent "the build failed" (useless) and "line 12 of note.service.ts can't find name
  'foo'" (fixable). HELIX-108 wraps this parse → re-prompt → re-run cycle in an iteration budget.
- **Where it lives:** [../libs/coding-agent/src/lib/feedback.ts](../libs/coding-agent/src/lib/feedback.ts)
  — `parseTypeScriptDiagnostics` and `parseEslintDiagnostics` (recognise `tsc` + ESLint stylish output
  into structured `Diagnostic`s) and `buildFixFeedback` (per failed check → diagnostics or a truncated
  raw fallback, plus a bounded re-prompt; `ok` short-circuits when the checks passed). 7 more offline
  tests cover both parsers, the pass/parse/raw-fallback/timed-out cases, and the diagnostic cap.

#### HELIX-108 — Iteration budget + bail-out  ✅
- **What it is:** the **loop** that finally ties the editing tools, the checks, and the error feedback
  together: run the checks → if they pass, done → if they fail, build the fix feedback, let the agent
  apply a fix, and run again. It does this at most a fixed number of times (the **iteration budget**),
  and if the code still doesn't pass after the last try it **stops and flags it for a human** instead
  of pushing broken code.
- **Why it matters:** this is the self-correction that backs the Coding Agent's promise of *compiling,
  lint-passing* changes — and the budget is the safety valve so a stubborn error can't loop forever
  or burn unlimited tokens. The "apply a fix" step is an injected callback, so the actual LLM editing
  lives in the caller and the whole loop is deterministic and offline-testable. The result says
  exactly what happened: passed vs exhausted, how many runs and fix attempts, the final check output,
  and (on exhaustion) the unresolved feedback to hand to the human.
- **Where it lives:** [../libs/coding-agent/src/lib/self-correct.ts](../libs/coding-agent/src/lib/self-correct.ts)
  — `selfCorrect(runner, { checks, applyFix, maxIterations, … })` → `SelfCorrectResult` (`status`
  passed/exhausted, `escalate`, `iterations`, `fixAttempts`, `finalOutcome`, `finalFeedback`,
  `history`). It deliberately doesn't attempt a fix on the last allowed run (nothing left to verify
  it). 4 more offline tests: pass-first (no fix), fix-then-pass, exhaust + escalate (with the right
  fix-attempt count), and `maxIterations: 1`. Closes the Build, Lint & Self-Correction Loop story.

### Story: Commit & Branch Management  ✅ done

Land the work tidily: a branch named by convention (HELIX-109) and a good commit message per group
(HELIX-110).

#### HELIX-109 — Branch creation + naming convention  ✅
- **What it is:** how the agent names and creates the branch it works on. The convention is
  **`helix/<run-id>/<slug>`** — the word `helix`, the run's id, and a tidy slug of what the work is —
  so each run gets a predictable, collision-free branch. It cleans the description into a valid slug
  (lowercase, dashes, trimmed, length-capped) and guarantees the whole name passes git's branch-name
  rules; then it actually runs `git checkout -b` in the workspace.
- **Why it matters:** consistent branch names make runs easy to find and avoid clashes, and validating
  the name up front means a weird task title can't produce a branch git would reject. Creation goes
  through the same command runner as everything else (real `git`, killed on timeout), so it's genuine
  and offline-testable against a throwaway repo.
- **Where it lives:** [../libs/coding-agent/src/lib/branching.ts](../libs/coding-agent/src/lib/branching.ts)
  — `slugify`, `branchName` (`helix/<run-id>/<slug>`, sanitised, with a `work` fallback for an empty
  slug), `isValidGitBranchName` (the relevant `git check-ref-format` rules), and `createGitBranch`
  (validates then `git checkout -b` via the runner; returns an error result without touching git for a
  bad name). 18 more offline tests: slug/name building + sanitisation, a table of invalid-name cases,
  the no-git invalid path, and creating + switching to a branch in a **real `git init`-ed sandbox**.

#### HELIX-110 — Commit message generation  ✅
- **What it is:** turning each group of changes (from HELIX-105) into a **Conventional Commits**
  message — `type(scope): subject` plus a short body listing the files. It works two ways: a
  deterministic builder that infers the type (feat / test / docs / chore …) and scope straight from
  the changed paths, and an **LLM** version that writes a nicer subject/body — and the LLM version
  **falls back to the deterministic one** on any hiccup, so a commit message is always produced.
- **Why it matters:** tidy, conventional commit messages make the agent's branches reviewable and the
  history readable, and the always-on fallback means message generation can never block a commit (or
  cost a retry) even if the model is unavailable. With this, the Coding Agent can name a branch, group
  its diffs into logical commits, and write each commit's message — the end of the editing pipeline.
- **Where it lives:** [../libs/coding-agent/src/lib/commit-message.ts](../libs/coding-agent/src/lib/commit-message.ts)
  — `buildCommitMessage` (deterministic; `inferType` from paths, scope from the group key, a per-file
  body) and `generateCommitMessage` (forced, schema-validated `emit_commit_message` tool, falling back
  to the builder on no-tool / invalid output / a thrown provider). 7 more offline tests: the
  deterministic type/scope/subject/body (incl. test/docs/chore inference + root scope), and the LLM
  path with all three fallback routes. Closes the Commit & Branch Management story.

---

## Epic: Code Review Agent  ✅ done

The agent that reviews the Coding Agent's changes — for correctness, security, style, and whether
they match the plan — and posts findings + gates the merge.

### Story: Diff-Aware Review Engine  ✅ done

Look at the right things: assemble the diff + surrounding code (HELIX-111), run multi-aspect review
prompts (HELIX-112), into a structured findings + severity model (HELIX-113).

#### HELIX-111 — Diff fetch + context assembly  ✅
- **What it is:** the step that gathers everything a reviewer needs to look at — the **changed bits
  (the diff) plus the surrounding code** — into one tidy bundle. Hand it the list of changed files;
  it summarises them (how many, lines added/removed), optionally pulls in each file's full current
  contents for context, and carries along the requirements/plan so the review can check the work
  actually matches what was asked. It also formats all of that into a single block ready to drop into
  a review prompt.
- **Why it matters:** good review needs context — a diff alone often isn't enough to judge correctness.
  Pulling the full file around each change (and the spec) is what lets the later steps catch real
  problems, not just surface nits. *How* files are read is an injected seam (sandbox or git), so the
  assembly is pure and offline-testable, and big files are skipped to keep the prompt bounded.
- **Where it lives:** the new [../libs/review-agent](../libs/review-agent) library
  (`@helix/review-agent`) — [review-context.ts](../libs/review-agent/src/lib/review-context.ts):
  `assembleReviewContext` (diff → `ReviewContext` with summary, optional per-file content via the
  `FileContentReader` seam, and the spec), and `formatReviewContext` (render it as a bounded
  prompt block). 5 offline tests cover the summary/spec, content attachment (and skipping deleted /
  oversized files), and the rendered block + truncation.

#### HELIX-112 — Multi-aspect review prompts  ✅
- **What it is:** the actual reviewing — but split into **focused passes**, one per concern:
  correctness, security, style, performance, and whether the change matches the plan
  (plan-conformance). Each pass has its own "what to look for" guidance and reviews the assembled
  context (from HELIX-111) on its own, so a security review isn't distracted by style and vice versa.
- **Why it matters:** one giant "review this" prompt tends to skim; separate, narrowly-scoped passes
  catch more and produce cleaner, attributable feedback (this finding came from the *security* pass).
  Each pass is told to report only real, actionable issues — and to cite the file + lines — so the
  output is useful rather than nit-picky. This produces the model's review text per aspect; turning it
  into structured findings with severity is HELIX-113.
- **Where it lives:** [../libs/review-agent/src/lib/review-prompts.ts](../libs/review-agent/src/lib/review-prompts.ts)
  — `REVIEW_ASPECTS` + `ASPECT_GUIDANCE`, `buildAspectSystemPrompt`, and `reviewAspect` /
  `reviewAspects` (run one or all aspects through the injected `@helix/llm` provider, returning the
  text review + usage per aspect). 4 more offline tests against a fake provider: the per-aspect prompt,
  the formatted context (incl. the spec) embedded, running all aspects by default, and a requested
  subset.

#### HELIX-113 — Findings schema + severity model  ✅
- **What it is:** the step that turns the review into **structured, machine-readable findings**. Each
  aspect pass is re-run so the model returns a list of issues — each with a **severity**
  (blocker / major / minor / info), the file (and line when known), what's wrong, and an optional fix
  — validated against a fixed schema. On top of that a small **severity model** counts the findings
  (by severity and aspect, plus the highest present) and answers the one question the merge gate cares
  about: does anything here **block**?
- **Why it matters:** prose review is for humans; the rest of the pipeline needs data. Structured
  findings are what get posted as inline PR comments (HELIX-35) and what the merge gate keys off —
  `isBlocking` (anything at/above a threshold severity) is literally the "block or approve" decision.
  The aspect is stamped on by us (each pass is focused), so the model only lists issues, and the whole
  thing is validated before we trust it.
- **Where it lives:** [../libs/review-agent/src/lib/findings.ts](../libs/review-agent/src/lib/findings.ts)
  — the `Finding` schema + `REVIEW_SEVERITIES` (Zod as the single source of truth for the type, the
  validator `parseFindings`, and the `emit_findings` tool's JSON Schema); `reviewForFindings` /
  `reviewAllFindings` (run the aspect prompts as a **forced findings tool** and merge); and the
  severity model — `summarizeFindings` (counts + highest) and `isBlocking` (the merge-gate signal). 8
  more offline tests: validation (+ aspect stamping, empty, invalid), the forced-tool run + no-tool
  error, the multi-aspect merge, and the summary/blocking logic. Closes the Diff-Aware Review Engine
  story.

### Story: Secret Scan (basic security)  ✅ done

#### HELIX-114 — Secret scan integration  ✅
- **What it is:** a fast, **gitleaks-style** scan of the change for **committed secrets** — it looks at
  the *added* lines of the diff for the tell-tale shapes of credentials (PEM private keys, JWTs, GitHub
  / OpenAI / AWS tokens, hard-coded `password=…`) and turns any hit into a **blocker** finding. It only
  looks at added lines, so a pre-existing secret isn't blamed on this change, and it **never echoes the
  secret value** in the finding it reports.
- **Why it matters:** the model-based security review (HELIX-112) is good but not guaranteed; a
  deterministic regex scan is a cheap, reliable backstop for the one thing you absolutely must not
  merge — a key checked into the repo. Each hit is a blocker, which (via `isBlocking`) fails the merge
  gate, with a suggestion to load the value from the secrets vault instead.
- **Where it lives:** [../libs/review-agent/src/lib/secret-scan.ts](../libs/review-agent/src/lib/secret-scan.ts)
  — `SECRET_PATTERNS` (the credential shapes, mirroring what `@helix/secrets` redacts) and
  `scanDiffForSecrets` (added-line scan → `Finding[]`). Pure + deterministic, no LLM. 5 offline tests:
  the common shapes flagged as security blockers, never echoing the value, ignoring secrets on
  context/removed lines and in deleted files, and one finding per offending line. Closes the Secret
  Scan story.

### Story: Review Posting & Merge Gate  ✅ done

Tell the human what was found and gate the merge: post inline + summary comments (HELIX-115) and
turn the verdict into a status check / merge gate (HELIX-116).

#### HELIX-115 — Inline + summary comment posting  ✅
- **What it is:** turning the findings into the comments a reviewer leaves on a PR — an **inline
  comment** pinned to the exact file + line for each located finding, and a single **summary comment**
  with the verdict (approve / changes requested), the counts by severity, and a list of everything
  found. It also picks the review *event* — approve when clean, request-changes when something blocks,
  plain comment otherwise.
- **Why it matters:** this is how the review becomes visible and actionable on the PR rather than a
  blob of JSON. The verdict it picks is the same block/approve decision the merge gate (HELIX-116)
  enforces. *Posting* itself goes through an injected seam — the live version posts via the GitHub
  tools (`@helix/github-mcp`), which is the deferred Octokit binding — so the formatting is pure and
  fully offline-testable.
- **Where it lives:** [../libs/review-agent/src/lib/review-comments.ts](../libs/review-agent/src/lib/review-comments.ts)
  — `buildInlineComments` (located findings → file/line/body), `buildReviewSummary` (the markdown
  verdict + counts + list), `buildReviewPosting` (assemble inline + summary + the `APPROVE` /
  `COMMENT` / `REQUEST_CHANGES` event), and `postReview` over a `ReviewPoster` seam. 6 offline tests:
  inline only for located findings, the three verdicts + counts + list, the event choice, and posting
  via a fake poster.

#### HELIX-116 — Status check / merge gate  ✅
- **What it is:** the final yes/no — it takes all the findings and decides whether the change is
  allowed to merge, by a simple **policy**: anything at or above a chosen **severity threshold** (by
  default `major`, which also catches the secret-scan blockers) **fails** the gate; otherwise it
  **passes**. The decision becomes a **status check** (pass/fail + a short reason) that a branch
  protection rule can require.
- **Why it matters:** this is the *"blocks or approves per policy"* part of the agent — the thing that
  actually stops broken or insecure code from merging, with a knob (the threshold) to make the gate as
  strict or lenient as a team wants. It's pure and deterministic; publishing the status check to the
  PR is an injected seam (live: the GitHub tools / deferred Octokit binding).
- **Where it lives:** [../libs/review-agent/src/lib/merge-gate.ts](../libs/review-agent/src/lib/merge-gate.ts)
  — `ReviewPolicy` + `DEFAULT_REVIEW_POLICY`, `evaluateMergeGate` (findings + policy →
  `MergeGateDecision`: pass/fail, the blocking findings, and a reason), and `toStatusCheck` /
  `publishMergeGate` (the status-check payload + the `StatusCheckPublisher` seam). 7 offline tests:
  pass-on-empty, fail at/above threshold, pass below it, a stricter policy, the default policy, the
  status-check mapping + truncation, and publishing via a fake. Closes the Review Posting & Merge Gate
  story and the Code Review Agent epic (HELIX-6).

---

## Epic: Testing Agent  ✅ done

The agent that makes sure the code actually works: generate tests for the change, run them in the
sandbox, report results + coverage, and loop failures back to the Coding Agent.

### Story: Test Generation  ✅ done

Write the tests: per-framework generation prompts (HELIX-117) and a mapping from the spec's
acceptance criteria to tests (HELIX-118).

#### HELIX-117 — Test generation prompts per framework  ✅
- **What it is:** the bit that asks the model to **write tests** for a piece of code — but with the
  right instructions for whichever **test framework** is in use (Jest, Vitest, PyTest, Mocha), so the
  generated tests follow that framework's conventions (file naming, assertion style, how to mock). You
  hand it the source files and a framework; it returns the test files (path + contents).
- **Why it matters:** generic "write some tests" produces tests that don't fit the project; a
  framework-aware prompt produces tests that actually run. The model is told to cover the happy path
  and the important edge/error cases, keep tests deterministic, and not test third-party code — and it
  returns the files through a **forced, schema-validated tool** so we get structured output, not prose.
- **Where it lives:** the new [../libs/testing-agent](../libs/testing-agent) library
  (`@helix/testing-agent`) — [test-generation.ts](../libs/testing-agent/src/lib/test-generation.ts):
  `TEST_FRAMEWORKS` + `FRAMEWORK_CONVENTIONS`, `buildTestGenerationSystemPrompt`, and `generateTests`
  (forced `emit_tests` tool → validated `GeneratedTest[]`, via the injected `@helix/llm` provider). 6
  offline tests against a fake provider: the per-framework prompt + conventions, schema validation, and
  the generation flow (forced tool, source embedded, no-tool + malformed error paths).

#### HELIX-118 — Acceptance-criteria to test mapping  ✅
- **What it is:** generating tests that specifically **verify the spec's acceptance criteria**, with
  each test **traced back to the criterion it covers**. You give it the numbered acceptance criteria
  (from the Planning Agent's spec) + the source; it returns tests grouped by which criterion each one
  checks. A coverage check then says which criteria have tests and which were **left untested**.
- **Why it matters:** there's a difference between "tests pass" and "the thing we were asked to build
  works." Tying tests to acceptance criteria gives traceability — you can point at a criterion and see
  the test that proves it — and the coverage check is the safety net that catches a requirement nobody
  wrote a test for.
- **Where it lives:** [../libs/testing-agent/src/lib/acceptance-tests.ts](../libs/testing-agent/src/lib/acceptance-tests.ts)
  — `generateAcceptanceTests` (forced `emit_acceptance_tests` tool → tests grouped by `criterionIndex`,
  which `parseAcceptanceMapping` resolves to the criterion text and range-checks) and
  `acceptanceCoverage` (covered vs uncovered criteria + `fullyCovered`). 8 more offline tests:
  index resolution + range/empty-tests validation, the generation flow (forced tool, numbered criteria
  embedded, empty-criteria + no-tool errors), and the coverage logic. Closes the Test Generation story.

### Story: Test Execution & Reporting  ✅ done

Actually run the tests: run them in the sandbox (HELIX-119), parse the results + coverage (HELIX-120),
and package a report (HELIX-121).

#### HELIX-119 — Test runner in sandbox  ✅
- **What it is:** figuring out *which* test framework the project uses and **running its tests** in the
  workspace. It detects the framework from the project's files — the test deps in `package.json`
  (jest / vitest / mocha) or python markers (a `conftest.py`, or `pytest` in `pyproject.toml` /
  requirements) — picks the right command (`pnpm test` / `pytest` / …), runs it, and reports whether
  the tests **passed**, along with the output, exit code, and whether it timed out.
- **Why it matters:** generated tests are worthless until they actually run; this is the step that does
  it, reusing the same real **command runner** (and wall-clock kill) the build/lint checks use, so a
  hanging test suite can't wedge a run. Detecting the framework means the agent doesn't have to be told
  what the project uses.
- **Where it lives:** [../libs/testing-agent/src/lib/test-runner.ts](../libs/testing-agent/src/lib/test-runner.ts)
  — `detectFramework` (package.json deps / pytest markers), `defaultTestCommand` (per-framework
  command), and `runTests` (run via the injected `@helix/sandbox` `CommandRunner` → `TestRunResult`:
  passed + exit/stdout/stderr/timeout). 8 more offline tests against a fake runner: detection (node
  frameworks, pytest, none, malformed package.json), the default commands, and the run (pass / fail /
  timeout, default + explicit command, cwd/timeout passthrough).

#### HELIX-120 — Result + coverage parser  ✅
- **What it is:** reading the test command's raw output and turning it into **structured numbers** — how
  many tests ran, passed, failed, were skipped, which ones failed (and why, where), and the **coverage**
  percentages — **normalised** so it looks the same whether the project used Jest, Vitest, PyTest, or
  Mocha.
- **Why it matters:** the raw output is for humans; the report (HELIX-121) and the failure-feedback loop
  (HELIX-38) need data. Normalising across frameworks means the rest of the pipeline doesn't care which
  test tool ran. The run's exit code stays the source of truth for pass/fail; the parser only adds the
  detail on top — counts are pulled generically (every framework prints "N passed / M failed"), while
  failures and coverage are parsed per framework with a graceful fallback to just the counts.
- **Where it lives:** [../libs/testing-agent/src/lib/test-results.ts](../libs/testing-agent/src/lib/test-results.ts)
  — `parseTestResults` (normalized `TestResults`: total/passed/failed/skipped + `TestFailure[]`),
  `parseCoverage` (Jest summary row / pytest-cov `TOTAL`), and `parseTestRun` (combine a `TestRunResult`
  into counts + coverage). 7 more offline tests over representative Jest / PyTest / Mocha output and
  coverage samples (incl. not letting Jest's "Test Suites" line shadow the "Tests" counts).

#### HELIX-121 — Test report artifact  ✅
- **What it is:** packaging the parsed run into a **report** — a structured object (pass/fail, the
  counts, the failures, coverage, and the acceptance-criteria coverage from HELIX-118) that can be
  **stored**, plus a tidy **markdown summary** to **surface** on the PR / in the run UI.
- **Why it matters:** it's the single thing the rest of the system reads after tests run — the markdown
  goes to a human, the structured object feeds the workflow and the failure-feedback loop (HELIX-38).
  Putting acceptance coverage in the report makes the "did we actually verify the requirements" answer
  visible right next to the results.
- **Where it lives:** [../libs/testing-agent/src/lib/report.ts](../libs/testing-agent/src/lib/report.ts)
  — `buildTestReport` (a `TestRunResult` + framework + optional acceptance coverage → a structured
  `TestReport`) and `formatTestReport` (the markdown: verdict, results line, coverage, acceptance
  coverage + any uncovered criteria, the failures list, and a command/duration footer). 3 more offline
  tests: the structured report assembly, and the failed + passed markdown (with uncovered acceptance
  criteria). Closes the Test Execution & Reporting story.

### Story: Failure Feedback Loop  ✅ done

Close the loop when tests fail: package the failures into diagnostics (HELIX-122) and re-invoke the
Coding Agent under a budget to fix them (HELIX-123).

#### HELIX-122 — Failure diagnostics packaging  ✅
- **What it is:** when the tests fail, turning the report into a **fix request** for the Coding Agent —
  a tidy list of *which* tests failed (file · name · message) plus the raw **stack-trace output**, and a
  short instruction: "fix the code so these pass; they'll be re-run."
- **Why it matters:** it's the testing side's version of the build/lint fix feedback — the difference
  between "tests failed" and "here's exactly which assertions blew up and where." It's **bounded** (caps
  the number of failures listed and truncates the stack traces) so a huge failure dump can't blow the
  prompt, and it short-circuits to nothing when the tests passed. HELIX-123 feeds this back to the
  Coding Agent and re-runs.
- **Where it lives:** [../libs/testing-agent/src/lib/test-feedback.ts](../libs/testing-agent/src/lib/test-feedback.ts)
  — `buildFailureDiagnostics` (a `TestReport` + optional raw output → `FailureDiagnostics`: the failing
  tests, a `truncated` flag, and the re-prompt). Pure + deterministic. 5 offline tests: no-diagnostics
  on pass, the failing-test list + embedded stack traces + counts, graceful render without file/message,
  and the failure-cap + raw-output truncation.

#### HELIX-123 — Re-invoke coding step + budget  ✅
- **What it is:** the **loop** that closes the testing story: run the tests; if they pass, done; if they
  fail, package the diagnostics (HELIX-122) and **hand them to the Coding Agent to fix**, then run the
  tests again — at most a fixed number of times (the **budget**), and if they still fail after the last
  try, **stop and flag it for a human** rather than calling it good.
- **Why it matters:** this is what makes the generated tests actually drive a fix, not just report a
  failure — the same self-correction shape as the build/lint loop (HELIX-108), but driven by *test*
  results, and with the same budget as the safety valve so a stubborn failure can't loop forever. The
  "apply a fix" step is an injected callback, so the real Coding-Agent re-invocation lives in the caller
  and the whole loop is deterministic and offline-testable.
- **Where it lives:** [../libs/testing-agent/src/lib/test-feedback-loop.ts](../libs/testing-agent/src/lib/test-feedback-loop.ts)
  — `runTestFeedbackLoop(runner, { framework, applyFix, maxIterations, … })` → `TestFeedbackResult`
  (`status` passed/exhausted, `escalate`, `iterations`, `fixAttempts`, `finalReport`, `finalDiagnostics`,
  `history`). It runs tests via the sandbox runner, builds the report + diagnostics, and doesn't attempt
  a fix on the last run. 4 more offline tests (flippable fake runner): pass-first (no fix),
  fix-then-pass, exhaust + escalate (with the fix-attempt count + final diagnostics), and
  `maxIterations: 1`. Closes the Failure Feedback Loop story and the Testing Agent epic (HELIX-7).

---

## Epic: Deployment Agent  ✅ done

The agent that ships the reviewed, tested change: build an artifact, push it, deploy a single demo
stack to AWS, and return a live URL.

### Story: Build & Artifact Packaging  ✅ done

Make the artifact: detect how to build the app and build it (HELIX-124), then push the image to ECR
(HELIX-125).

#### HELIX-124 — Dockerfile/buildpack detection + build  ✅
- **What it is:** working out *how* to turn the project into a runnable image — if there's a
  **Dockerfile**, use it; otherwise fall back to a language **buildpack** (detecting node / python / go
  / java from the project's files) — then producing the right **build command** and running it.
- **Why it matters:** different projects build differently; auto-detecting the strategy means the
  deploy step "just works" without being told. The detection and the command it produces are pure and
  deterministic; the build *runs* through the same sandbox **command runner** the rest of the platform
  uses. The actual `docker build` / buildpack execution needs a Docker daemon, so — like the GitHub and
  AWS bindings — it's **deferred** (see [../DEFERRED.md](../DEFERRED.md)); everything up to running the
  command is real and offline-tested.
- **Where it lives:** the new [../libs/deployment-agent](../libs/deployment-agent) library
  (`@helix/deployment-agent`) — [build.ts](../libs/deployment-agent/src/lib/build.ts):
  `detectBuildStrategy` (Dockerfile vs language buildpack), `buildCommand` (`docker build …` /
  `pack build …`), and `runBuild` (run it via the `@helix/sandbox` `CommandRunner` → `BuildResult`).
  7 offline tests against a fake runner: detection (Dockerfile preference + node/go/python/java/unknown
  buildpacks), the docker + pack commands, and the build run (ok / non-zero / timeout, cwd/timeout
  passthrough).

#### HELIX-125 — Image push to ECR  ✅
- **What it is:** taking the freshly-built image and putting it in **ECR** (Amazon's container
  registry), so the deploy step has somewhere to pull it from. Given the AWS account, region and
  repository, it works out the registry address, **logs in**, **tags** the local image with that
  address, and **pushes** it.
- **Why it matters:** a built image only helps once it's somewhere the cloud can reach — pushing to ECR
  is that hand-off. The address it computes and the three commands it runs (login → tag → push) are pure
  and deterministic, and the push runs through the same sandbox **command runner** as everything else,
  stopping at the first step that fails. The live `aws ecr get-login-password` login and `docker push`
  need real AWS credentials + a Docker daemon, so — like the build itself — they're **deferred** (see
  [../DEFERRED.md](../DEFERRED.md)); everything up to running the commands is real and offline-tested.
- **Where it lives:** [ecr.ts](../libs/deployment-agent/src/lib/ecr.ts) in `@helix/deployment-agent` —
  `ecrRegistry` / `ecrImageUri` (the `<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>` address,
  defaulting the tag to `latest`, with input validation), `ecrPushCommands` (the AWS login pipe + the
  `docker tag` / `docker push` commands), and `pushImageToEcr` (run them in order via the
  `@helix/sandbox` `CommandRunner` → `PushResult`, halting on the first failure). 8 offline tests against
  a fake runner: the URI/registry computation (default + explicit tag, invalid-input rejection), the
  login → tag → push command list, and the push run (all-ok / first-step failure stops / push timeout,
  cwd/timeout passthrough).

### Story: Deploy to Target Environment (single stack)  ✅ done

Stand the image up somewhere it can actually serve traffic: generate the infrastructure-as-code for a
single demo stack and deploy it (HELIX-126), then wire its environment + secrets (HELIX-127).

#### HELIX-126 — IaC deploy (CDK) for ECS/Lambda  ✅
- **What it is:** writing out the **infrastructure-as-code** (an **AWS CDK** app) that stands the pushed
  image up as a running, reachable service — either an **ECS Fargate** service behind a load balancer, or
  a **Lambda** container function with a public URL — and then running `cdk deploy` and reading back the
  **live URL** the stack publishes.
- **Why it matters:** this is the step that turns "an image in a registry" into "a thing you can open in a
  browser." Rather than click around a cloud console, the agent generates a small, deterministic CDK
  project (so the same spec always produces the same infrastructure) and deploys it through the same
  sandbox **command runner** as everything else, recovering the URL from the deploy output. Generating the
  CDK files and the deploy command is pure and offline-tested; the actual `cdk deploy` needs the CDK CLI +
  real AWS credentials, so — like the build and the ECR push — it's **deferred** (see
  [../DEFERRED.md](../DEFERRED.md)).
- **Where it lives:** [cdk.ts](../libs/deployment-agent/src/lib/cdk.ts) in `@helix/deployment-agent` —
  `synthesizeCdkApp` (generates `cdk.json`, `bin/app.ts`, and a `lib/<app>-stack.ts` — an
  `ApplicationLoadBalancedFargateService` for ECS or a `DockerImageFunction` + Function URL for Lambda,
  fronting the ECR image and exporting a `LiveUrl` output), `cdkSynthCommand` / `cdkDeployCommand`
  (`npx cdk synth` / `npx cdk deploy --require-approval never`), `extractLiveUrl` (parse the `LiveUrl`
  output from deploy stdout), and `runCdkDeploy` (run the deploy via the `@helix/sandbox` `CommandRunner`
  → `DeployResult` with the live URL). 10 offline tests: the ECS + Lambda synthesis (constructs, image,
  ports/cpu/memory, env vars, account-vs-region env, the `LiveUrl` output), input validation, the
  synth/deploy commands, URL parsing, and the deploy run (ok + parsed URL / non-zero / timeout,
  cwd/timeout passthrough).

#### HELIX-127 — Env/config + secrets wiring  ✅
- **What it is:** giving the deployed app its **settings** — the plain, non-sensitive configuration (like
  `NODE_ENV` or a log level) and the **secrets** (like a database URL or an API key). The key rule:
  ordinary config is written straight into the stack, but secret *values* never are — instead the stack
  gets a **reference** to the secret (an AWS Secrets Manager id/ARN), and the running app fetches the value
  itself. Before deploying, it also **checks the vault** that every referenced secret actually exists.
- **Why it matters:** this is the difference between "a running container" and "a running container that can
  reach its database" — and it's where a careless step would leak credentials. By splitting config into
  *plain* vs *secret* and only ever putting **references** (never values) into the generated
  infrastructure, the secret material stays in the vault and out of the IaC, the logs, and the model — the
  same "secrets never leak" guarantee the rest of the platform holds to (it reuses the redaction-safe
  [`@helix/secrets`](../libs/secrets) vault, fetching each secret only to confirm it exists, never to read
  it). The pre-flight means a missing secret fails the deploy early with a clear list, not at runtime.
  This is the **last sub-task of the Deployment Agent epic.**
- **Where it lives:** [env-config.ts](../libs/deployment-agent/src/lib/env-config.ts) in
  `@helix/deployment-agent` — `resolveDeployEnv` (split a `DeployConfig` into a plain `environment` map +
  a `secrets` map of env var → Secrets Manager id, rejecting a var claimed by both), `secretIdFor` (the
  default `<scope>/<name>` id), `withDeployConfig` (apply a config onto a `DeploySpec`), and
  `checkDeploySecrets` (pre-flight every referenced secret against the `@helix/secrets` `SecretsManager`,
  returning the missing ones, exposing none). The CDK synthesis ([cdk.ts](../libs/deployment-agent/src/lib/cdk.ts))
  now renders those references — for ECS as a native `secrets:` map (`ecs.Secret.fromSecretsManager`), for
  Lambda as imported secrets with `grantRead` + the ARN passed in the environment — never the value. 10
  offline tests: the plain/secret split + id defaulting + conflict rejection, the ECS + Lambda reference
  rendering (no value present), and the vault pre-flight (all-present / missing list / unexpected-error
  rethrow / no-secrets no-op).

---

## Epic: Human Approval System  ✅ done

The human-in-the-loop layer: a configurable gate that decides *when* a person must sign off on an agent's
action, *who* is allowed to, and *how long* they have before it escalates. (The workflow engine already
has the durable pause/resume primitive from HELIX-2; this epic is the approval *system* on top of it.)

### Story: Approval Gate Configuration (basic)  ✅ done

The configuration side: model the gate rules + approver roles + SLAs (HELIX-128), then expose an admin
API/UI to manage them (HELIX-129).

#### HELIX-128 — Approval policy model  ✅
- **What it is:** the **rulebook** for approvals. A policy is a list of **gate rules**; each rule has a
  **condition** (does this action match? — by action type, environment like `prod`, the agent doing it,
  a risk level, an estimated dollar cost, or tags) and a **requirement** (who may approve, how many of
  them, the response **SLA** in minutes, and who to escalate to if that SLA is missed). Given a specific
  action, the model tells you whether it needs sign-off and, if so, the exact requirement.
- **Why it matters:** this is the knob that decides "should a human look at this before it happens?" —
  the difference between an agent that quietly ships to production and one that pauses for a tech lead. It's
  deliberately **data, not code**: rules are a validated document (so the next sub-task's admin API/UI can
  edit them safely), and evaluating them is pure and deterministic. When several rules match one action,
  their requirements are **folded** sensibly — the approver roles and escalation targets are unioned, the
  quorum takes the strictest (highest) value, and the SLA takes the tightest (shortest) — so overlapping
  rules can only make a gate *stronger*, never weaker.
- **Where it lives:** the new [../libs/approvals](../libs/approvals) library (`@helix/approvals`) —
  [policy.ts](../libs/approvals/src/lib/policy.ts): the zod schema + types (`ApprovalPolicy`, `GateRule`,
  `GateCondition`, `ApprovalRequirement`, `RiskLevel`), `matchesCondition` (AND of every present matcher;
  `{}` is a catch-all), `evaluatePolicy` (fold matched rules → `requiresApproval` + a `ResolvedRequirement`),
  `parseApprovalPolicy` / `safeParseApprovalPolicy` (validation for the HELIX-129 admin API, incl. a
  duplicate-rule-id check), and `defaultApprovalPolicy` (a conservative starter: gate prod deploys + any
  high/critical-risk action). 12 offline tests: condition matching (each matcher + risk bands + the
  catch-all), evaluation (no-match / multi-rule fold / quorum + SLA defaults / disabled rules), and schema
  validation (unknown keys, empty roles, bad versions, duplicate ids).

#### HELIX-129 — Policy admin API/UI  ✅
- **What it is:** the **management surface** for those approval policies — a set of REST endpoints in the
  Registry service to create, list, fetch, update, and retire policies. It reuses the HELIX-128 schema as
  the gatekeeper: a policy that doesn't validate is rejected with a clear `400` before it's ever stored.
- **Why it matters:** the policy model is only useful if someone can actually *edit the gates* without a
  code deploy — turn on a prod-deploy approval, add a reviewer role, tighten an SLA. It follows the exact
  same shape as the agent-definition admin API the registry already exposes, so it behaves predictably:
  policies are **versioned and immutable** (each edit appends a new version rather than overwriting), they
  can be **org-scoped** via the `x-org-id` header, and they're **soft-deleted** (retired, not erased) — so
  there's always history of what a gate used to be. Storage versioning is authoritative, so the stored
  document's version is normalized to the row version and can't drift.
- **Where it lives:** the new [../apps/registry/src/approval-policy](../apps/registry/src/approval-policy)
  module — `approval-policy.controller.ts` (`POST` / `GET` / `GET /latest` / `GET /:id` / `PUT /:id` /
  `DELETE /:id` under `/approval-policies`), `approval-policy.service.ts` (validates via
  `@helix/approvals` `safeParseApprovalPolicy`, then create/version/soft-delete logic), and
  `approval-policy.repository.ts` (Prisma, latest-per-policy reads). Persisted by a new `ApprovalPolicy`
  Prisma model + migration (`approval_policies`, unique on `[orgId, policyId, version]`). 22 tests: a
  controller spec (8 — routing, org header, 400/404 mapping), a service spec (9 — validation, versioning,
  conflict/not-found), and a testcontainers integration spec (5 — real-Postgres create/list/version/
  soft-delete round-trips). Closes the **Approval Gate Configuration** story.

### Story: Approval Request & Decision Flow  ✅ done

The runtime side of approvals: turn a policy requirement into a live request and drive it to a decision
(HELIX-130), expose the decide-and-resume API + workflow signal (HELIX-131), and give humans an inbox to
act on (HELIX-132).

#### HELIX-130 — Approval service + state machine  ✅
- **What it is:** the **lifecycle engine** for one approval. From a policy requirement (who must approve,
  how many, by when) it opens a **pending** request, then records each approver's vote and moves the
  request to its outcome: **approved** once enough distinct people have signed off, **rejected** the
  moment anyone says no, **expired** if the SLA window passes, or **cancelled** if the work is abandoned.
- **Why it matters:** this is the part that has to be *correct under messy reality* — two people clicking
  approve at once, the same person voting twice, a late vote arriving after the deadline, someone trying to
  approve who isn't allowed to. Modelling it as a strict, **pure state machine** (every operation returns a
  new request and illegal moves throw rather than silently corrupt) means the storage + API layer on top
  (HELIX-131) can't accidentally drive an approval into a nonsensical state. Decisions are de-duplicated by
  person (so the quorum counts distinct approvers), a single rejection is fail-fast, and the SLA is honored
  consistently whether the request is read or written.
- **Where it lives:** [request.ts](../libs/approvals/src/lib/request.ts) in `@helix/approvals` —
  `createApprovalRequest` (from a `ResolvedRequirement` → a pending request with a computed `expiresAt`),
  `submitDecision` (record a vote; resolve on quorum or rejection; reject repeat/illegal/expired votes),
  `expireIfDue` (lazily expire a past-SLA pending request), `cancelRequest`, and `approvalProgress` /
  `isPending` / `isResolved` helpers, plus an `ApprovalTransitionError` for illegal moves. 13 offline
  tests: creation + SLA expiry computation, quorum accumulation, fail-fast rejection, role/duplicate/
  terminal/expired guards, lazy expiry, and cancellation.

#### HELIX-131 — Decision API + workflow signal  ✅
- **What it is:** the **inbound half of human-in-the-loop** — the HTTP API approvers actually use, wired to
  the durable workflow. You open an approval request against a paused run, people POST their decisions, and
  the moment the gate **resolves** (enough approvals, or a rejection) the orchestrator **signals the
  Temporal run to resume**. While the gate is still short of quorum, nothing is signalled — the run stays
  paused.
- **Why it matters:** HELIX-74/76 gave a workflow the ability to *durably pause* for sign-off and *resume*
  on a signal; HELIX-130 gave us the multi-approver decision logic. This sub-task is the **bridge** between
  them: it turns "a paused run somewhere in Temporal" into "a thing a person can approve from an API," and
  guarantees the run is resumed exactly once, with the right outcome, only when the policy's quorum is
  truly met. It honours all the state-machine guards (late/duplicate/out-of-role decisions are rejected
  with a `409`), and it signals `approved` or `rejected` so the run's own `awaitApproval` continues down the
  right branch.
- **Where it lives:** the new [../apps/orchestrator/src/approval](../apps/orchestrator/src/approval) module —
  `approval.controller.ts` (`POST /approvals`, `GET /approvals`, `GET /approvals/:id`,
  `POST /approvals/:id/decisions`, `POST /approvals/:id/cancel`), `approval.service.ts` (opens requests,
  applies decisions via `@helix/approvals`, and signals on resolution), an `ApprovalRequestStore` seam with
  an in-memory implementation (durable DB store **deferred** — see [../DEFERRED.md](../DEFERRED.md); the
  *durable* state is the paused Temporal run), and a `WorkflowSignaler` seam whose Temporal implementation
  calls `submitApprovalDecision`. Enabling change in `@helix/workflow`: the existing client-side decision
  helpers are now re-exported from `@helix/workflow/temporal-client` so the orchestrator can reach them. 16
  tests: a service spec (10 — open, below-quorum no-signal, quorum→approve+signal, reject fail-fast+signal,
  resolved/role/unknown/expired guards, cancel, list filters) and a controller spec (6 — routing + 404/409
  mapping).

#### HELIX-132 — Approval inbox (read-API)  ✅
- **What it is:** the **"what's waiting on me" view** — for each pending approval, a compact row showing
  what's being gated, which run it's on, how far along the quorum is (e.g. *1 of 2*), who has decided vs.
  who's still awaited, and how long is left before the SLA lapses — ordered **most-urgent-first** so the
  soonest-to-expire is on top. An approver can ask for just the requests **their role** can act on.
- **Why it matters:** an approver shouldn't have to fetch each request one by one and do the mental math on
  deadlines — the inbox does the triage. The actual *clickable* web page is the SaaS UI's job (**HELIX-11**,
  which owns the frontend the repo doesn't have yet), so this sub-task ships the **data + endpoint** that a
  UI binds to — keeping with the backend-only repo and the deferred-binding pattern. Computing the view is
  pure and deterministic; the endpoint also lazily expires any past-SLA request so the inbox never shows a
  gate that's really already dead.
- **Where it lives:** [inbox.ts](../libs/approvals/src/lib/inbox.ts) in `@helix/approvals` — `toInboxItem`
  (project one request: progress, age, SLA-remaining, decided/awaiting roles) and `buildInbox` (filter to
  pending + an optional role, order most-urgent-first: soonest SLA, SLA before no-SLA, oldest as tiebreak);
  exposed at `GET /approvals/inbox?role=` on the orchestrator
  ([approval.controller.ts](../apps/orchestrator/src/approval/approval.controller.ts) /
  `approval.service.ts`, which also lazily persists SLA expiries). The **rendered UI is deferred to
  HELIX-11** (see [../DEFERRED.md](../DEFERRED.md)). 10 tests: 6 in the lib (projection + filtering +
  ordering/tiebreaks) and 4 in the orchestrator (ordering, role filter, lazy-expire exclusion, route
  resolution). Closes the **Approval Request & Decision Flow** story.

### Story: Notifications & Escalation (Slack + email)  ✅ done

Make sure the right people *know* a decision is waiting — dispatch notifications across channels
(HELIX-133), and chase/escalate them when an SLA is about to lapse (HELIX-134).

#### HELIX-133 — Notification dispatch (Slack/email/in-app)  ✅
- **What it is:** a small system for **getting a message to people across channels** — Slack, email, or an
  in-app feed. You hand it a notification with a list of recipients (each tagged with a channel + address),
  and it routes each one to the right channel and reports back, per recipient, whether it got through. When
  an approval request opens, the orchestrator uses this to tell the approvers it's waiting on them.
- **Why it matters:** the approval gate is only useful if the approvers find out — otherwise a run just
  sits paused. Making **channels a seam** means we can light up the in-app feed for real today and add live
  Slack/email later without touching the callers; one flaky channel can't sink the others (each delivery is
  isolated, and a failure is recorded rather than thrown). The live Slack/email **transports** (webhooks /
  SMTP — they need network + secrets) are **deferred** (see [../DEFERRED.md](../DEFERRED.md)); a recording
  sender stands in for them, and the **in-app** channel is real (it writes to a per-recipient feed the
  orchestrator serves at `GET /notifications`).
- **Where it lives:** the new [../libs/notifications](../libs/notifications) library
  (`@helix/notifications`) — [notification.ts](../libs/notifications/src/lib/notification.ts)
  (`NotificationDispatcher` + the `NotificationSender` channel seam, never-throws delivery),
  [senders.ts](../libs/notifications/src/lib/senders.ts) (`InAppNotificationSender` + an in-app inbox;
  `RecordingNotificationSender` for the deferred channels), and
  [recipients.ts](../libs/notifications/src/lib/recipients.ts) / `approval-notifications.ts` (role →
  recipient directory + the `approval.requested` message builder). Wired into the orchestrator
  ([../apps/orchestrator/src/approval](../apps/orchestrator/src/approval)): `ApprovalService.open` notifies
  approvers (best-effort, never blocking the gate) via a `DispatchingApprovalNotifier`, and a
  `NotificationController` exposes `GET /notifications?address=` for the in-app feed. 20 tests: 10 in the
  lib (routing, unknown-channel + throwing-sender capture, in-app/recording senders, recipient de-dup,
  message build) and 10 in the orchestrator (notify-on-open, best-effort failure, dispatch fan-out, feed
  endpoint).

#### HELIX-134 — SLA timers + escalation  ✅
- **What it is:** chasing an approval that's **running out of time**. When a pending request gets close to
  its SLA deadline without enough sign-off, it **escalates** — pulls in the **backup approvers** the policy
  named (`escalateTo`), so they can now approve too, and notifies them. Once past the deadline with still
  no decision, it simply **expires** (fail-safe — the risky action stays blocked).
- **Why it matters:** without this, an approval with nobody watching just sits there until it silently
  expires and the run dies — no second chance. Escalation gives a real "backup approver" path: as the
  clock runs down, more people are empowered to act and are told about it. The logic is a **pure,
  idempotent** step (a request escalates **at most once**, strictly *before* expiry, and only if it has
  backups), so the sweep that drives it can run as often as it likes without double-firing or fighting the
  expiry rule. The actual *timer* that runs the sweep on a schedule is **deferred** (see
  [../DEFERRED.md](../DEFERRED.md)); the sweep itself is real and can be triggered via the API.
- **Where it lives:** [escalation.ts](../libs/approvals/src/lib/escalation.ts) in `@helix/approvals` —
  `escalationDue` (is a pending request inside the `[expiresAt − lead, expiresAt)` window, with backups,
  not yet escalated?) and `escalateRequest` (stamp `escalatedAt`, widen `approverRoles` with the backups);
  the `approval.escalated` message builder in
  [approval-notifications.ts](../libs/notifications/src/lib/approval-notifications.ts). Wired into the
  orchestrator: `ApprovalService.escalateDue(beforeExpiryMinutes)` sweeps pending requests (expire the
  past-due, escalate + notify the soon-due), exposed at `POST /approvals/escalate-due`, with the notifier's
  new `notifyEscalated` targeting the backups. 13 tests: 6 in the lib (window edges, once-only, no-backups/
  no-SLA/resolved guards, role-widening, a backup then approving) and 7 in the orchestrator (sweep escalate
  + notify, zero-window/idempotent, expire-not-escalate, best-effort notify, the route, the escalated
  builder). Closes the **Notifications & Escalation** story.

### Story: Audit Log (basic)  ✅ done

Keep a trustworthy record of every approval decision: an append-only, tamper-evident log (HELIX-135), then
a way to read and export it (HELIX-136).

#### HELIX-135 — Append-only audit store  ✅
- **What it is:** a **write-once history** of approval events — opened, decided, escalated, expired,
  cancelled — that **can't be quietly rewritten**. Each entry is chained to the one before it with a
  cryptographic hash (like links in a chain), so if anyone edited, removed, or reordered a past entry, a
  quick check (`verifyChain`) spots exactly where the chain breaks.
- **Why it matters:** an approval trail is only worth anything if you can trust it wasn't doctored after the
  fact — "who approved the prod deploy, and when" needs to be **provable**. Making the store **append-only**
  (no update, no delete) and **hash-chained** gives that for free: the history is self-verifying. It's
  generic (an event is about any `subject`), so future areas (monitoring, billing) can reuse it; the
  orchestrator records every approval lifecycle transition through it. The store is in-memory for now —
  a **durable** append-only DB table is **deferred** (see [../DEFERRED.md](../DEFERRED.md)), but the chain
  format is already storage-ready.
- **Where it lives:** the new [../libs/audit](../libs/audit) library (`@helix/audit`) —
  [audit.ts](../libs/audit/src/lib/audit.ts): `auditEvent` (build an event draft), `hashEvent` /
  `verifyChain` (the SHA-256 chain + its tamper check), the `AuditLog` seam, and `InMemoryAuditLog`
  (append-only, freezes each stored event, filterable `list`). Wired into the orchestrator
  ([../apps/orchestrator/src/approval/approval.service.ts](../apps/orchestrator/src/approval/approval.service.ts)):
  `ApprovalService` appends an event on open / decision / escalation / expiry / cancellation (best-effort),
  against one shared log instance the HELIX-136 query API will read. 13 tests: 6 in the lib (drafting,
  chaining + freeze, intact-chain verify, tamper/drop detection, list filter + limit) and 7 in the
  orchestrator (an event per transition with a verifiable chain, escalated/expired from the sweep).

#### HELIX-136 — Audit query + export API  ✅
- **What it is:** the **read side** of the audit log — endpoints to look through the approval history
  (filter by approval, run, or event type, and grab just the most-recent few), to **download** it as a
  file (NDJSON or CSV), and to **verify** the hash chain is intact in one call.
- **Why it matters:** an audit trail you can't easily query or hand to someone (an auditor, a compliance
  review, a spreadsheet) isn't much use. This makes the history *legible* — a filtered API for digging in,
  exports for taking it elsewhere, and a one-shot integrity check that re-walks the chain and says whether
  anything was tampered with. It reads the same shared, append-only log the rest of the approval system
  writes to, so what you read is exactly what happened. This is the **last sub-task of the Human Approval
  epic.**
- **Where it lives:** the NDJSON/CSV formatters are pure + reusable in `@helix/audit`
  ([export.ts](../libs/audit/src/lib/export.ts) — `toNdjson` round-trips losslessly; `toCsv` flattens with
  proper quoting). The orchestrator exposes them at
  [audit.controller.ts](../apps/orchestrator/src/approval/audit.controller.ts): `GET /audit`
  (filtered query), `GET /audit/verify` (chain integrity → `{ ok, brokenAt?, reason? }`), and
  `GET /audit/export?format=ndjson|csv` (a download, filter-aware), over the shared `AuditLog`. 8 tests: 3
  in the lib (NDJSON round-trip, CSV header/rows/escaping, blank-field rendering) and 5 in the orchestrator
  (subject/type filter, recent-N limit, verify, NDJSON + CSV export with download headers). Closes the
  **Audit Log** story and the **Human Approval System** epic.

---

## Epic: Monitoring & Observability  ✅ done

See what the platform is doing while it runs: one telemetry pipeline (logs, metrics, traces) across all
the services and agents, and dashboards for runs and cost.

### Story: Telemetry Pipeline (Logs/Metrics/Traces)  ✅ done

Stand up the plumbing: instrument the services with OpenTelemetry (HELIX-137), point it at a real backend
(HELIX-138), and carry one correlation id end-to-end (HELIX-139).

#### HELIX-137 — OTel SDK + collector  ✅
- **What it is:** switching on **OpenTelemetry** in the services. At startup, each service (registry,
  orchestrator) now stands up a **tracer provider** that stamps every span with *which service produced
  it* (`service.name`, plus the environment) and registers it process-wide — so anything in that process
  that records a span lands in one consistent pipeline, including the per-run agent spans the platform
  already produces (HELIX-65/66's `OtelTraceSink` plugs straight into it).
- **Why it matters:** observability starts with everything speaking the same protocol. OTel is the
  industry-standard one — once the services emit it, any backend (Jaeger, Tempo, Grafana, …) can show
  what's happening without re-instrumenting. The design keeps **where the spans go** as a swappable seam:
  tests inject an in-memory exporter, dev can flip on a console printout with one env var
  (`OTEL_TRACE_EXPORTER=console`), and the real **OTLP push to a collector** (a separate daemon, the
  network leg) is the **deferred binding** (see [../DEFERRED.md](../DEFERRED.md)) — landing it is an
  exporter drop-in, no caller changes.
- **Where it lives:** the new [../libs/telemetry](../libs/telemetry) library (`@helix/telemetry`) —
  [telemetry.ts](../libs/telemetry/src/lib/telemetry.ts): `initTelemetry({ serviceName, environment,
  exporter, simple, global })` → `{ tracer, provider, shutdown }` (resource-stamped `BasicTracerProvider`,
  batch or simple processor, optional global registration) and `exporterFromEnv`. Wired into both
  service entrypoints ([../apps/registry/src/main.ts](../apps/registry/src/main.ts),
  [../apps/orchestrator/src/main.ts](../apps/orchestrator/src/main.ts)) with a flush-on-shutdown signal
  hook; `@opentelemetry/sdk-trace-base` + `resources` moved into runtime dependencies (they now ship in
  both deploy manifests). 5 offline tests: exporter delivery with the service/environment resource,
  batch + forceFlush behaviour, the no-exporter no-op, global registration, and the env switch.

#### HELIX-138 — Metrics/log/trace backend  ✅
- **What it is:** somewhere for the telemetry to actually **land and be looked at**. Two halves: the
  services can now send their spans **off-process over OTLP** (the standard OpenTelemetry wire protocol),
  and the repo ships a one-command local backend — an **OTel Collector** fanning out to **Tempo** (traces)
  and **Prometheus** (metrics), all browsed in **Grafana** with the datasources pre-wired.
- **Why it matters:** until now a trace died with the process (in-memory) or scrolled past in a console.
  With a real backend you can *go look*: find a run's trace by service name in Grafana, see its spans and
  timing, watch metrics accumulate. It's strictly **opt-in by env var** — CI and tests never need it, and
  with nothing configured the services behave exactly as before. This also **lands deferral #10** (the
  OTLP exporter + collector), the first deferred binding to graduate to DEFERRED.md's Landed section:
  turning it on is `docker compose -f observability/docker-compose.yml up -d` + `OTEL_TRACE_EXPORTER=otlp`.
  The pipeline was **verified live** — a span sent from the telemetry lib was found in Tempo by search,
  Grafana healthy, Prometheus scraping the collector. (OTLP *logs* have no producer yet; the collector's
  logs pipeline is a placeholder.)
- **Where it lives:** `exporterFromEnv` in
  [telemetry.ts](../libs/telemetry/src/lib/telemetry.ts) now returns an `OTLPTraceExporter`
  (`@opentelemetry/exporter-trace-otlp-http`, a new runtime dep) for `OTEL_TRACE_EXPORTER=otlp` or
  whenever `OTEL_EXPORTER_OTLP_ENDPOINT` is set; the backend is the new
  [../observability/](../observability) folder (compose file + collector/Tempo/Prometheus/Grafana
  configs), documented in [LOCAL_TESTING.md](LOCAL_TESTING.md) §3. 8 lib tests (3 new: the otlp switch,
  endpoint-triggered selection, console-wins precedence).

#### HELIX-139 — Correlation IDs end-to-end  ✅
- **What it is:** giving every run **one shared id** that ties its telemetry together. When you start a
  run, the orchestrator now mints (or continues) a standard **W3C trace id** and hands it back in the
  response — `traceId` + `traceparent`, also echoed as a response header. That same id is attached to the
  durable Temporal run and used as the parent for the orchestrator's own span, so the API call, the
  workflow run, and (once the real agent executor is wired in) the per-run agent spans all line up under
  **a single trace** you can paste into Grafana/Tempo.
- **Why it matters:** observability only pays off if you can follow *one* request through *all* the moving
  parts. Before this, a run id and a trace lived in different worlds; now `GET /api/runs/<id>` gives you
  the trace id back and a trace id finds the run — so debugging a run is "copy the id, open Grafana." It
  also makes the platform a **good distributed-trace citizen**: send your own `traceparent` and the run
  *joins your upstream trace* instead of starting a fresh one, which is what lets a caller see Helix as
  one hop inside their bigger picture.
- **Where it lives:** the new [propagation.ts](../libs/telemetry/src/lib/propagation.ts) in `@helix/telemetry`
  — `runCorrelation(incoming?)` (parse-or-mint), the W3C `traceparent` parse/format helpers, and an OTel
  context builder (`contextWithCorrelation`) so a span started for a run inherits its trace id. The
  orchestrator [run service](../apps/orchestrator/src/workflow-run/workflow-run.service.ts) attaches the
  trace context to the Temporal start as a **memo** and wraps the dispatch in a span on that trace; the
  [controller](../apps/orchestrator/src/workflow-run/workflow-run.controller.ts) reads/echoes the
  `traceparent` header; the [temporal client](../libs/workflow/src/lib/temporal/client.ts) threads the
  memo through start/retry and surfaces `traceId`/`traceparent` back from `describe()`. Documented in
  [LOCAL_TESTING.md](LOCAL_TESTING.md) §3. 15 tests (10 new: parse/format round-trips, parse-or-mint and
  inbound-continuation, the "span inherits the run trace id" end-to-end check, memo attach + readback, and
  the controller echo/continue behaviour). Closes the Telemetry Pipeline story.

### Story: Run & Cost Dashboards (basic)  ✅ done

Turn the raw telemetry into **numbers people read**: aggregate runs into success/latency/cost rollups
(HELIX-140), then put them on dashboards (HELIX-141).

#### HELIX-140 — Run analytics aggregation  ✅
- **What it is:** the **math that turns a pile of finished runs into a scorecard** — how many ran, what
  fraction succeeded, how long they took (typical and worst-case), and what they cost. You can ask for the
  whole picture, the picture **per workflow** (or any other grouping), or a **day-by-day** trend.
- **Why it matters:** "is the platform healthy and what is it costing me?" is the first question an
  operator asks, and it's the data a dashboard draws. Keeping it as **pure, source-agnostic** functions
  means the same rollups work whether the runs come from Temporal's history, a future runs table, or a
  test fixture — and they're trivial to unit-test exactly (no DB, no clock). The **cost** half reuses the
  existing per-run cost rollup (HELIX-67); this adds the **success-rate and latency** half and stitches
  cost in. Where the run records actually *come from* (listing real runs + joining their cost) is the one
  swappable seam, deferred to the dashboards work — see [../DEFERRED.md](../DEFERRED.md) #11.
- **Where it lives:** the new [../libs/analytics](../libs/analytics) library (`@helix/analytics`) —
  [analytics.ts](../libs/analytics/src/lib/analytics.ts): `aggregateRuns`, `aggregateRunsBy` (grouping),
  `bucketRunsDaily` (UTC daily series), latency `percentile`s and a `RunRecord` model, plus
  `runOutcomeFromStatus` (maps Temporal status names → outcomes, excluding still-running ones) and a
  `RunAnalyticsSource` seam with an `InMemoryRunAnalyticsSource`. Wired into `tsconfig.base` + CI
  (typecheck + jest). 15 tests (percentile edge cases, latency/cost rollups, grouping, daily buckets,
  the status mapping, and the in-memory source's filtering).

#### HELIX-141 — Dashboards  ✅
- **What it is:** the **screens** people actually look at — Grafana dashboards that ship **with the repo**
  and load themselves when the observability stack starts (no clicking "import"). Two of them: a
  **Telemetry Pipeline** view (is telemetry flowing? how many spans in/out?) and a **Runs & Cost** view
  (success rate, latency, spend).
- **Why it matters:** dashboards-as-code means everyone sees the *same* charts, versioned and reviewed like
  any other code — not hand-built panels that live in one person's browser. The **Telemetry Pipeline**
  board is **live today**: it reads the collector's own metrics (span receive/export rates), so you can
  confirm the pipeline is healthy at a glance. The **Runs & Cost** board is wired to a fixed metric
  contract (`helix_runs_total`, `helix_run_latency_ms_bucket`, `helix_run_cost_usd_total`) and ships
  ready — it lights up the moment the run-analytics metrics exporter is connected
  ([../DEFERRED.md](../DEFERRED.md) #11), with no further dashboard work. Verified live: both boards
  provision into a **Helix** folder and the pipeline metric returns data **through Grafana's datasource
  proxy**, not just in Prometheus.
- **Where it lives:** [../observability/dashboards/](../observability/dashboards) (the two dashboard
  JSONs) provisioned by [grafana-dashboards.yaml](../observability/grafana-dashboards.yaml); datasources
  got stable UIDs ([grafana-datasources.yaml](../observability/grafana-datasources.yaml)); the collector
  now exposes its self-telemetry on `:8888` ([otel-collector.yaml](../observability/otel-collector.yaml))
  which Prometheus scrapes ([prometheus.yml](../observability/prometheus.yml)). Documented in
  [LOCAL_TESTING.md](LOCAL_TESTING.md) §3. Config-only — no app code, CI unaffected. **Closes the Run &
  Cost Dashboards story and the Monitoring & Observability epic.**

---

## Epic: SaaS Platform  ✅ done

The last epic — turn the engine into a product people can sign into and use: accounts and
orgs (HELIX-47), a way to submit requests and watch runs (HELIX-48), and guided GitHub
onboarding (HELIX-49).

### Story: Auth, Orgs & RBAC  ✅ done

Secure sign-in and org-scoped access: OIDC/SSO login + sessions (HELIX-142), an org/tenant
model with isolation (HELIX-143), and roles that are actually enforced (HELIX-144).

#### HELIX-142 — Auth (OIDC/OAuth) + session  ✅
- **What it is:** **signing in.** A user authenticates with an identity provider (the kind of
  "Log in with…" you've seen everywhere — Auth0, Cognito), and Helix turns that into its own
  **session** so the rest of the app knows who you are on every request. Two endpoints: one
  trades the provider's token for a Helix session, one returns "who am I".
- **Why it matters:** everything multi-user starts here — you can't scope data to an org or
  enforce roles until you know *who is asking*. The design keeps the **identity provider as a
  swappable seam**: locally (and in CI, which can't reach a real login service) a built-in
  **stand-in** verifies tokens with a shared key, while the real provider check (the
  industry-standard RS256-against-the-provider's-keys) is the **deferred binding**
  ([../DEFERRED.md](../DEFERRED.md) #12) — a one-line swap, nothing else changes. Helix also
  mints its **own** session rather than leaning on the provider for every request, so the app
  keeps working even if the login service hiccups, and session length is ours to set.
- **Where it lives:** the new [../libs/auth](../libs/auth) library (`@helix/auth`) — a
  dependency-free HS256 [JWT impl](../libs/auth/src/lib/jwt.ts) (`node:crypto`), the
  [OIDC verifier seam + stand-in](../libs/auth/src/lib/oidc.ts), and the
  [SessionService](../libs/auth/src/lib/session.ts) that exchanges a verified ID token for a
  Helix session. Wired into the orchestrator as [AuthModule](../apps/orchestrator/src/auth/auth.module.ts)
  — `POST /api/auth/session` + guarded `GET /api/auth/me`, an
  [AuthGuard](../apps/orchestrator/src/auth/auth.guard.ts) (Bearer session → request principal)
  and a `@Principal()` decorator. Tenant isolation (HELIX-143) and role enforcement (HELIX-144)
  build on the principal this produces. 20 tests; documented in [LOCAL_TESTING.md](LOCAL_TESTING.md) §2.

#### HELIX-143 — Org/tenant model + isolation  ✅
- **What it is:** making sure **one customer can never see or touch another customer's data** — "row-level
  isolation." Every stored row already carries an owning org; this makes every read, update, and delete
  actually *check* it, so a row only exists as far as its own tenant is concerned.
- **Why it matters:** this is **the** safety property of a multi-tenant SaaS, and there was a real hole. Most
  registry queries were already org-scoped, but **fetch-by-id, update, and delete were keyed by the row id
  alone** — so anyone who knew (or guessed) a row's id could read, re-version, or delete **another org's**
  agent definition or approval policy. Now those paths are scoped to the caller's tenant: a cross-tenant id
  comes back as a plain **404** (it's invisible, not "forbidden" — you can't even tell it exists), and a
  delete/update of someone else's row is refused. The scope's *source* is a seam — it comes from the
  `x-org-id` header today and can come straight from the signed-in principal's org (HELIX-142) with no data-
  layer change.
- **Where it lives:** the new [../libs/tenancy](../libs/tenancy) library (`@helix/tenancy`) —
  [tenant.ts](../libs/tenancy/src/lib/tenant.ts): `TenantScope`, `scopedWhere` (adds the org filter to a
  query), `assertTenant` / `belongsToTenant`, and `TenantIsolationError`. Applied across the registry's
  two org-owned resources — agent definitions and approval policies (repository `findById` scoped; service
  `findById` / `update` / `softDelete` confirm the tenant; controllers thread the scope from `@OrgId()`).
  Proven with **cross-tenant isolation tests against real Postgres** (owner sees the row; another tenant gets
  404 on read/update/delete). 6 tenancy-lib tests + the registry isolation suites; `ARCHITECTURE.md`
  refreshed. RBAC enforcement (HELIX-144) is the remaining piece of this story.

#### HELIX-144 — RBAC roles + enforcement  ✅
- **What it is:** **roles that actually mean something** — once we know who you are (HELIX-142), this decides
  *what you're allowed to do*. A route can say "admins only", and a request without that role is turned away.
- **Why it matters:** authentication answers "who are you"; **authorization** answers "may you do this", and a
  SaaS needs both. The roles are **ranked** — `viewer < member < admin < owner` — so a higher role
  automatically clears a lower bar (an `owner` passes an `admin`-only check) without listing every role
  everywhere; genuinely separate, custom roles (say `billing`) match exactly. Enforcement is a **guard you
  compose** with the auth guard: the auth guard establishes the principal, the roles guard checks it — so
  protecting any route is a one-line `@Roles('admin')`, and existing routes are untouched until we choose to
  gate them.
- **Where it lives:** the pure logic is in [../libs/auth/src/lib/rbac.ts](../libs/auth/src/lib/rbac.ts)
  (`satisfiesRole` / `satisfiesAnyRole` / `authorize`, the role ranks, `AuthorizationError`); the NestJS
  glue is in the orchestrator — [@Roles()](../apps/orchestrator/src/auth/roles.decorator.ts) +
  [RolesGuard](../apps/orchestrator/src/auth/roles.guard.ts), shown end-to-end on a guarded
  `GET /api/auth/admin/ping` (admin-only). 12 tests (8 RBAC-logic incl. the hierarchy + custom-role cases,
  4 HTTP enforcement: admin 200, owner-via-hierarchy 200, lesser role 403, no session 401). **Closes the
  Auth, Orgs & RBAC story.**

### Story: Request Submission & Run Dashboard  ✅ done

The user-facing loop: submit a request and watch it run. Submit → start a run (HELIX-145), a live
run dashboard (HELIX-146), and views of the artifacts it produces (HELIX-147). **Decision:** API-first —
build the endpoints now, defer the rendered screens to a UI push (same call as the approval inbox UI).

#### HELIX-145 — Request submission API  ✅
- **What it is:** the **"start a build" button's backend.** A signed-in user submits a request — a title and
  *what they want built* in plain words — and the platform kicks off a workflow run for it and remembers the
  link, so they (and only their org) can find it again.
- **Why it matters:** this is the product's front door — the thing a user actually *does*. It ties together
  everything underneath: it requires a **session** (HELIX-142), stamps the request with the caller and their
  **org** and only ever shows them their org's requests (HELIX-143), and starts the run through the same path
  that gives every run a **trace id** (HELIX-139), so a request is traceable end-to-end. Per the **API-first**
  decision for this epic, the submission *form* is deferred — turning the free-text prompt into a *custom*
  workflow via the Planning Agent (needs the LLM) and a durable store are deferred too ([../DEFERRED.md](../DEFERRED.md) #13);
  for now a request runs the **standard pipeline** (plan→code→review→test→deploy) or an explicit workflow.
- **Where it lives:** the new [request module](../apps/orchestrator/src/request) in the orchestrator —
  `POST /api/requests` (submit → run), `GET /api/requests` (your org's, newest-first, `?mine`), `GET
  /api/requests/:id` (tenant-scoped — 404 across orgs); a `BuildRequest` model, an `InMemoryRequestStore`
  seam, and `requestToWorkflow` (the default pipeline). The whole controller is behind the `AuthGuard`.
  9 tests; documented in [LOCAL_TESTING.md](LOCAL_TESTING.md) §2. The run dashboard (HELIX-146) and artifact
  views (HELIX-147) consume this.

#### HELIX-146 — Run dashboard API (live status + traces)  ✅
- **What it is:** the **"watch your build"** data — for the requests you submitted, where is each run *right
  now*, and a **live feed** that updates as each step finishes. The screen is deferred; this is everything a
  screen would call.
- **Why it matters:** submitting a request (HELIX-145) is only half the loop — you want to *watch it run*.
  The key bit is that it's all **scoped through your request**: you ask "how's *my* request doing", not "show
  me run X", so one tenant can never watch another's run by guessing an id (a cross-tenant id is a **404**).
  It reuses the engine's existing live-status machinery (the per-step progress stream from HELIX-79) and the
  **trace id** carried since HELIX-139, so a run links straight to its Grafana/Tempo trace. Built API-first
  (the dashboard UI is the deferred [#13](../DEFERRED.md) push).
- **Where it lives:** the [request module](../apps/orchestrator/src/request) gains three reads —
  `GET /api/requests/overview` (your org's requests each joined with its run status, one call),
  `GET /api/requests/:id/run` (one run's status + trace id), and `GET /api/requests/:id/stream`
  (live per-step status over **Server-Sent Events**) — all tenant-scoped, all behind the `AuthGuard`,
  all delegating to the existing run service. 8 new tests (17 in the request module); documented in
  [LOCAL_TESTING.md](LOCAL_TESTING.md) §2.

#### HELIX-147 — Artifact views (PR/tests/deploy)  ✅
- **What it is:** the **payoff** — the actual *things* a run produces: the **pull request** it opened, the
  **test results**, and the **deployed URL**. One call gathers them for a request.
- **Why it matters:** a run is only useful for its outputs, and they're scattered across different steps
  (the coding agent opens the PR, the testing agent reports results, the deployment agent returns a URL).
  This **gathers and normalizes** them into one tidy shape so a screen can just show "here's your PR, here's
  your tests, here's where it's live." It's deliberately **source-agnostic** — it scans each step's output
  for the well-known fields, first match wins — and **partial-friendly**: a run that's only finished coding
  surfaces just the PR, and surfaces more as later steps complete. Tenant-scoped like the rest (a cross-tenant
  id is a 404). Honest caveat: artifacts populate only as the **real agents** produce them — with today's
  stub worker a run surfaces none/simulated outputs until the agent executor is wired in.
- **Where it lives:** [artifacts.ts](../apps/orchestrator/src/request/artifacts.ts) — a pure
  `extractArtifacts(run steps) → { pullRequest?, tests?, deployment? }`; surfaced at
  `GET /api/requests/:id/artifacts` (auth-guarded, tenant-scoped) via a new one-shot
  `WorkflowRunService.progress()`. 8 new tests (6 extractor + service + controller). **Closes the Request
  Submission & Run Dashboard story.**

### Story: Onboarding & GitHub Integration Setup  ✅ done

A new org gets set up: connect GitHub via the App install flow with credentials kept safe (HELIX-148),
then confirm the connection actually works (HELIX-149).

#### HELIX-148 — GitHub App connect flow  ✅
- **What it is:** **"Connect GitHub."** A signed-in org kicks off installing the Helix GitHub App, and once
  installed we remember the connection — kept **encrypted in the vault**, scoped to that org.
- **Why it matters:** the platform needs access to your repos to actually build things, and that access is
  sensitive, so two things matter: it must be **safely stored** and **isolated per tenant**. The credential
  goes through the **encrypted secret vault** (envelope encryption — it's only ever ciphertext at rest, and
  a test asserts the raw record contains no plaintext), keyed by org so one tenant can never read another's.
  The flow is the standard install dance — start (get the "Install on GitHub" URL + an unguessable,
  single-use **state**), then a callback that records the installation — with the `state` making sure an
  installation can't be attached to the wrong org. Built **API-first**: the wizard screen, and confirming
  the install against real GitHub (fetching the account, minting tokens), are deferred ([../DEFERRED.md](../DEFERRED.md) #14).
- **Where it lives:** the new [integration module](../apps/orchestrator/src/integration) in the orchestrator —
  `POST /api/integrations/github/connect` + `/callback`, `GET` (status), `DELETE` (disconnect), all behind the
  `AuthGuard`; the connection is persisted through `@helix/secrets` (`EncryptedSecretStore` + `LocalKms`) — the
  **first time the vault is wired into a running service**. 10 tests (encryption-at-rest, tenant isolation,
  single-use/tenant-bound state, disconnect, controller auth). Documented in [LOCAL_TESTING.md](LOCAL_TESTING.md) §2.
  HELIX-149 (verify access) builds on this.

#### HELIX-149 — Connection health check  ✅
- **What it is:** a **"test connection"** button's backend — does the org's GitHub link still actually work?
- **Why it matters:** a stored connection can silently go stale (the app uninstalled, access revoked), so
  onboarding isn't done until you can *confirm* it. `POST /api/integrations/github/test` reports a plain
  status: **not_connected** (connect first), **verified** (access confirmed), **not_configured**, or
  **error** — friendly enough for a UI to act on, and it never throws. The actual "prove it" step — minting
  an installation token against live GitHub — is a **swappable seam** (`GithubConnectionVerifier`); locally
  there's no GitHub App so the honest default reports `not_configured`, and the real token-minting verifier
  (wrapping `@helix/github-mcp`'s `GitHubAppTokenProvider`) is the deferred binding ([../DEFERRED.md](../DEFERRED.md) #14).
  Kept the MCP SDK out of the orchestrator build by leaving the live verifier behind the seam.
- **Where it lives:** [github.verify.ts](../apps/orchestrator/src/integration/github.verify.ts) (the verifier
  seam + `UnconfiguredGithubVerifier`) and the integration service/controller `verify` / `POST /test`
  (auth-guarded, tenant-scoped). 5 new tests (15 in the integration module). Documented in
  [LOCAL_TESTING.md](LOCAL_TESTING.md) §2. **Closes the Onboarding & GitHub Integration story — and the
  SaaS Platform epic.**

---

## Epic: Agent Executor (HELIX-150)  ✅ done

Forward scope after the MVP backlog: replace the worker's **stub** step executor with one that runs the
real per-role agents, turning simulated runs into real planning → coding → review → testing → deployment.
Built seam-first (a scripted LLM keeps it CI-testable; the real one runs locally behind an env key). Full
plan: [AGENT_EXECUTOR_PLAN.md](AGENT_EXECUTOR_PLAN.md).

### Story: Agent executor runtime  ✅ done

#### HELIX-152 — Executor dispatch seam  ✅
- **What it is:** the **switchboard** a run uses to pick the right agent for each step. A step says "I'm a
  `coding` step"; the dispatcher routes it to whatever executor is registered for `coding`.
- **Why it matters:** it's the clean plug-point the real agents slot into one at a time, without touching the
  workflow engine. Until an agent is wired, an unknown role falls back to a **simulated** executor (the dev
  worker's old stub, now just a registered executor) so runs still progress; with no fallback, an unknown
  role is a tidy **business failure** (returned, not thrown) so the run fails visibly instead of crashing.
  The lib is deliberately **dependency-free** (its own minimal step/result shapes) so the workflow engine can
  use it with no circular dependency.
- **Where it lives:** the new [../libs/executor](../libs/executor) library (`@helix/executor`) —
  [executor.ts](../libs/executor/src/lib/executor.ts): `RoleDispatcher` (register by `agentRole`, dispatch,
  optional fallback) + `simulatedStepExecutor`. The [dev worker](../libs/workflow/src/dev-worker.ts) now
  dispatches through it (behaviour preserved; real executors register in HELIX-155…158). Wired into
  `tsconfig.base` + CI; `ARCHITECTURE.md` updated. 8 tests.

#### HELIX-153 — AgentSpecResolver + default per-role specs  ✅
- **What it is:** the **job description** each role's agent gets — its system prompt and which model tier to
  use. A small lookup: given a role (`coding`, `planning`, …), hand back the spec the agent loop runs with.
- **Why it matters:** the executor (next sub-task) needs to know *how* to run each role, and **where those
  specs come from is a seam**: built-in defaults ship now, and a registry-backed resolver (pulling the
  org's customised agent definitions from the registry API) drops in later **without touching any executor**.
  The defaults cover the five standard pipeline roles, each with a sensible prompt + tier (planning/coding on
  `opus`, the rest on `sonnet`). `AgentSpec` is imported **type-only**, so the lib stays
  runtime-dependency-free.
- **Where it lives:** [agent-spec.ts](../libs/executor/src/lib/agent-spec.ts) in `@helix/executor` —
  the `AgentSpecResolver` interface, `DefaultAgentSpecResolver`, and `DEFAULT_AGENT_SPECS`. 5 tests.

#### HELIX-154 — Generic role executor  ✅
- **What it is:** the piece that **actually runs an agent for a step** — it takes the role's spec (HELIX-153),
  writes the agent's instructions from the step + what earlier steps produced, runs the agent loop, and
  reports the step as succeeded or failed.
- **Why it matters:** this is where the dispatcher and the spec resolver come together into a working step.
  Two design choices make it solid: **(1)** the **step-to-step context flow** — each step's input includes a
  digest of prior step outputs, so the coding step sees the plan, review sees the code, and so on; **(2)** the
  agent loop is **injected** (a runner function = `runAgent`'s signature), so the executor lib stays
  runtime-dependency-free and is **fully testable with a scripted runner** — no real LLM, no network. Real
  `runAgent` is wired in at the worker (HELIX-158). Result mapping is deliberate: a clean finish
  (`end_turn`) is success (output = the validated structured output, or the final text); a guardrail breach,
  refusal, or hitting a limit is a failure the workflow can route.
- **Where it lives:** [role-executor.ts](../libs/executor/src/lib/role-executor.ts) in `@helix/executor` —
  `createRoleExecutor(deps)`, `defaultBuildInput`, `mapResult`, and the `AgentRunner` seam. 9 tests
  (result mapping, input building + context flow, run wiring, role tools, missing-spec failure).

#### HELIX-155 — Planning + Review role executors  ✅
- **What it is:** the first two **real roles** wired onto the executor — **planning** (turn the request into
  a plan) and **code review** (look over what was built). Both are "LLM-only": they think, they don't touch a
  sandbox or external tools.
- **Why it matters:** these prove the role pattern end to end on the generic executor — the only role-specific
  part is **how the prompt is framed**: planning frames the submitted request as "produce a plan"; review
  frames it as "review the prior steps' changes" and is fed those changes via the context flow. Registering
  them is a one-liner (`registerLlmRoles`), and they run on their default specs (planning on `opus`, review on
  `sonnet`). Still exercised with a scripted runner — no real LLM until the worker wiring (HELIX-158).
- **Where it lives:** [pipeline-roles.ts](../libs/executor/src/lib/pipeline-roles.ts) in `@helix/executor` —
  `planningExecutor` / `codeReviewExecutor`, `planningInput` / `reviewInput`, and `registerLlmRoles`; plus the
  extracted `priorOutputsDigest` / `withPriorContext` helpers. 4 tests.

#### HELIX-156 — Coding + Testing role executors (sandbox + tools)  ✅
- **What it is:** the two roles that **do real work on files** — coding (write the change) and testing
  (generate + run tests). Unlike planning/review, they need a **workspace**.
- **Why it matters:** these roles have a lifecycle the LLM-only ones don't — **provision** a sandbox
  workspace, run the agent with **workspace-bound tools** (file edits, test runs), then **dispose** the
  workspace afterward (even if the run errors). That orchestration is the new piece; the workspace and tools
  themselves are **injected seams**, so the real `@helix/sandbox` + file/test tools plug in at the worker
  (HELIX-158) while the executor lib stays pure and offline-tested. An unknown role fails *before* a
  workspace is provisioned (no wasted setup), and a failing teardown never masks a good result.
- **Where it lives:** [workspace-roles.ts](../libs/executor/src/lib/workspace-roles.ts) in `@helix/executor` —
  `workspaceRoleExecutor`, the `WorkspaceProvider` / `WorkspaceTools` seams, `codingExecutor` /
  `testingExecutor`, and `registerWorkspaceRoles`. 6 tests.

#### HELIX-157 — Deployment role executor  ✅
- **What it is:** the **ship it** role — build the artifact, deploy the demo stack, hand back the **live URL**.
- **Why it matters:** deployment is the odd one out — it isn't an LLM loop, it's a **deterministic
  build → deploy → URL** (matching how the Deployment Agent was built: pure synthesis + a runner-backed
  command seam). So it runs through an injected **`DeploymentRunner`** rather than `runAgent`; the real
  build / ECR / CDK execution against AWS is the deferred binding, wired at the worker. On success the step's
  output is `{ liveUrl, environment }` — exactly the shape the **artifact views (HELIX-147)** read, so the
  deployed URL shows up there once a real run produces it.
- **Where it lives:** [deployment-role.ts](../libs/executor/src/lib/deployment-role.ts) in `@helix/executor` —
  `deploymentExecutor`, the `DeploymentRunner` seam, and `registerDeploymentRole`. 4 tests.

#### HELIX-158 — Worker wiring (config-driven LLM seam)  ✅
- **What it is:** the **finale** — the worker stops simulating and actually **runs the agents**. Start
  `pnpm dev:worker` and each step now drives the real role executor; with an API key it calls the real model,
  without one it uses a scripted offline stand-in so a run still completes end to end.
- **Why it matters:** this is the line between "backlog of parts" and "the thing runs." The **LLM is
  config-driven** — `ANTHROPIC_API_KEY` set → the real `AnthropicProvider` (wrapped for retries/backoff/
  timeouts); unset → a **scripted provider** that returns canned completions, so CI and a keyless dev box
  still execute the whole pipeline (the key is read from the environment only, never logged or committed).
  The five role executors are assembled onto one dispatcher and handed to the Temporal worker. Kept runnable
  offline by **deferring** the genuinely external bits — real repo checkout + file/test tools in the sandbox,
  and real AWS deployment — behind their seams (a throwaway temp-dir workspace, no tools yet, a stubbed
  deploy); the agents are wired in *behind* those, so landing each binding lights it up with no executor
  changes.
- **Where it lives:** `@helix/llm` — [scripted.provider.ts](../libs/llm/src/lib/scripted.provider.ts)
  (`ScriptedLlmProvider`) + [provider-env.ts](../libs/llm/src/lib/provider-env.ts) (`providerFromEnv`);
  `@helix/executor` — [pipeline.ts](../libs/executor/src/lib/pipeline.ts) (`buildPipelineDispatcher`); and the
  rewired [dev worker](../libs/workflow/src/dev-worker.ts). Documented in [LOCAL_TESTING.md](LOCAL_TESTING.md) §2.
  9 new tests; the workflow suite (66) stays green. **Closes the Agent Executor runtime story — and the
  Agent Executor epic.**

---

## Epic: Sandbox Tools & Repo Checkout (HELIX-159)  ✅ done

Forward scope after the Agent Executor epic: make the coding/testing agents **actually write files and run
tests** in a real workspace, instead of thinking out loud in an empty temp dir. This is the "describe → do"
jump. Mostly *wiring* pieces that already exist (`@helix/sandbox`, the coding-agent file tools, the
testing-agent runner) into the two seams the executor already exposes. Full plan:
[SANDBOX_TOOLS_PLAN.md](SANDBOX_TOOLS_PLAN.md).

### Story: Sandbox-backed coding & testing  ✅ done

#### HELIX-161 — Run-scoped workspace + run-id threading  ✅
- **What it is:** the plumbing that lets **one run's steps share a single workspace**. Before this, every
  step got a brand-new empty folder that was thrown away the moment the step finished — so the **testing**
  step never saw the files the **coding** step wrote. Now the folder is tied to the *run*, not the step: the
  first step makes it, the rest reuse it.
- **Why it matters:** it's the foundation the whole epic needs. There's no point giving coding a "write file"
  tool if testing can't then see that file. This is the one structural change in the epic; the next sub-tasks
  just hang the real file/test tools off this shared workspace.
- **How it works (plain words):** every run already has a unique id (its Temporal "workflow id"). We carry
  that id from the running workflow down to the step executor, and use it as the key for the workspace — same
  id, same folder. A small registry hands out "make-or-reuse" folders per run and tidies up folders that have
  sat unused past a timeout (an idle sweep), so nothing leaks. Disposing is now a *run-level* concern, not
  done after each step. (Sharing across *different machines* is deliberately left for later — today's worker
  runs a run's steps in one process.)
- **Where it lives:** `@helix/executor` — [workspace-roles.ts](../libs/executor/src/lib/workspace-roles.ts)
  (`WorkspaceFactory`, the run-scoped `WorkspaceProvider`, and `RunScopedWorkspaceProvider` with
  `acquire`/`release`/`sweepIdle`) + the `runId` on [role-executor.ts](../libs/executor/src/lib/role-executor.ts)'s
  `RunContext`; `@helix/workflow` — the run-id threading through
  [workflows.ts](../libs/workflow/src/lib/temporal/workflows.ts) →
  [activities.ts](../libs/workflow/src/lib/temporal/activities.ts) and the rewired
  [dev worker](../libs/workflow/src/dev-worker.ts). 14 new executor tests + 1 activity test; executor (47) and
  workflow (67) suites green.

#### HELIX-162 — Coding file-edit tools (sandbox-bound)  ✅
- **What it is:** the coding agent's actual **read / write / patch a file** tools, packaged so the agent loop
  can call them — each one wired to a specific run's workspace folder.
- **Why it matters:** this is the first half of giving the agents real *hands*. The tool definitions and the
  logic that runs them already existed (HELIX-103); this turns them into the exact shape the executor hands an
  agent (`toolsFor('coding')` → a `name → executor` map), so the next step (worker wiring, HELIX-165) can just
  plug them in. On its own it changes no behaviour yet — it's a ready-to-use building block.
- **How it works (plain words):** given a sandbox (an isolated folder with a guard that blocks paths trying to
  escape it), we build three callable tools — `read_file`, `write_file`, `patch_file` — each forwarding the
  model's request to the existing handler. Expected problems (file missing, snippet not found, a path that
  climbs out of the folder, bad input) come back as polite error results the agent can read and fix, never as
  crashes.
- **Where it lives:** `@helix/coding-agent` — [coding-tools.ts](../libs/coding-agent/src/lib/coding-tools.ts)
  (`codingFileEditTools(sandbox)` + `codingToolDefs`), over the existing
  [file-edit-tools.ts](../libs/coding-agent/src/lib/file-edit-tools.ts). 5 new tests (write/read/patch against a
  real local sandbox, on-disk landing, error + path-escape cases); coding-agent suite (83) green.

#### HELIX-163 — Testing command + test-run tools  ✅
- **What it is:** the testing agent's two tools — **run a command** (build / lint / anything) and **run the
  tests** — bound to a run's workspace, with the test run parsed into a tidy pass/fail + coverage report.
- **Why it matters:** the second half of giving the agents real hands (HELIX-162 was the coding half). Now the
  testing step can actually *execute* the project's tests in the sandbox and hand back a structured result —
  the **test artifact** that shows up on the run / PR — instead of just describing what it would do.
- **How it works (plain words):** `run_command` runs an executable in the workspace and returns its exit code
  and (size-capped) output; a non-zero exit comes back flagged so the agent notices and fixes it.
  `run_tests` figures out the framework (peeking at `package.json` / `conftest.py`, or you can pass it),
  runs the right test command, then parses the output into counts, failures, and coverage and returns a
  markdown report. Everything that can go wrong (a failing build, failing tests, a timeout, bad input) comes
  back as a readable error result, never a crash — all reusing the runner/parser/report pieces built in
  HELIX-106/119/120.
- **Where it lives:** `@helix/testing-agent` —
  [testing-tools.ts](../libs/testing-agent/src/lib/testing-tools.ts) (`testingTools(sandbox)` + `TESTING_TOOLS`),
  over the existing [test-runner.ts](../libs/testing-agent/src/lib/test-runner.ts) /
  [test-results.ts](../libs/testing-agent/src/lib/test-results.ts) /
  [report.ts](../libs/testing-agent/src/lib/report.ts). 10 new tests (command forwarding, non-zero-exit flag,
  default timeout, pass/fail reports, framework auto-detection, explicit command); testing-agent suite (51) green.

#### HELIX-164 — Populate the workspace (scaffold / checkout) + change set  ✅
- **What it is:** the step that puts *content* in a run's workspace before the coding agent starts — either
  **scaffold** a brand-new project from a generated file set, or **check out** an existing repo — and then,
  after the agent is done, produces the run's **change set** (which files were added / modified / deleted, with
  line counts) for the PR.
- **Why it matters:** the agents now have hands (HELIX-162/163), but an empty folder gives them nothing to work
  on. This fills the folder, and — just as importantly — captures *what changed* so the run can show a real
  diff on the PR instead of a vague "it did some stuff." This is the only genuinely new logic in the epic;
  HELIX-165 then turns it all on in the worker.
- **How it works (plain words):** `populateWorkspace` takes a hint — scaffold (with the files to write) or
  checkout (with a repo + a "fetcher" that supplies the files) — writes everything safely inside the workspace,
  then takes a **baseline snapshot**. Real `git clone` stays deferred; offline runs use an in-memory fetcher.
  After the agent works, `captureWorkspaceDiff` re-snapshots and diffs against that baseline into a tidy change
  set (ignoring `node_modules` etc.), and `formatWorkspaceDiff` renders it as a short markdown summary. All of
  it reuses the scaffold / checkout / diff pieces built back in HELIX-100/101/103.
- **Where it lives:** `@helix/coding-agent` —
  [workspace-populate.ts](../libs/coding-agent/src/lib/workspace-populate.ts) (`populateWorkspace`,
  `captureWorkspaceDiff`, `formatWorkspaceDiff`), over the existing
  [scaffold.ts](../libs/coding-agent/src/lib/scaffold.ts) / [diff.ts](../libs/coding-agent/src/lib/diff.ts) and
  `@helix/sandbox`'s [repo-checkout.ts](../libs/sandbox/src/repo-checkout.ts). 6 new tests (scaffold + checkout
  baselines, conflict propagation, the change-set diff, no-op, markdown formatting); coding-agent suite (89) green.

#### HELIX-165 — Worker wiring (flips it all on)  ✅
- **What it is:** the keystone that connects everything from this epic into the running worker. The worker now
  gives each run a **real sandbox workspace** (scaffolded), hands the **coding** step the file tools and the
  **testing** step the command/test tools — so with a real model key, a run genuinely *writes files and runs
  tests* instead of just describing them.
- **Why it matters:** this is the "describe → do" moment for the whole platform. Up to now the agents could
  reason but not act; from here a build request produces actual edited files in an isolated workspace and a
  real test run, with a **change set** (the diff) captured for the PR. It closes the Sandbox Tools epic.
- **How it works (plain words):** a small worker-side bridge (`createSandboxWorkspace`) provisions a sandbox
  per run, fills it (HELIX-164), and keeps a registry mapping the run's workspace to its sandbox. It returns
  the two halves the executor asks for — a **factory** (provision/populate/dispose, with the change set logged
  on teardown) and a **tools** map (coding tools for the coding role, testing tools for the testing role).
  The dev worker drops its old empty-tools + bare-temp-dir setup for this pair, still wrapped in the run-scoped
  provider (HELIX-161). Offline (no key) the agents finish on canned text with the tools simply unused; set
  `ANTHROPIC_API_KEY` and they actually use them.
- **Where it lives:** `@helix/workflow` — [sandbox-workspace.ts](../libs/workflow/src/lib/sandbox-workspace.ts)
  (`createSandboxWorkspace` + `populateSpecFromConfig`) and the rewired
  [dev worker](../libs/workflow/src/dev-worker.ts), bridging `@helix/executor`'s workspace seams to
  `@helix/sandbox` + the coding/testing tools (HELIX-162/163) + populate (HELIX-164). 5 new integration tests
  (scaffold + bind, shared-sandbox reuse, role/unknown-workspace tool gating, change-set capture on release);
  workflow suite (72) green. **Closes the Sandbox Tools & Repo Checkout epic.**

---

## Epic: Real GitHub + Secrets/KMS bindings (HELIX-166)  ✅ done

Forward scope after the Sandbox Tools epic: bind three deferred seams to their real cloud services so runs act
on **real GitHub repos** with **real credentials** — a live Octokit GitHub client + runnable MCP server
(DEFERRED #1), the live GitHub onboarding verifier (#14), and the AWS Secrets Manager / KMS adapter (#2). Every
adapter ships **config-gated + mock-tested** so CI stays offline-green; live smoke tests stay manual. Full
plan: [GITHUB_SECRETS_PLAN.md](GITHUB_SECRETS_PLAN.md).

### Story: GitHub + Secrets/KMS real adapters  ✅ done

#### HELIX-168 — Real Octokit GitHub client  ✅
- **What it is:** the real client that actually talks to GitHub — reading files, listing trees, searching
  code, creating branches, committing files, opening PRs, commenting, requesting reviews. Until now those
  operations existed only against a **stub** used in tests.
- **Why it matters:** it's the concrete thing that lets a run push its work to a real repo and open a real PR.
  The tools were all built against a `GitHubClient` interface (HELIX-86/87/88); this fills that interface in
  for real, so nothing else has to change to go live.
- **How it works (plain words):** to avoid dragging Octokit's ESM-only package into the test build, the client
  takes an **injected** "Octokit-like" object (just the calls it needs) — the real Octokit is built later at
  the entry point (HELIX-169) and passed in; tests pass a tiny fake. The fiddly bit is committing several
  files at once: GitHub's low-level Git Data API needs a five-step dance (find the branch's current commit →
  its file tree → build a new tree with the changed files → make a commit → move the branch to it), which the
  client does atomically.
- **Where it lives:** `@helix/github-mcp` — [octokit-client.ts](../libs/github-mcp/src/octokit-client.ts)
  (`OctokitGitHubClient` + the `OctokitLike` seam + `createOctokitGitHubClient`), over the existing
  [github-client.ts](../libs/github-mcp/src/github-client.ts) interface. No new dependency (Octokit is
  injected, installed at the entry point in HELIX-169). 12 new tests (read decode, tree mapping + filter,
  search scoping, branch resolution, the full commit dance, PR/comment/review); github-mcp suite (35) green.

#### HELIX-169 — Runnable stdio MCP server entrypoint  ✅
- **What it is:** the actual **launchable program** for the GitHub MCP server. Until now the server existed as
  a function; this is the entrypoint that builds a real, authenticated GitHub client and serves the tools over
  **stdio**, so the MCP registry can start it as a live process.
- **Why it matters:** it turns the GitHub client (HELIX-168) from a class into something that *runs*. This is
  the composition root where the real Octokit + the GitHub App auth come together — the first runnable that
  talks to real GitHub.
- **How it works (plain words):** it reads the GitHub App credentials from the environment, builds an Octokit
  that fetches a fresh short-lived installation token before every request (so nothing long-lived is held),
  wraps it in the `OctokitGitHubClient`, and connects the MCP server to stdio. Octokit is ESM-only, so it's
  loaded with a dynamic `import()` — which keeps the rest of the lib plain-CJS and test-friendly (verified the
  entry boots: missing creds fail fast with a clear message; with creds it reaches "server ready"). Added a
  `pnpm github-mcp:stdio` run target. The first real dependency of the epic — `@octokit/rest` — lands here,
  and only here (the entry isn't exported, so no consumer pulls it in).
- **Where it lives:** `@helix/github-mcp` — [stdio-server.ts](../libs/github-mcp/src/stdio-server.ts), over the
  existing [server.ts](../libs/github-mcp/src/server.ts) + [app-auth.ts](../libs/github-mcp/src/app-auth.ts)
  (`GitHubAppTokenProvider`) + the HELIX-168 client; `github-mcp:stdio` script in `package.json`. Composition
  glue (untested like the dev worker; the pieces it wires are each covered). github-mcp suite (35) stays green.

#### HELIX-170 — Live GitHub connection verifier  ✅
- **What it is:** makes the GitHub onboarding **health check** real. The "test connection" button
  (`POST /api/integrations/github/test`) can now actually prove an org's GitHub install still works — by
  minting a real installation token — instead of always answering "not configured".
- **Why it matters:** it's the trust check for onboarding: before a run tries to push to a repo, the platform
  can confirm it still has access. Combined with the GitHub client (HELIX-168/169), the GitHub side of the
  epic is now genuinely live (when an App is configured).
- **How it works (plain words):** the verifier was a swappable seam with an honest "not configured" default.
  The new live verifier, given an installation id, signs a short-lived App token and exchanges it for an
  installation token against GitHub (reusing the App-auth code from HELIX-89, so the private key never
  leaves the process); success → `verified` (with the token's expiry), any failure → a clean `error`. It's
  **config-gated**: a factory returns the live verifier when the App credentials are in the environment, else
  the unconfigured default — so CI (no creds) keeps reporting `not_configured`. To avoid dragging the MCP SDK
  into the orchestrator, it imports just the App-auth module via a narrow `@helix/github-mcp/app-auth` subpath.
- **Where it lives:** `apps/orchestrator` — [github.verify.ts](../apps/orchestrator/src/integration/github.verify.ts)
  (`AppCredentialsGithubVerifier` + `githubVerifierFromEnv`), wired in
  [integration.module.ts](../apps/orchestrator/src/integration/integration.module.ts); subpath mapping added to
  `tsconfig.base.json` + the orchestrator jest config. 5 new tests (verified-with-expiry, failure→error, the
  env gating); orchestrator integration suite green, production build resolves the subpath (no MCP SDK pulled in).

#### HELIX-171 — AWS KMS adapter  ✅
- **What it is:** a version of the secrets vault's "master key" that lives in **AWS KMS** instead of in the
  app's memory. The vault encrypts each secret under a one-time data key; this asks KMS to mint and unwrap
  those data keys, so the real master key never leaves AWS.
- **Why it matters:** it's the production-grade home for the master key. The GitHub App private key and other
  credentials are stored encrypted; backing the vault with KMS means a compromised app process can't reveal the
  master key. It's a **drop-in swap** — because the envelope shape matches the local version exactly, nothing
  that uses secrets has to change.
- **How it works (plain words):** `AwsKms` implements the same `KeyManagementService` interface as the local
  one. `generateDataKey` calls KMS for a fresh AES-256 key (returned in the clear for immediate use, plus a
  KMS-wrapped copy to store); `decryptDataKey` asks KMS to unwrap a stored one. It's **config-gated**: the
  orchestrator uses KMS when `AWS_KMS_KEY_ID` is set, else the local key — so CI (no AWS) keeps working. Tested
  fully offline with `aws-sdk-client-mock` (no real AWS), including a complete encrypt→store→decrypt round-trip
  through the real `EncryptedSecretStore` to prove the swap is transparent.
- **Where it lives:** `@helix/secrets` — [aws-kms.ts](../libs/secrets/src/aws-kms.ts) (`AwsKms` +
  `awsKmsFromEnv`), kept out of the barrel and imported via a narrow `@helix/secrets/aws-kms` subpath so the
  AWS SDK only loads where it's wired; gated into the vault in
  [integration.module.ts](../apps/orchestrator/src/integration/integration.module.ts). 6 new tests; secrets
  suite (40) green; orchestrator build bundles the (CJS) AWS SDK cleanly.

#### HELIX-172 — AWS Secrets Manager record store  ✅
- **What it is:** the place the vault *stores* its encrypted secrets, swapped from an in-memory map to **AWS
  Secrets Manager** — so credentials survive restarts and live in managed storage instead of process memory.
- **Why it matters:** it's the other half of the production secrets home (HELIX-171 did the key, this does the
  storage). Together they make the vault real: the master key in KMS, the encrypted records in Secrets Manager,
  with the GitHub App key and other credentials safe across the platform.
- **How it works (plain words):** it implements the same `SecretRecordRepository` interface (get / put / delete
  / list) over Secrets Manager. Each record becomes one Secrets Manager secret named `helix/<scope>/<name>`,
  with the encrypted blob + wrapped key stored as the secret's JSON value; `put` creates it (or updates in place
  if it already exists), `list` filters by the scope prefix. It's **config-gated** by `USE_AWS_SECRETS_MANAGER`,
  so CI keeps using the in-memory repo. Tested fully offline with `aws-sdk-client-mock`, including a stateful
  set→get round-trip through the real `EncryptedSecretStore` to prove the swap is transparent. **Closes the
  Real GitHub + Secrets/KMS epic.**
- **Where it lives:** `@helix/secrets` — [aws-secrets-store.ts](../libs/secrets/src/aws-secrets-store.ts)
  (`SecretsManagerSecretRecordRepository` + `secretsManagerRepoFromEnv`), kept out of the barrel and imported
  via the `@helix/secrets/aws-secrets-store` subpath; gated into the vault in
  [integration.module.ts](../apps/orchestrator/src/integration/integration.module.ts). 8 new tests; secrets
  suite (48) green; orchestrator build bundles both AWS SDKs cleanly.

---

## Epic: Frontend web app (React) (HELIX-173)  🛠️ in progress

Forward scope after the GitHub + Secrets/KMS epic: the **first user-facing app** — a React SPA in `apps/web`
over the platform's already-tested APIs (sign-in → submit a request → watch the agents run it live → see
artifacts; plus the approval inbox and the GitHub connect wizard). HELIX-11 was built API-first; this is the
screens. Webpack + Jest (repo-consistent); component tests with a mocked `fetch` keep CI offline. Full plan:
[FRONTEND_PLAN.md](FRONTEND_PLAN.md).

### Story: The web app  🛠️ in progress

#### HELIX-175 — React app scaffold + shell + API client + auth context  ✅
- **What it is:** the skeleton of the web app — the project itself, the page frame (header + navigation), the
  one helper that talks to the backend, and the "who's signed in" memory. No real screens yet; this is the
  floor every screen stands on.
- **Why it matters:** a frontend needs a consistent foundation before screens — how it calls the API, how it
  remembers your session, how it keeps you out of pages you're not signed in for. Building this once, well,
  means the next four sub-tasks are just *screens* over it.
- **How it works (plain words):** a React app (generated with Nx, built with webpack, tested with Jest like
  the rest of the repo). A small **API client** wraps `fetch` — it adds the server address, attaches your
  session token to every call, and turns errors into clean failures. An **auth context** holds your session
  (in memory + the browser's local storage), signs you in by exchanging a token, restores you on refresh, and
  signs you out; a **`RequireAuth`** guard bounces you to the sign-in page if you're not logged in. The **shell**
  is the top bar + nav that wraps every page. The four screens are placeholders for now (one per upcoming
  sub-task). Run it with `pnpm exec nx serve web` (talks to the orchestrator on `:3100`).
- **Where it lives:** `apps/web` — [api/client.ts](../apps/web/src/api/client.ts),
  [auth/auth-context.tsx](../apps/web/src/auth/auth-context.tsx), [app/app.tsx](../apps/web/src/app/app.tsx) +
  [app/layout.tsx](../apps/web/src/app/layout.tsx); CI gained typecheck + build + test steps for `web`. 12 new
  tests (client, auth context, shell) with a mocked `fetch` — fully offline; web suite (12) green.

#### HELIX-176 — Sign-in screen (dev sign-in) + protected routes  ✅
- **What it is:** the actual **log-in page**. You enter an email, an organization, and a role, click sign in,
  and you're in — with the rest of the app gated behind it.
- **Why it matters:** nothing in the app is reachable without a session, so this is the front door. It also
  solves a practical local problem: there's no real identity provider running, so the browser can't produce a
  proper login token on its own.
- **How it works (plain words):** the browser can't safely mint a sign-in token (that needs a secret it
  shouldn't hold), so the orchestrator gained a small **dev-only** endpoint — `POST /api/auth/dev-login` — that
  takes an email/org/role, mints a stand-in token server-side, and exchanges it for a real Helix session (the
  exact same path a real identity-provider token would take). It's switched **off in production** (returns 403
  unless explicitly opted in). The page calls it, stores the session, and sends you to the dashboard; an
  already-signed-in visitor skips straight past. A real OIDC redirect stays deferred (DEFERRED #12).
- **Where it lives:** orchestrator — [auth.controller.ts](../apps/orchestrator/src/auth/auth.controller.ts)
  (`POST /auth/dev-login`, guarded) + the shared OIDC config extracted in
  [auth.module.ts](../apps/orchestrator/src/auth/auth.module.ts); web —
  [pages/sign-in.tsx](../apps/web/src/app/pages/sign-in.tsx) + `signInWithDevLogin` on the
  [auth context](../apps/web/src/auth/auth-context.tsx). 5 new tests (3 backend: mint+exchange, roles override,
  403 in production; 2 frontend: sign-in → dashboard, error on rejection); orchestrator (108) + web (14) green.

#### HELIX-177 — Request submission + live run dashboard (SSE)  ✅
- **What it is:** the heart of the app — a page to **submit a build request** (a title + what to build) and a
  page that shows that run **happening live**: each pipeline step lighting up as the agents work, plus the
  artifacts (PR link, test results, deploy URL) as they appear.
- **Why it matters:** this is the moment the whole platform becomes *watchable*. Everything built so far — the
  durable workflow, the agents, the executor — finally has a face: you type what you want, hit submit, and
  watch plan → code → review → test → deploy progress in real time.
- **How it works (plain words):** the dashboard lists your requests (each with its run status) and has a submit
  form; submitting starts a run and jumps to its detail page. The detail page loads the run's status +
  artifacts, then **subscribes to a live feed** of per-step progress. Browsers' built-in live-feed reader
  (`EventSource`) can't send the login token, so the app reads the stream with `fetch` instead — same effect,
  but authenticated. As progress events arrive, the step list updates; when the run finishes, the status and
  artifacts refresh.
- **Where it lives:** web — [pages/dashboard.tsx](../apps/web/src/app/pages/dashboard.tsx) +
  [pages/run-detail.tsx](../apps/web/src/app/pages/run-detail.tsx) + a
  [status badge](../apps/web/src/app/components/status-badge.tsx); the auth-aware SSE reader
  (`streamEvents`) + shared [types](../apps/web/src/api/types.ts) on the
  [API client](../apps/web/src/api/client.ts). 5 new tests (SSE frame parsing, list + submit→navigate, the live
  run view) with a mocked `fetch`/stream; web suite (19) green.

#### HELIX-178 — Approval inbox  ✅
- **What it is:** the **approver's to-do list** — the human sign-off gate, on screen. Each pending request
  shows what needs approval, who asked and why, how many approvals it still needs and its time limit, with
  approve / reject buttons.
- **Why it matters:** the pipeline pauses for a human before risky actions (e.g. a deploy). The approval logic
  + APIs existed; this gives a person a place to actually *see and act on* those gates — closing the loop from
  "the run is waiting" to "approved, carry on."
- **How it works (plain words):** the page loads your inbox (most-urgent first), and each card lets you pick
  which approver role you're acting as (from the roles still awaiting a vote), add an optional comment, and
  approve or reject. Submitting records the decision for you; once enough approvals land, the backend resumes
  the gated run. The inbox refreshes after each vote, so resolved items drop off.
- **Where it lives:** web — [pages/approvals.tsx](../apps/web/src/app/pages/approvals.tsx) (`ApprovalInbox` +
  the per-request card), over `GET /api/approvals/inbox` and `POST /api/approvals/:id/decisions`; shared
  [types](../apps/web/src/api/types.ts). 2 new tests (list → decide → refresh; empty state); web suite (21) green.

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
- **Architecture-diagram upkeep** (PR #43) — [ARCHITECTURE.md](ARCHITECTURE.md) is now kept
  current the same way the dev log is: the `helix-pr` skill refreshes it inside each sub-task's PR
  when a component/wiring/status changes, and a SessionStart drift hook
  (`.claude/hooks/check-architecture-drift.sh`) nags if any `libs/*` or `apps/*` component is
  missing from the diagram. Detect-and-remind only; the diagram is always updated by Claude.

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
| HELIX-80 | MCP client (handshake/discovery/invoke) | ✅ | #39 |
| HELIX-81 | MCP server registry + health checks | ✅ | #40 |
| HELIX-82 | MCP tool catalog sync (tools → runtime) | ✅ | #41 |
| HELIX-83 | Tool policy model + evaluator (allow/deny) | ✅ | #44 |
| HELIX-84 | Tool rate limiting + quotas (per tool/org) | ✅ | #45 |
| HELIX-85 | Approval-gated tool routing (risky → human) | ✅ | #46 |
| HELIX-86 | GitHub MCP server — repo read/search tools | ✅ | #47 |
| HELIX-87 | GitHub MCP server — branch/commit/push tools | ✅ | #48 |
| HELIX-88 | GitHub MCP server — PR + review-comment tools | ✅ | #49 |
| HELIX-89 | GitHub MCP server — GitHub App auth (installation tokens) | ✅ | #50 |
| HELIX-90 | Secrets vault — secrets manager (encrypted at rest, envelope encryption) | ✅ | #51 |
| HELIX-91 | Secrets vault — just-in-time credential injection (resolve at execution boundary) | ✅ | #52 |
| HELIX-92 | Secrets vault — trace/log redaction (scrub secrets from telemetry) | ✅ | #53 |
| HELIX-93 | Planning Agent — requirement extraction prompt + structured spec schema | ✅ | #54 |
| HELIX-94 | Planning Agent — ambiguity detection + clarification questions (confidence triage) | ✅ | #55 |
| HELIX-95 | Planning Agent — clarification loop (pause for answers, refine spec) | ✅ | #56 |
| HELIX-96 | Planning Agent — task decomposition prompt + task-graph schema | ✅ | #57 |
| HELIX-97 | Planning Agent — dependency ordering + validation (cycle detection, topo sort, waves) | ✅ | #58 |
| HELIX-98 | Planning Agent — tech-stack / scaffold selection | ✅ | #59 |
| HELIX-99 | Planning Agent — codebase context retrieval (plan grounding) | ✅ | #60 |
| HELIX-100 | Coding Agent — ephemeral sandbox provisioning (seam + local provider) | ✅ | #62 |
| HELIX-101 | Coding Agent — repo checkout + workspace mount (fetcher seam) | ✅ | #63 |
| HELIX-102 | Coding Agent — egress controls + resource limits (sandbox policy) | ✅ | #64 |
| HELIX-103 | Coding Agent — file edit tools (read/write/patch in sandbox) | ✅ | #65 |
| HELIX-104 | Coding Agent — scaffolding/templates (NestJS CRUD exemplar) | ✅ | #66 |
| HELIX-105 | Coding Agent — diff generation + commit grouping | ✅ | #67 |
| HELIX-106 | Coding Agent — build/lint runner in sandbox (command runner + checks) | ✅ | #68 |
| HELIX-107 | Coding Agent — error feedback to fix loop (diagnostic parse + re-prompt) | ✅ | #69 |
| HELIX-108 | Coding Agent — iteration budget + bail-out (self-correction loop) | ✅ | #70 |
| HELIX-109 | Coding Agent — branch creation + naming convention (helix/&lt;run-id&gt;/&lt;slug&gt;) | ✅ | #71 |
| HELIX-110 | Coding Agent — commit message generation (Conventional Commits) | ✅ | #72 |
| HELIX-111 | Code Review Agent — diff fetch + context assembly | ✅ | #73 |
| HELIX-112 | Code Review Agent — multi-aspect review prompts | ✅ | #74 |
| HELIX-113 | Code Review Agent — findings schema + severity model | ✅ | #75 |
| HELIX-114 | Code Review Agent — secret scan integration (gitleaks-style) | ✅ | #76 |
| HELIX-115 | Code Review Agent — inline + summary comment posting | ✅ | #77 |
| HELIX-116 | Code Review Agent — status check / merge gate (severity threshold) | ✅ | #78 |
| HELIX-117 | Testing Agent — test generation prompts per framework | ✅ | #79 |
| HELIX-118 | Testing Agent — acceptance-criteria to test mapping (traceability + coverage) | ✅ | #81 |
| HELIX-119 | Testing Agent — test runner in sandbox (framework detection + run) | ✅ | #82 |
| HELIX-120 | Testing Agent — result + coverage parser (normalized across frameworks) | ✅ | #83 |
| HELIX-121 | Testing Agent — test report artifact (structured + markdown) | ✅ | #84 |
| HELIX-122 | Testing Agent — failure diagnostics packaging (failing tests + stack traces) | ✅ | #86 |
| HELIX-123 | Testing Agent — re-invoke coding step + budget (test fix loop) | ✅ | #87 |
| HELIX-124 | Deployment Agent — Dockerfile/buildpack detection + build | ✅ | #88 |
| HELIX-125 | Deployment Agent — image push to ECR (login · tag · push) | ✅ | #89 |
| HELIX-126 | Deployment Agent — IaC deploy (CDK) for ECS/Lambda | ✅ | #90 |
| HELIX-127 | Deployment Agent — env/config + secrets wiring (vault refs) | ✅ | #91 |
| HELIX-128 | Approvals — approval policy model (gate rules · roles · SLAs) | ✅ | #92 |
| HELIX-129 | Approvals — policy admin API (versioned CRUD in registry) | ✅ | #93 |
| HELIX-130 | Approvals — approval request state machine (pending→approved/…) | ✅ | #94 |
| HELIX-131 | Approvals — decision API + workflow resume signal (orchestrator) | ✅ | #95 |
| HELIX-132 | Approvals — inbox read-API (rendered UI deferred to HELIX-11) | ✅ | #96 |
| HELIX-133 | Notifications — dispatch across slack/email/in-app channels | ✅ | #97 |
| HELIX-134 | Approvals — SLA escalation to backup approvers (sweep) | ✅ | #98 |
| HELIX-135 | Audit — append-only hash-chained event store | ✅ | #99 |
| HELIX-136 | Audit — query + NDJSON/CSV export + verify API | ✅ | #100 |
| HELIX-137 | Telemetry — OTel service bootstrap (tracer + exporter seam) | ✅ | #101 |
| HELIX-138 | Telemetry — OTLP exporter + Tempo/Prometheus/Grafana stack | ✅ | #102 |
| HELIX-139 | Telemetry — correlation IDs end-to-end (W3C trace context) | ✅ | #103 |
| HELIX-140 | Analytics — run success/latency/cost aggregation library | ✅ | #104 |
| HELIX-141 | Dashboards — provisioned Grafana run/cost + pipeline boards | ✅ | #105 |
| HELIX-142 | Auth — OIDC sign-in + Helix app sessions (`@helix/auth`) | ✅ | #106 |
| HELIX-143 | Tenancy — row-level org isolation (`@helix/tenancy`) + registry | ✅ | #107 |
| HELIX-144 | Auth — RBAC roles + `RolesGuard` enforcement (`@helix/auth`) | ✅ | #108 |
| HELIX-145 | Requests — submit→run API, org-scoped (`/api/requests`) | ✅ | #109 |
| HELIX-146 | Run dashboard API — overview + per-run status + live SSE | ✅ | #110 |
| HELIX-147 | Artifact views — PR/tests/deploy from run step outputs | ✅ | #111 |
| HELIX-148 | GitHub onboarding — App connect flow, vault-stored credential | ✅ | #112 |
| HELIX-149 | GitHub onboarding — connection health check (verify seam) | ✅ | #113 |
| HELIX-152 | Executor — role-dispatch seam (`@helix/executor`) | ✅ | #115 |
| HELIX-153 | Executor — AgentSpecResolver + default per-role specs | ✅ | #116 |
| HELIX-154 | Executor — generic runAgent-backed role executor + context flow | ✅ | #117 |
| HELIX-155 | Executor — planning + code_review role executors | ✅ | #118 |
| HELIX-156 | Executor — coding + testing role executors (sandbox) | ✅ | #119 |
| HELIX-157 | Executor — deployment role executor (build/deploy seam) | ✅ | #120 |
| HELIX-158 | Executor — worker wiring + config-driven LLM seam | ✅ | #121 |
| HELIX-159 | **Epic:** Sandbox Tools & Repo Checkout | ✅ | #123 (plan) |
| HELIX-161 | Run-scoped workspace + run-id threading | ✅ | #124 |
| HELIX-162 | Coding file-edit tools (sandbox-bound) | ✅ | #125 |
| HELIX-163 | Testing command + test-run tools | ✅ | #126 |
| HELIX-164 | Populate the workspace (scaffold / checkout) + change set | ✅ | #127 |
| HELIX-165 | Worker wiring — sandbox-backed workspace + tools | ✅ | #128 |
| HELIX-166 | **Epic:** Real GitHub + Secrets/KMS bindings | ✅ | #129 (plan) |
| HELIX-168 | Real Octokit GitHub client | ✅ | #130 |
| HELIX-169 | Runnable stdio MCP server entrypoint | ✅ | #131 |
| HELIX-170 | Live GitHub connection verifier | ✅ | #132 |
| HELIX-171 | AWS KMS adapter | ✅ | #133 |
| HELIX-172 | AWS Secrets Manager record store | ✅ | #134 |
| HELIX-173 | **Epic:** Frontend web app (React) | 🛠️ | #135 (plan) |
| HELIX-175 | React app scaffold + shell + API client + auth context | ✅ | #136 |
| HELIX-176 | Sign-in screen (dev sign-in) + protected routes | ✅ | #137 |
| HELIX-177 | Request submission + live run dashboard (SSE) | ✅ | #138 |
| HELIX-178 | Approval inbox | ✅ | — |
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

With the Core Agent Platform (HELIX-1) and Workflow Engine (HELIX-2) epics done, Helix can
define agents, run a tool-using agent loop within budget, remember/recall context, trace + cost
runs, and chain agents into durable, human-gated, retrying multi-step workflows you can drive and
watch over HTTP. The **MCP Integration Layer** (HELIX-3) is now ✅ done — **MCP Client & Server
Registry** (client HELIX-80, server registry + health checks HELIX-81, tool catalog sync HELIX-82),
**Tool Permissioning & Policy** (HELIX-23 — policy gate HELIX-83, rate limits/quotas HELIX-84,
approval routing HELIX-85), the **GitHub MCP Server** (HELIX-24 — read/search HELIX-86,
branch/commit HELIX-87, PR/review HELIX-88, behind GitHub App installation-token auth HELIX-89),
and the **Secrets & Credential Vault** (HELIX-25 — encrypted-at-rest secrets manager HELIX-90,
just-in-time credential injection HELIX-91, telemetry redaction HELIX-92). So Helix can now connect
to MCP tool servers under a policy/quota/approval gate, with credentials kept in a vault, injected
only at the call boundary, and scrubbed from traces. Two deferred bindings remain before this is
live against real services (see [../DEFERRED.md](../DEFERRED.md)): the **Octokit** client behind the
GitHub tools and the **AWS Secrets Manager/KMS** vault backend.

The **Planning Agent** (HELIX-4) — the first real agent — is now ✅ done too: it takes a plain-language
request and produces a validated requirements spec with a confidence-gated clarification loop
(HELIX-26), turns that into an implementation plan — a decomposed, dependency-ordered/validated task
graph plus a tech-stack + scaffold (HELIX-27) — and grounds it in the existing codebase (HELIX-28).
That plan is the input contract for the **Coding Agent**.

The **Coding Agent** (HELIX-5) is now ✅ done as well: it works in an **isolated sandbox** — provision,
repo checkout, egress/resource limits, and a real command runner (HELIX-29); **edits code** with
read/write/patch tools, scaffolds from templates, and turns the result into a diff split into logical
commits (HELIX-30); **builds, lints, and self-corrects** — running the checks, feeding the parsed
errors back, and looping under an iteration budget that escalates to a human if it can't get to green
(HELIX-31); and **lands the work** on a `helix/<run-id>/<slug>` branch with Conventional-Commits
messages (HELIX-32). So, given a plan, it produces compiling, lint-passing changes on a branch.

The **Code Review Agent** (HELIX-6) is now ✅ done too: it assembles the diff + surrounding code,
reviews it across **five aspects** (correctness, security, style, performance, plan-conformance) into
**structured findings with severity**, backstops the security pass with a deterministic **secret
scan**, and turns it all into **inline + summary PR comments** and a **severity-threshold merge gate**
(HELIX-33/34/35) — so it reviews the Coding Agent's changes and blocks or approves per policy.

The **Testing Agent** (HELIX-7) is now ✅ done as well: it generates tests **per framework** and maps
them to the spec's **acceptance criteria** (with a coverage check, HELIX-36); **detects** the framework,
**runs** the tests in the sandbox, and normalises results + coverage into a **report** (HELIX-37); and
on failure **packages the diagnostics + stack traces and loops them back to the Coding Agent under a
budget** until they pass or it escalates (HELIX-38). So the pipeline now runs **plan → code → review →
test**, end to end.

After that: the **Deployment Agent**, **human approvals**, **monitoring**, and the **user-facing SaaS**
(auth, run dashboard) — where all of this gets a UI. Note the coding/testing agents' *live* `git` and
test runs happen locally today; the **container/microVM sandbox** and the **Octokit** push / PR /
review-posting binding remain deferred (see [../DEFERRED.md](../DEFERRED.md)).

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
