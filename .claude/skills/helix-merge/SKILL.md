---
name: helix-merge
description: Merge the open PR for the current HELIX-<n>/<slug> branch. Verifies CI is green (polls until completion if needed), squash merges via GitHub MCP, pulls main locally, transitions the Jira ticket to Done, and comments with the merge SHA.
---

# Land the PR for the current Jira sub-task

Run after CI starts on the PR opened by `/helix-pr`. This skill blocks on CI completion (polling), then squash-merges and closes out Jira.

## Constants

- GitHub repo: `shhashhank/helix`
- Jira REST base: `https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3`
- Done transition id: `31`

## Steps

### 1. Identify the open PR for the current branch

```bash
BRANCH=$(git branch --show-current)
KEY=$(echo "$BRANCH" | grep -oE '^HELIX-[0-9]+')
```

Use `mcp__github__list_pull_requests` or `mcp__github__search_pull_requests` to find the open PR where `head` matches the current branch. Capture `pullNumber`.

If no open PR, refuse — run `/helix-pr` first.

### 2. Poll CI to green

Use `mcp__github__pull_request_read` with `method: get_check_runs` to get current state. If `status: completed, conclusion: success` → proceed.

If still `in_progress` or `queued`, poll in the background via Bash (`run_in_background: true`) — use a loop that exits when status is `completed`:

```bash
until run_state=$(curl -sS \
  -H "Authorization: Bearer $(security find-generic-password -s 'https://github.com' -a shhashhank -w 2>/dev/null || cat ~/.config/gh-pat)" \
  "https://api.github.com/repos/shhashhank/helix/actions/runs?branch=$BRANCH&per_page=1" \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['workflow_runs'][0]; print(f\"{r['status']}|{r['conclusion']}|{r['id']}\")"); \
  [ "${run_state%%|*}" = "completed" ]; do
  echo "$run_state — waiting…"
  sleep 25
done
echo "FINAL: $run_state"
```

Note: `run_state` (NOT `status`) — `status` is read-only in zsh. The `curl` here needs the GitHub PAT; the macOS keychain stores it but is awkward to read in a script. Easier: use the GitHub MCP's `pull_request_read` from the foreground and only fall back to curl if the MCP is unavailable.

If conclusion is `failure` or `cancelled`, fetch logs (`https://api.github.com/repos/shhashhank/helix/actions/jobs/<job_id>/logs`), report the failure to the user, and stop — let them decide whether to push a fix or close the PR.

### 3. Squash merge via the GitHub MCP

Use `mcp__github__merge_pull_request` with:
- owner: `shhashhank`
- repo: `helix`
- pullNumber: from step 1
- merge_method: `squash` — ALWAYS squash, per memory `feedback_pr_workflow`
- commit_title: `<KEY>: <PR title without leading key> (#<PR>)`
- commit_message: brief summary of what shipped, ending with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`

Capture the `sha` from the response.

### 4. Update local main

```bash
git checkout main && git pull origin main
```

The branch on origin is auto-deleted by GitHub's merge config in most setups; if not, delete it locally and remotely:

```bash
git branch -d "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true
```

### 5. Transition Jira to Done

```bash
~/.claude/atlassian-refresh.sh > /dev/null
python3 -c "import json,os; d=json.load(open(os.path.expanduser('~/testingLab/testMcpKanbanClaudecreation/.mcp.json'))); open('/tmp/atl_token.txt','w').write(d['mcpServers']['atlassian']['headers']['Authorization'].replace('Bearer ',''))"
TOKEN=$(cat /tmp/atl_token.txt)

curl -s -o /dev/null -w "transition HTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3/issue/$KEY/transitions" \
  -d '{"transition":{"id":"31"}}'
```

### 6. Comment on Jira with the merge SHA

```bash
SHA=<from step 3>
curl -s -o /dev/null -w "comment HTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.atlassian.com/ex/jira/dfadc3c8-b89a-467a-a886-da65b3042837/rest/api/3/issue/$KEY/comment" \
  -d "$(python3 -c "import json; print(json.dumps({'body': {'type': 'doc', 'version': 1, 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Merged PR (squash, commit ' + '$SHA'[:7] + ') into main. CI green.'}]}]}}))")"
```

### 7. Roll parent Story + Epic to Done if all siblings closed (manual until automation works)

For the parent Story: query siblings via JQL `parent = <STORY_KEY>` and check if all are Done. If yes, transition the Story → Done. Then check the Epic similarly.

```bash
# JQL helper
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/search/approximate-count" \
  -H "Content-Type: application/json" -X POST \
  -d '{"jql":"parent = STORY_KEY AND status != Done"}'
```

If non-Done count > 0 → leave the Story alone.

### 8. Report

Print:
- Merge SHA
- Jira ticket status (Done)
- Whether the parent Story / Epic rolled forward
- Suggest next sub-task to start (e.g., the next HELIX-<m> in CSV order, if known).

## Refusal cases

- No open PR for the current branch.
- CI failed — pause, don't merge.
- Working tree has uncommitted changes (we're about to checkout main) → ask first.

## See also

`/helix-start` to begin the next sub-task. Memory: `feedback_pr_workflow`, `reference_jira`, `reference_github`.
