#!/usr/bin/env bash
# SessionStart hook for the Helix repo.
#
# Detects "architecture drift": any component under libs/* or apps/* whose name
# is NOT mentioned anywhere in docs/ARCHITECTURE.md — i.e. a lib or service that
# exists in the codebase but is missing from the at-a-glance diagram. If it finds
# any, it injects a gentle reminder into Claude's session context.
#
# This script only DETECTS and REMINDS. It never edits the doc and never blocks a
# session (always exits 0) — the diagram itself is always updated by Claude (see
# the helix-pr skill).

# Resolve repo root; bail quietly if we're not in a git repo.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$root" ] || exit 0

doc="$root/docs/ARCHITECTURE.md"
[ -f "$doc" ] || exit 0

# Component dirs that should each appear in the diagram doc.
missing=""
for base in libs apps; do
  [ -d "$root/$base" ] || continue
  for dir in "$root/$base"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    grep -qF -- "$name" "$doc" 2>/dev/null || missing="${missing} ${base}/${name}"
  done
done

missing="$(printf '%s' "$missing" | sed 's/^ *//')"
[ -n "$missing" ] || exit 0

list="$(printf '%s' "$missing" | tr ' ' '\n' | paste -sd ',' - | sed 's/,/, /g')"
msg="Reminder: docs/ARCHITECTURE.md doesn't mention component(s): ${list}. If a sub-task added or rewired a component, refresh the architecture diagram + 'where each piece lives' map (and the build-status table if a story/epic finished) — see the helix-pr skill."

# SessionStart additionalContext (component names are plain, so inline JSON is safe).
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
