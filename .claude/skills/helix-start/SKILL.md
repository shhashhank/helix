---
name: helix-start
description: Start work on a Jira sub-task. Refreshes Atlassian token, fetches the ticket summary, creates a HELIX-<n>/<slug> branch from latest main, and transitions the ticket to In Progress. Required argument is the ticket key (e.g., HELIX-52).
---

# Start a Jira sub-task

Begin work on a HELIX Jira ticket following the standard PR workflow. See user memory `feedback_pr_workflow` and `reference_jira` for protocol + auth details — the constants below are duplicated for skill self-containment.

## Required input

The user invokes as `/helix-start HELIX-<n>` (e.g., `/helix-start HELIX-52`). If no key is provided, ask the user which ticket and pause — do not guess.

## Constants

- Atlassian cloud id: `dfadc3c8-b89a-467a-a886-da65b3042837`
- Jira REST base: `https://api.atlassian.com/ex/jira/<CLOUD_ID>/rest/api/3`
- Transition ids (same on Epic / Task / Subtask): `11` = To Do, `21` = In Progress, `31` = Done
- Branch convention: `HELIX-<n>/<lowercase-dash-slug-from-summary>`

## Steps

### 1. Refresh Atlassian access token

Idempotent — safe to run even if the token is fresh.

```bash
~/.claude/atlassian-refresh.sh > /dev/null && tail -1 ~/.claude/atlassian-refresh.log
python3 -c "import json,os; d=json.load(open(os.path.expanduser('~/testingLab/testMcpKanbanClaudecreation/.mcp.json'))); open('/tmp/atl_token.txt','w').write(d['mcpServers']['atlassian']['headers']['Authorization'].replace('Bearer ',''))"
```

### 2. Fetch ticket details

```bash
TOKEN=$(cat /tmp/atl_token.txt)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3/issue/<KEY>?fields=summary,status,parent,issuetype" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
f = d['fields']
parent = (f.get('parent') or {}).get('key', '—')
print(f\"{d['key']}|{f['issuetype']['name']}|{f['status']['name']}|{parent}|{f['summary']}\")
"
```

Capture: summary (for slug), status (refuse to proceed if already In Progress / Done — see step 3), parent (mention in branch description if user wants).

### 3. Refuse to proceed if ticket isn't fresh

If status is already `In Progress` or `Done`, ask the user explicitly: "HELIX-XX is currently <status>. Re-start anyway (could clobber existing branch) or abort?" Do not proceed without confirmation.

### 4. Pull latest main

```bash
git checkout main && git pull origin main
```

### 5. Compute branch slug from summary

Rules: lowercase, ASCII alphanumeric + dashes, max ~50 chars, no leading/trailing dashes. Drop filler words ("the", "a", "of") if length tight. Examples:
- "Agent registry service + persistence" → `agent-registry-persistence`
- "LLM Gateway & Model Router (Anthropic)" → `llm-gateway-model-router`
- "Build, Lint & Self-Correction Loop" → `build-lint-self-correction`

If the auto-derived slug is awkward, present it to the user and let them edit before creating the branch.

### 6. Create and checkout the branch

```bash
git checkout -b HELIX-<n>/<slug>
```

### 7. Transition Jira to In Progress

```bash
TOKEN=$(cat /tmp/atl_token.txt)
curl -s -o /dev/null -w "transition HTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3/issue/<KEY>/transitions" \
  -d '{"transition":{"id":"21"}}'
```

Verify with a follow-up GET on the same issue.

### 8. Also roll the parent Story + Epic forward (manual until automation works)

Per memory `reference_jira`, the Jira automation rule for parent rollup is broken. Fetch the parent chain and transition each ancestor to In Progress if currently To Do:

```bash
# Repeat for each ancestor key found via the .fields.parent.key chain
curl -s -o /dev/null -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  ".../issue/<PARENT_KEY>/transitions" -d '{"transition":{"id":"21"}}'
```

### 9. Report and offer next step

Print:
- Branch name
- Ticket summary + Jira link `https://shashank16041995.atlassian.net/browse/<KEY>`
- Parent chain (Story → Epic) and their current statuses
- Suggest the user describe the implementation or run `/plan` for a structured plan.

## Refusal cases

- Working tree has uncommitted changes → ask the user to commit, stash, or discard first.
- Ticket key doesn't match `HELIX-\d+` → ask for a valid key.
- Ticket doesn't exist (404 from Jira) → report and stop.

## See also

`/helix-pr` to push + open the PR once work is committed. `/helix-merge` for the merge + Done transition.
