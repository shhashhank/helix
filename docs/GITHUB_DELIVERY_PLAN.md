# Plan: Real GitHub PR delivery (close the run → PR loop)

> **Status:** planned (forward scope — after the Frontend epic, HELIX-173).
> **Jira:** Epic [HELIX-180] → Task [HELIX-181] → sub-tasks HELIX-182…HELIX-186.

## Goal

Make a finished run **actually open a pull request** on the connected repo with the changes the coding agent
produced — and show the **real** PR, test report, and change-set as the run's artifacts. Today a run writes
files + runs tests in a throwaway sandbox and the "PR / tests / deploy" artifacts are placeholders; this turns
*"request → files in a sandbox"* into *"request → a PR you can review and merge"* — the product's core promise.

## Why this is the required next step

It's the single highest-leverage gap, and **all the pieces already exist** — this epic *wires them together*:

- **`OctokitGitHubClient`** (HELIX-168) can `createBranch` → `commitFiles` → `createPullRequest` against a real repo.
- **`GitHubAppTokenProvider`** (HELIX-89/169) mints short-lived, repo-scoped installation tokens; the org's
  GitHub **connection** (installation id) is stored by the connect flow (HELIX-148/170).
- The sandbox **change-set diff** (HELIX-164, `captureWorkspaceDiff`) already knows exactly which files changed.
- The **artifacts API** + `RunArtifacts` (HELIX-147) and the frontend **run-detail** view (HELIX-177) already
  render `pullRequest` / `tests` / `deployment` — they just need real data.
- The **role + injected-runner** seam pattern (the deployment role's `DeploymentRunner`) is the template for a
  delivery role.

## Offline-CI discipline

The real `git`/GitHub push needs a real GitHub App + repo, so — like the GitHub epic — every piece ships
**behind the `GitHubClient` seam, mock-tested**, and is **config-gated**: delivery runs only when an App + the
org connection + a target repo are configured; otherwise the run completes exactly as it does today (no PR).
The one genuinely live check (push to a throwaway repo, open a PR) is a **documented manual smoke test**, not CI.

## Architecture

A **delivery step** runs after testing. A thin executor role calls an injected runner; the worker's real runner
captures the run's change-set and pushes it:

```
delivery role (executor)         →  GitHubDeliveryRunner.deliver(ctx)        [injected seam, like DeploymentRunner]
worker GitHubDeliveryRunner       →  1. look up the run's sandbox + baseline
                                     2. captureWorkspaceDiff → changed files
                                     3. deliverChangeSet(client, repo, files) → branch → commit → PR
authed client                     →  OctokitGitHubClient over an installation-scoped Octokit (App token)
artifacts                         →  delivery step output (PR) + testing output (report) → extractArtifacts → API → UI
```

## Sub-tasks (Jira, in order)

| Ticket | Sub-task | Size |
|---|---|---|
| HELIX-182 | **Deliver a change-set as a GitHub PR** — `deliverChangeSet({ client, repo, base, branch, files, message, pr })`: ensure branch from base → commit the changed files → open a PR; returns `{ number, url }`. Pure, over the `GitHubClient` seam, mock-tested. (Deletions handled or flagged.) | M |
| HELIX-183 | **Delivery role executor** — a `delivery` `StepExecutor` over an injected `GitHubDeliveryRunner` seam (mirrors `DeploymentRunner`); registered on the pipeline after testing. Offline-tested with a fake runner. | M |
| HELIX-184 | **Authenticated per-run GitHub client at the worker** — build an installation-scoped `OctokitGitHubClient` from the App creds (env) + the run's installation id (reuse `app-auth` + the dynamic-import Octokit pattern from HELIX-169); config-gated factory. | M |
| HELIX-185 | **Surface real run artifacts** — thread the delivery step's PR output + the testing step's report (+ change-set summary) through step outputs into `extractArtifacts`, so `GET /api/requests/:id/artifacts` (and the run-detail UI) show the real PR / tests. | M |
| HELIX-186 | **Target repo + wire delivery on** — let a request/step config carry the target repo (`owner/repo/base`) + the org installation; thread it into the run; the dev worker injects the real `GitHubDeliveryRunner`. End-to-end: a request against a connected repo → a real PR. | M |

## Open decisions (settle per sub-task)

- **Target repo source:** from the request body (`repo: { owner, repo, base? }`) vs. the org's default. Start with
  an explicit per-request target; **no target → skip delivery** (the run still completes).
- **Brand-new projects (no target repo):** creating a fresh repo to push to is **out of scope** here (a later
  refinement) — this epic delivers into an *existing* connected repo.
- **Deletions in the commit:** `commitFiles` uses inline blob content (add/modify); deleting files needs a tree
  entry with `sha: null` — handle if cheap, else flag as a follow-up.
- **Where the installation id comes from:** threaded from the orchestrator's stored connection into the run
  context (the worker is otherwise org-agnostic).

## What stays deferred

Real **AWS build/deploy** (DEFERRED #4 — still the stubbed deploy URL), real **`git clone`** of a target into the
sandbox (this epic *pushes* a change-set; checkout-an-existing-repo to modify is the InMemory fetcher for now),
and **repo creation** for brand-new projects. Live smoke tests stay manual.
