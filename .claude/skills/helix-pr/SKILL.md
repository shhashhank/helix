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

### 1. Push the branch

```bash
git push -u origin "$(git branch --show-current)"
```

### 2. Extract HELIX key from branch name

```bash
BRANCH=$(git branch --show-current)
KEY=$(echo "$BRANCH" | grep -oE '^HELIX-[0-9]+')
```

### 3. Fetch Jira ticket details for the PR body

Use the Atlassian token (refresh first if older than ~50 min — see `/helix-start` step 1). Get summary, parent chain, AC if present in the description.

### 4. Open the PR via the GitHub MCP

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

<bulleted list of the actual changes — pull from commit messages or ask the user>

## Out of scope

<list of related work that's deferred to other sub-tasks, with their Jira keys>

## Test plan

- [ ] CI green on this PR
- [ ] <test-specific checkboxes drawn from acceptance criteria>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Capture the PR number from the response.

### 5. Comment on the Jira ticket with the PR URL

```bash
TOKEN=$(cat /tmp/atl_token.txt)
PR_URL="https://github.com/shhashhank/helix/pull/<PR_NUM>"
curl -s -o /dev/null -w "comment HTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3/issue/<KEY>/comment" \
  -d "$(python3 -c "import json; print(json.dumps({'body': {'type': 'doc', 'version': 1, 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'PR: '}, {'type': 'text', 'text': '$PR_URL', 'marks': [{'type': 'link', 'attrs': {'href': '$PR_URL'}}]}, {'type': 'text', 'text': '  •  Branch: $BRANCH. Awaiting CI before merge.'}]}]}}))")"
```

### 6. Report

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
