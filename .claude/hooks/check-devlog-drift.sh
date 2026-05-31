#!/usr/bin/env bash
# SessionStart hook for the Helix repo.
#
# Detects "documentation drift": any HELIX ticket whose work has been merged to
# main but which is NOT yet mentioned in docs/DEVELOPMENT_LOG.md. If it finds
# any, it injects a gentle reminder into Claude's session context.
#
# This script only DETECTS and REMINDS. It never edits the doc and never blocks
# a session (always exits 0) — the plain-words writing is always done by Claude.

# Resolve repo root; bail quietly if we're not in a git repo.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$root" ] || exit 0

doc="$root/docs/DEVELOPMENT_LOG.md"
[ -f "$doc" ] || exit 0

# Pick the canonical main ref, falling back gracefully.
ref=""
for cand in origin/main main HEAD; do
  if git -C "$root" rev-parse --verify --quiet "$cand" >/dev/null 2>&1; then
    ref="$cand"
    break
  fi
done
[ -n "$ref" ] || exit 0

# HELIX keys that appear in squash-merge commit subjects (e.g. "HELIX-53: … (#3)").
merged="$(git -C "$root" log "$ref" --pretty=%s 2>/dev/null | grep -oE 'HELIX-[0-9]+' | sort -u)"
[ -n "$merged" ] || exit 0

# HELIX keys already documented.
documented="$(grep -oE 'HELIX-[0-9]+' "$doc" 2>/dev/null | sort -u)"

# Tickets merged but not documented.
missing="$(comm -23 <(printf '%s\n' "$merged") <(printf '%s\n' "$documented"))"
[ -n "$missing" ] || exit 0

list="$(printf '%s' "$missing" | paste -sd ',' - | sed 's/,/, /g')"
msg="Reminder: docs/DEVELOPMENT_LOG.md is missing entries for merged ticket(s): ${list}. Add a plain-words entry for each (what it is / why it matters / where it lives) and refresh the status table."

# SessionStart additionalContext (message has no quotes/backslashes, so inline JSON is safe).
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
