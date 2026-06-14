# Plan: Real GitHub + Secrets/KMS bindings

> **Status:** planned (forward scope — after the Sandbox Tools epic, HELIX-159).
> **Jira:** Epic [HELIX-166] → Task [HELIX-167] → sub-tasks HELIX-168…HELIX-172.

## Goal

Bind three deferred seams to their real cloud services so runs can act on **real GitHub repos** with **real
credentials**: a live Octokit GitHub client + a runnable MCP server (DEFERRED #1), the live GitHub onboarding
verifier (DEFERRED #14), and the AWS Secrets Manager / KMS adapter for the vault (DEFERRED #2). See
[REMAINING_WORK.md](REMAINING_WORK.md) Theme C.

## The discipline: offline-CI-green, live-tested by hand

Our CI is **offline-first** — no cloud credentials, no network to AWS/GitHub at test time. So every adapter
here ships **behind its existing seam**, **unit-tested with a mocked SDK** (a mocked Octokit-like client;
`aws-sdk-client-mock` for the AWS SDK), and is **config-gated** (real impl when configured, the current local
stand-in otherwise). The genuinely live checks — a real GitHub App hitting GitHub, a real KMS/Secrets Manager —
are **documented manual smoke tests**, not CI. This is the same rule that shaped Temporal and the GitHub auth
(`DEFERRED.md` → "Why we defer").

**ESM note:** Octokit is ESM-only. To keep the libs CJS/Jest-friendly we **inject an Octokit-like interface**
into the client and construct the real Octokit only at the composition root (the stdio entry / worker) — never
import Octokit into a unit-tested lib (`DEFERRED.md` #1).

## What already exists (so this is binding, not building)

- **`@helix/github-mcp`** — the `GitHubClient` **seam** with every tool built + stub-tested
  (read/search/branch/commit/PR/review, HELIX-86/87/88); `GitHubAppTokenProvider` + `createAppJwt` +
  `fetchInstallationTokenExchanger` (App JWT → short-lived installation token, HELIX-89); and
  `createGitHubMcpServer(...)` — everything **except** a concrete client + a runnable stdio entry.
- **`@helix/secrets`** — the `KeyManagementService` seam + `LocalKms` (AES-256-GCM envelope encryption in the
  AWS shape) + the encrypted secret store + record repo. A real AWS swap is **two interface implementations,
  no consumer changes**.
- **Orchestrator integration** — the full GitHub connect API + a `GithubConnectionVerifier` **seam**
  (`UnconfiguredGithubVerifier` default), storing the connection encrypted in the vault (HELIX-148/149).

## Sub-tasks (Jira, in order)

GitHub first (the product keystone — runs on real repos), then the AWS credential home.

| Ticket | Sub-task | Size |
|---|---|---|
| HELIX-168 | **Real Octokit GitHub client** — `OctokitGitHubClient implements GitHubClient` over an injected Octokit-like client; read/search/branch + the atomic multi-file commit (Git Data API: ref → base commit → blobs → tree → commit → move ref) + PR/review. Mock-tested. | L |
| HELIX-169 | **Runnable stdio MCP server** — a `StdioServerTransport` entrypoint + run target so the MCP registry can launch a live server, wiring `createGitHubMcpServer` with the real client + `GitHubAppTokenProvider` auth. | S |
| HELIX-170 | **Live GithubConnectionVerifier** — implement over `GitHubAppTokenProvider` (mint an installation token → `verified`; map failures to `error`), config-gated, wired into `POST /test`; optionally fetch the installation account on connect. | M |
| HELIX-171 | **AWS KMS adapter** — `AwsKms implements KeyManagementService` (`GenerateDataKey` / `Decrypt` via `@aws-sdk/client-kms`), injected client, `aws-sdk-client-mock` tests; config-gated (`AwsKms` when a key id is set, else `LocalKms`). | M |
| HELIX-172 | **AWS Secrets Manager record store** — back the secret record repo with Secrets Manager (`@aws-sdk/client-secrets-manager`), injected client, mock tests; config-gated. No change to secret consumers. | M |

## Open decisions (settle per sub-task)

- **Octokit shape:** inject a narrow `interface OctokitLike` (just the REST/GraphQL calls the client needs)
  rather than the full Octokit type — keeps the lib decoupled and the mock small.
- **Config gating:** a `*FromEnv` factory per adapter (mirrors `appTokenProviderFromEnv` / `providerFromEnv`):
  real when the relevant env (App creds / `AWS_KMS_KEY_ID` / Secrets Manager) is present, else the local default.
- **Token caching:** reuse `GitHubAppTokenProvider`'s existing caching; the verifier/client don't re-mint per call.

## What stays deferred (out of this epic)

- The **rendered connect wizard UI** — belongs to the frontend epic (Theme D), not here; this epic finishes the
  *API/verifier* side of onboarding.
- **Live smoke tests** (a throwaway GitHub App + sandbox repo; a real AWS account) — documented manual steps,
  run when deploying to a real environment; CI stays offline.
- The **container/microVM sandbox backend** (DEFERRED #3) and **real AWS build/deploy** (DEFERRED #4) — separate.
