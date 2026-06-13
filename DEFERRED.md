# Deferred Work — Registry

A living record of work we've **consciously postponed**, so it isn't lost between
sessions. The pattern across this codebase: ship a **testable seam + a local
implementation now**, and defer the heavyweight cloud / network / ESM binding
until it's actually needed (and testable). Each entry says what's deferred, why,
what's in place instead, what it'll take to land, the trigger to do it, and where
else it's tracked.

> **Maintenance:** add an entry here whenever you defer a cloud/heavy/ESM binding.
> When it's implemented, move it to the **Landed** section at the bottom.

---

## Open deferrals

### 1. Live Octokit GitHub client + runnable stdio server
- **Deferred from:** HELIX-89 (GitHub App auth) — merged in PR #50.
- **What's deferred:** a concrete `OctokitGitHubClient implements GitHubClient`
  that makes real HTTP calls to GitHub, plus a runnable **stdio** entrypoint
  (`StdioServerTransport`) so the MCP server registry can launch a live server.
- **In place instead:** the `GitHubClient` interface (the seam), every GitHub tool
  (read/search, branch/commit, PR/review — HELIX-86/87/88) built against it and
  unit-tested with a stub, and GitHub App auth → short-lived, repo-scoped
  installation tokens (HELIX-89, `libs/github-mcp/src/app-auth.ts`).
- **To land:** ~one PR, Medium. Inject Octokit so the lib stays ESM-free and
  mock-testable; authenticate via `GitHubAppTokenProvider`; the atomic multi-file
  commit (Git Data API: ref → base commit → blobs → tree → commit → move ref) is
  the fiddly part; add the stdio entry + a run target; mock tests **plus** one
  live smoke test against a throwaway GitHub App + sandbox repo.
- **Trigger / sequencing:** do it as part of / right after **HELIX-25** (Secrets
  Vault), so the App private key is sourced from the vault, not loose env vars.
- **Also tracked:** comment on HELIX-25; `docs/DEVELOPMENT_LOG.md` (HELIX-89
  "Still to wire" note).

### 2. Real AWS Secrets Manager / KMS adapter
- **Deferred from:** HELIX-90 (Secrets manager integration) — in progress.
- **What's deferred:** backing the secrets vault with **AWS Secrets Manager**
  (`@aws-sdk/client-secrets-manager`) for storage and **AWS KMS**
  (`@aws-sdk/client-kms`) for the master key.
- **In place instead:** `@helix/secrets` — a `SecretsManager` seam + an
  envelope-encrypted **local** store (AES-256-GCM via Node `crypto`) + `LocalKms`
  (a master key wraps per-secret data keys) + a redaction-safe `SecretValue` type.
  Delivers the story's "encrypted at rest" guarantee, fully offline-tested.
- **To land:** a drop-in swap of two interfaces — `LocalKms → AwsKms`, and the
  in-memory record repo → Secrets Manager — with **no change to secret consumers**,
  because the local store already uses AWS's envelope-encryption shape.
- **Trigger / sequencing:** when deploying to AWS (a real cloud env with KMS +
  Secrets Manager credentials available).
- **Also tracked:** HELIX-90 PR "Out of scope".

### 3. Real container / microVM sandbox backend
- **Deferred from:** HELIX-100 (Ephemeral sandbox provisioning) — in progress.
- **What's deferred:** provisioning sandboxes as **isolated containers / microVMs**
  (Firecracker / Fargate / Docker) for true process, network, and resource
  isolation. (The ticket itself flags this as an L-sized, high-risk infra spike.)
- **In place instead:** `@helix/sandbox` — a `SandboxProvider` / `Sandbox` seam +
  `LocalSandboxProvider`, which provisions each sandbox as an ephemeral temp
  directory (create → track → dispose) with a path-escape guard. Real filesystem
  isolation + lifecycle, fully offline-tested; just not OS-level isolation.
- **To land:** implement `SandboxProvider` over a container/microVM runtime with
  no change to callers. The egress controls + resource limits (HELIX-102) define
  the isolation knobs that backend enforces.
- **Trigger / sequencing:** when the Coding Agent runs untrusted/agent-authored
  code for real (and when there's a host with the privileged runtime + cloud env).
- **Also tracked:** HELIX-100 PR "Out of scope".

### 4. Real deployment execution (Docker / ECR / CDK on AWS)
- **Deferred from:** HELIX-124 (Build & Artifact Packaging) — the Deployment Agent
  epic (HELIX-8) overall.
- **What's deferred:** actually running the build/deploy — `docker build` / `pack`
  (needs a Docker daemon), the live `aws ecr get-login-password` auth + `docker push`
  to **ECR** (needs AWS creds + a daemon), and the **CDK** deploy to ECS/Lambda —
  none of which can run in offline CI.
- **In place instead:** `@helix/deployment-agent` — pure detection + command/IaC
  generation + a runner-backed seam. HELIX-124 ships `detectBuildStrategy` +
  `buildCommand` + `runBuild(runner, …)`; HELIX-125 ships `ecrImageUri` +
  `ecrPushCommands` (login → tag → push) + `pushImageToEcr(runner, …)`; HELIX-126
  ships `synthesizeCdkApp` (the CDK app files for an ECS/Lambda stack) +
  `cdkDeployCommand` + `runCdkDeploy(runner, …)` (parsing the live URL); HELIX-127
  ships `resolveDeployEnv` + `checkDeploySecrets` + the secret-**reference** wiring
  (env/config plus Secrets Manager refs in the synthesized IaC, never values). The
  *commands and generated IaC* are real and run through the same `@helix/sandbox`
  `CommandRunner`, only the daemon/cloud execution is stubbed in tests.
- **To land:** point `runBuild` / `pushImageToEcr` / `runCdkDeploy` at a host with
  Docker + the AWS CDK CLI + AWS credentials; no change to the synth/command logic.
  The secret *references* resolve against real **AWS Secrets Manager** — which is
  deferral #2 above (the local vault stands in until then).
- **Trigger / sequencing:** when deploying the demo stack to a real AWS account.
- **Also tracked:** HELIX-124 / HELIX-125 / HELIX-126 / HELIX-127 PR "Out of scope".

### 5. Durable approval-request persistence
- **Deferred from:** HELIX-131 (Decision API + workflow signal) — in progress.
- **What's deferred:** persisting open approval requests in a **database** so they
  survive an orchestrator restart and are queryable across instances / for audit.
- **In place instead:** an `ApprovalRequestStore` seam + an `InMemoryApprovalRequestStore`
  in the orchestrator. The *durable* part of the gate already lives in Temporal (the
  run is paused on `awaitApproval`), so an orchestrator restart loses the in-flight
  request record but not the paused run; a decision can still be delivered. The
  decision → `submitApprovalDecision` signal → resume path is fully real.
- **To land:** implement `ApprovalRequestStore` over a DB (Prisma, like the registry)
  with no change to the service — likely folded in with the audit log (HELIX-44,
  `HELIX-135` append-only store), which needs durable approval history anyway.
- **Trigger / sequencing:** when the approval inbox (HELIX-132) / audit log (HELIX-44)
  needs requests to outlive a process, or the orchestrator runs multi-instance.
- **Also tracked:** HELIX-131 PR "Out of scope".

### 6. Rendered approval inbox UI
- **Deferred from:** HELIX-132 (Approval inbox UI) — the repo has no frontend app yet.
- **What's deferred:** the actual **rendered, clickable inbox** (a web page where an
  approver sees pending requests and clicks approve/reject).
- **In place instead:** the inbox **read-model + API** — `buildInbox` / `toInboxItem`
  in `@helix/approvals` (pending requests with quorum progress, SLA-remaining, decided/
  awaiting roles, most-urgent-first) exposed at `GET /approvals/inbox?role=` on the
  orchestrator. A UI is then a thin client over this endpoint + the decision API
  (`POST /approvals/:id/decisions`) from HELIX-131.
- **To land:** build the frontend as part of the **SaaS Platform** epic (HELIX-11),
  which owns the user-facing app + its build tooling; the inbox view binds to the
  endpoint above.
- **Trigger / sequencing:** HELIX-11 (the front-end epic).
- **Also tracked:** HELIX-132 PR "Out of scope".

### 7. Live Slack / email notification transports
- **Deferred from:** HELIX-133 (Notification dispatch) — in progress.
- **What's deferred:** the **real** Slack (incoming-webhook / Web API) and email
  (SMTP / SES) senders that actually transmit a notification off-box.
- **In place instead:** `@helix/notifications` — the channel seam
  (`NotificationSender` per channel) + a `NotificationDispatcher` that routes
  recipients and collects per-recipient results, a **real in-app sender** (writes to
  an inbox feed the orchestrator exposes at `GET /notifications`), and a
  `RecordingNotificationSender` standing in for `slack` / `email` (records what would
  be sent). The orchestrator wires all three; swapping in live senders is a
  provider change with no caller impact.
- **To land:** implement `NotificationSender` for `slack` (POST to a webhook) and
  `email` (SMTP/SES) — both need network egress + secrets (webhook URL / SMTP creds
  from the vault, [[project_deferred_registry]] · #2 AWS Secrets Manager). Also a
  durable in-app inbox (currently in-memory, like the approval store · #5).
- **Trigger / sequencing:** when running in an env with outbound network + the
  channel credentials in the secrets vault.
- **Also tracked:** HELIX-133 PR "Out of scope".

### 8. Automatic SLA escalation scheduler
- **Deferred from:** HELIX-134 (SLA timers + escalation) — in progress.
- **What's deferred:** the **timer** that periodically drives the escalation sweep
  (so requests escalate/expire on their own, without an external nudge).
- **In place instead:** the sweep itself is real — `escalationDue` / `escalateRequest`
  in `@helix/approvals` plus `ApprovalService.escalateDue(beforeExpiryMinutes)` on the
  orchestrator (expire past-SLA requests, escalate the ones in the pre-expiry window
  to their backup approvers + notify them, once each). It's invoked on demand via
  `POST /approvals/escalate-due`; a scheduler just needs to call it on a cadence.
- **To land:** drive `escalateDue` from a periodic trigger — a Temporal cron/timer
  workflow (we already run on Temporal · [[project_temporal_durable_execution]]) or a
  Nest `@Interval`/scheduler — with the lead-time + cadence configurable.
- **Trigger / sequencing:** when approvals run unattended (no operator/UI poking the
  endpoint) and need hands-off escalation.
- **Also tracked:** HELIX-134 PR "Out of scope".

### 9. Durable append-only audit store
- **Deferred from:** HELIX-135 (Append-only audit store) — in progress.
- **What's deferred:** persisting the audit log in **durable storage** so the
  approval history survives restarts and is shared across instances.
- **In place instead:** `@helix/audit` — an `AuditLog` seam + a hash-chained
  `InMemoryAuditLog`. Every event links to the prior one by a SHA-256 chain
  (`verifyChain` is tamper-evident), and the store is strictly append-only. The
  orchestrator records every approval lifecycle event (opened / decision /
  escalated / expired / cancelled) through it.
- **To land:** implement `AuditLog` over an **append-only DB table** (Prisma, like
  the registry) — insert-only, no update/delete grants — carrying the `prevHash` /
  `hash` columns so the chain is verifiable in storage. Pairs with the deferred
  durable approval-request store (#5) and the AWS Secrets/KMS work (#2) if the chain
  is anchored/signed. The query + export API is HELIX-136.
- **Trigger / sequencing:** when approval history must outlive a process / be
  audited for real (compliance), or the orchestrator runs multi-instance.
- **Also tracked:** HELIX-135 PR "Out of scope".

### 11. Live run-analytics data source
- **Deferred from:** HELIX-140 (Run analytics aggregation) — in progress.
- **What's deferred:** the **source of finished-run records** the analytics
  aggregators run over — listing real runs (from Temporal's execution history
  and/or a persisted runs table) and joining each run's cost from the token-usage
  rollup, then exposing the rollups over HTTP for the dashboards.
- **In place instead:** `@helix/analytics` — pure, source-agnostic aggregators
  (`aggregateRuns` / `aggregateRunsBy` / `bucketRunsDaily`: success rate, latency
  percentiles, cost) plus a `RunAnalyticsSource` seam and an
  `InMemoryRunAnalyticsSource`. `runOutcomeFromStatus` already maps Temporal status
  names → outcomes, so wiring is a thin adapter, not new math.
- **To land:** implement `RunAnalyticsSource` over `client.workflow.list()` (map each
  `WorkflowExecutionInfo` → `RunRecord`, cost via `TokenUsageRollupService.byRun`),
  or over a runs table if/when runs are persisted; then **publish the rollups as
  Prometheus metrics** so the dashboards light up. The **Helix Runs & Cost** Grafana
  dashboard (HELIX-141) already queries a fixed metric contract — the exporter just
  has to emit it:
  - `helix_runs_total{outcome="completed|failed|cancelled|terminated|timed_out"}` (counter)
  - `helix_run_latency_ms_bucket` / `_sum` / `_count` (histogram, for p50/p95)
  - `helix_run_cost_usd_total` (counter)
- **Trigger / sequencing:** HELIX-141 (the dashboards) is done and ships the contract;
  this is the producer that fills it.

### 12. Real OIDC provider (Auth0 / Cognito) verification
- **Deferred from:** HELIX-142 (Auth + session) — in progress.
- **What's deferred:** verifying ID tokens against a **real hosted IdP** — OIDC
  discovery + the provider's rotating **JWKS** with **RS256** signatures (Auth0,
  Cognito, …), and the browser-facing OAuth redirect/PKCE login itself.
- **In place instead:** `@helix/auth` — an `OidcVerifier` seam with a
  `StaticKeyOidcVerifier` (symmetric **HS256** stand-in that checks signature +
  `iss`/`aud`/`exp`), a dependency-free HS256 JWT impl (`node:crypto`), and a
  `SessionService` that exchanges a verified ID token for a Helix app session. The
  orchestrator wires it as `AuthModule` + `/auth/session` + guarded `/auth/me`.
- **To land:** implement an `OidcVerifier` that fetches the issuer's JWKS and
  verifies RS256 (e.g. with `jose`), wired by env (`AUTH_OIDC_ISSUER` /
  `AUTH_OIDC_AUDIENCE`, JWKS from discovery) — a one-line provider swap in
  `AuthModule`, nothing downstream changes. Real signing secrets come from the
  vault (#2), not the dev fallbacks. Tenant isolation (HELIX-143) and RBAC
  enforcement (HELIX-144) build on the `AuthPrincipal` this produces.
- **Trigger / sequencing:** when sign-in must work against a real IdP / in a
  deployed environment.

### 13. Request → planning-driven workflow, durable store & submission UI
- **Deferred from:** HELIX-145 (Request submission UI + API) — in progress.
- **What's deferred:** (a) turning a request's free-text `prompt` into a **custom
  workflow** via the Planning Agent (`@helix/planning` → spec → task DAG → workflow)
  — it needs the LLM, which CI can't call; (b) a **durable** request store; (c) the
  rendered **submission form / list UI** (the API-first decision for the SaaS epic).
- **In place instead:** `POST/GET /api/requests` (auth-guarded, org-scoped) that
  records a `BuildRequest` and starts a run from the **standard delivery pipeline**
  (plan→code→review→test→deploy) — or an explicit workflow override — reusing the
  run service (so it gets a W3C trace id). An `InMemoryRequestStore` seam holds the
  records.
- **To land:** swap `requestToWorkflow` for a planning-backed generator (behind the
  agent/LLM seam); implement `RequestStore` over a DB (pairs with the orchestrator's
  other in-memory seams — approvals); build the UI (the run dashboard is HELIX-146,
  artifacts HELIX-147). The rendered approval inbox (#6) lands in the same UI push.
- **Trigger / sequencing:** HELIX-146 / HELIX-147 (the dashboard + artifact views)
  consume this API; the UI push delivers the screens.

---

## Why we defer (the rule)

Our CI is **offline-first** — it can't reach real cloud services or hold cloud
credentials, and heavyweight/ESM SDKs add build friction. So when a piece needs
live cloud/network access to be meaningful, we build the **seam + a local,
testable implementation now** and bind the real service later. This keeps every
merge green and testable while leaving a clean drop-in point. (Same reasoning that
shaped the Temporal handling and the GitHub auth.)

---

## Landed (deferrals that have since been implemented)

### ~~10. OTLP exporter + OpenTelemetry Collector~~ → landed in HELIX-138
- **Was deferred from:** HELIX-137 (OTel SDK + collector).
- **What landed:** `exporterFromEnv` now returns an `OTLPTraceExporter` when
  `OTEL_TRACE_EXPORTER=otlp` or `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and the
  backend exists as a committed, runnable-locally compose stack —
  [observability/](observability/): OTel Collector → **Tempo** (traces) +
  **Prometheus** (metrics), browsed in **Grafana** (datasources pre-provisioned).
  Verified live end-to-end (span → OTLP → collector → Tempo search). CI still
  never runs the stack; it's a dev/deploy concern, started on demand
  (docs/LOCAL_TESTING.md §3).
- **Still open elsewhere:** running the stack in a *deployed* environment rides
  on the deployment deferral (#4); OTLP **logs** have no producer yet (the
  collector's logs pipeline is a debug placeholder).
