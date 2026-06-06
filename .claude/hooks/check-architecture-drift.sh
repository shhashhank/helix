#!/usr/bin/env bash
# SessionStart hook for the Helix repo. Two detect-and-remind checks on
# docs/ARCHITECTURE.md:
#
#   1. Architecture drift: any component under libs/* or apps/* whose name is NOT
#      mentioned in the doc — a lib/service missing from the at-a-glance diagram.
#   2. Mermaid render lint: parentheses inside a Mermaid edge label (|...|), which
#      abort the whole flowchart so it silently fails to render in preview (bit us
#      in PR #61 and #80). Parentheses in quoted node labels ["..."] are fine.
#
# If either finds something, it injects a gentle reminder into Claude's session
# context. This script only DETECTS and REMINDS. It never edits the doc and never
# blocks a session (always exits 0) — Claude updates the diagram (see helix-pr).

# Resolve repo root; bail quietly if we're not in a git repo.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$root" ] || exit 0

doc="$root/docs/ARCHITECTURE.md"
[ -f "$doc" ] || exit 0

reminders=""

# 1. Architecture drift: a libs/* or apps/* dir not mentioned in the diagram doc.
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
if [ -n "$missing" ]; then
  list="$(printf '%s' "$missing" | tr ' ' '\n' | paste -sd ',' - | sed 's/,/, /g')"
  reminders="Reminder: docs/ARCHITECTURE.md doesn't mention component(s): ${list}. If a sub-task added or rewired a component, refresh the architecture diagram + 'where each piece lives' map (and the build-status table if a story/epic finished) — see the helix-pr skill."
fi

# 2. Mermaid render lint: parentheses inside an edge label (|...|) before the
#    closing pipe. (Quoted node-label parens don't match this and are fine.)
paren_lines="$(grep -nE '\->\|[^|]*\(' "$doc" 2>/dev/null | cut -d: -f1 | paste -sd ',' - | sed 's/,/, /g')"
if [ -n "$paren_lines" ]; then
  lint="Reminder: docs/ARCHITECTURE.md has parentheses inside a Mermaid edge label at line(s) ${paren_lines}; this breaks the first flowchart render in preview. Move the parentheses out of the edge label (they are fine in quoted node labels)."
  reminders="${reminders:+$reminders }$lint"
fi

[ -n "$reminders" ] || exit 0

# SessionStart additionalContext (the messages are plain, so inline JSON is safe).
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$reminders"
exit 0
