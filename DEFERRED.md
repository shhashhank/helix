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

_(none yet)_
