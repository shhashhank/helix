---
name: helix-pr
description: Open a pull request for the current HELIX-<n>/<slug> branch. Pushes the branch, creates the PR via GitHub MCP linking the Jira ticket, then comments on the Jira ticket with the PR URL. Run after committing the work for the sub-task.
---

# Open a PR for the current Jira sub-task

Sends the current branch up and creates the GitHub PR + Jira comment. Run this after the work for a sub-task is committed locally on a `HELIX-<n>/<slug>` branch.

## Constants

- GitHub repo: `shhashhank/helix`
- Jira REST base: `https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3`
- Jira browse URL prefix: `https://shashank16041995.atlassian.net/browse/`
- Base branch for PRs: `main`

## Pre-flight

```bash
git branch --show-current
git status --short
git log origin/main..HEAD --oneline
```

- Branch name MUST match `^HELIX-\d+/[a-z0-9-]+$`. If not, stop and tell the user — likely they didn't `/helix-start`.
- If there are uncommitted changes, ask whether to include them (commit on the branch first) or abort.
- If there are no commits ahead of `origin/main`, refuse — nothing to PR.

## Steps

### 1. Update the development log

Before pushing, refresh `docs/DEVELOPMENT_LOG.md` so the plain-words documentation ships inside this same PR (this is how the doc stays current — see the drift hook `.claude/hooks/check-devlog-drift.sh`):

- Add or update the entry for this sub-task's `HELIX-<n>` under its Story, in simple, non-jargon words: **What it is / Why it matters / Where it lives** (link the key files). Match the readable, non-engineer tone of the existing entries.
- Flip its row in the summary status table to ✅ (note the PR number once known — fine to fill in after step 5).
- Even if the sub-task changed nothing user-facing, add a one-line entry so the drift hook stays satisfied.
- Commit it on the branch:

```bash
KEY=$(git branch --show-current | grep -oE '^HELIX-[0-9]+')
git add docs/DEVELOPMENT_LOG.md && git commit -q -m "docs: log ${KEY} in DEVELOPMENT_LOG"
```

### 1b. Keep the architecture diagram current (when it changed)

`docs/ARCHITECTURE.md` is the at-a-glance system diagram, guarded by the SessionStart hook `.claude/hooks/check-architecture-drift.sh` (it nags whenever a `libs/*` or `apps/*` component is missing from the doc). If this sub-task changed the architecture, refresh it in this same PR:

- **New or rewired component** — a new `libs/*` or `apps/*` (library/service), a new external system/dependency, or new cross-component wiring → update the relevant Mermaid diagram (and the "Where each piece lives" map) so the new component and its connections appear. Keep the solid = built / dashed = planned convention.
- **Status change** — if this sub-task finishes a story or epic, flip it in the build-status table.
- If the change was purely internal (no new component, wiring, or status change), no diagram edit is needed — the drift hook only checks that every `libs/*` and `apps/*` component appears somewhere in the doc.
- Commit any change on the branch (skip if nothing changed):

```bash
git add docs/ARCHITECTURE.md && git commit -q -m "docs: update ARCHITECTURE for ${KEY}"
```

### 2. Push the branch

```bash
git push -u origin "$(git branch --show-current)"
```

### 3. Extract HELIX key from branch name

```bash
BRANCH=$(git branch --show-current)
KEY=$(echo "$BRANCH" | grep -oE '^HELIX-[0-9]+')
```

### 4. Fetch Jira ticket details for the PR body

Use the Atlassian token (refresh first if older than ~50 min — see `/helix-start` step 1). Get summary, parent chain, AC if present in the description.

### 5. Open the PR via the GitHub MCP

Use `mcp__github__create_pull_request` with:
- owner: `shhashhank`
- repo: `helix`
- head: the branch name
- base: `main`
- title: `<KEY>: <ticket summary>`
- body: structured per the template below

PR body template:

```markdown
## Summary

<one-paragraph summary of what changed, derived from the commit history on this branch>

**Jira:** [<KEY>](https://shashank16041995.atlassian.net/browse/<KEY>)

## What's in

<bulleted list of the actual changes — pull from commit messages or ask the user; include the docs/DEVELOPMENT_LOG.md entry added in step 1>

## Out of scope

<list of related work that's deferred to other sub-tasks, with their Jira keys>

## Test plan

- [ ] CI green on this PR
- [ ] <test-specific checkboxes drawn from acceptance criteria>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Capture the PR number from the response.

### 6. Comment on the Jira ticket with the PR URL

```bash
TOKEN=$(cat /tmp/atl_token.txt)
PR_URL="https://github.com/shhashhank/helix/pull/<PR_NUM>"
curl -s -o /dev/null -w "comment HTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3/issue/<KEY>/comment" \
  -d "$(python3 -c "import json; print(json.dumps({'body': {'type': 'doc', 'version': 1, 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'PR: '}, {'type': 'text', 'text': '$PR_URL', 'marks': [{'type': 'link', 'attrs': {'href': '$PR_URL'}}]}, {'type': 'text', 'text': '  •  Branch: $BRANCH. Awaiting CI before merge.'}]}]}}))")"
```

### 7. Report

Print:
- PR URL
- Jira ticket link
- Brief CI watch suggestion: tell the user CI usually completes in ~1–2 min, and offer to poll (use `mcp__github__pull_request_read` with `method: get_check_runs`).

## Don't do

- **Don't merge here.** That's `/helix-merge`.
- Don't add reviewers automatically. User is sole maintainer per memory `user_profile`.
- Don't set branch protection or any repo-level config.

## Refusal cases

- Branch name not `HELIX-<n>/<slug>` → tell user, stop.
- No commits ahead of main → nothing to PR.
- Push fails on auth → check that the macOS keychain still has the PAT (per memory `reference_github`).

## See also

`/helix-start` to initiate work on a sub-task. `/helix-merge` to land the PR after CI green.
