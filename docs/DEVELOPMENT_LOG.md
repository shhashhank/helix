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

## Epic: Code Review Agent  🛠️ in progress

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

### Story: Review Posting & Merge Gate  🛠️ in progress

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

After that: the remaining **agents** (review/testing/deploy), **human approvals**, **monitoring**, and
the **user-facing SaaS** (auth, run dashboard) — where all of this gets a UI. Note the coding agent's
*live* `git`/checks run locally today; the **container/microVM sandbox** and the **Octokit** push/PR
binding remain deferred (see [../DEFERRED.md](../DEFERRED.md)).

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
