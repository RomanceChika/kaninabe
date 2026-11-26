#!/bin/sh
# Checks the pull request's review record against its head, so that a change made after a review cannot be merged
# without being reviewed again. The record is one `## Review` section in the pull request body:
#
#   ## Review
#   - opus: <full commit sha at which Opus said nothing more needs fixing>
#   - codex: <full commit sha at which Codex said nothing more needs fixing>
#
# A merge needs both; there is no way to skip one. Every push moves the head, so the record stops matching and this
# fails until the new diff is reviewed by both and the record is rewritten.
# The record is written by the same agent that merges, so this catches a stale or missing record, not a false one.
# HTML comments and fenced code blocks are ignored (they are not what a reader sees as the record).
# Output never quotes the body: it names the rule and, at most, the first 8 characters of a well-formed sha.
# Usage: check-review-record.sh <body-file> <head-sha>
set -eu
f=${1:?usage: check-review-record.sh <body-file> <head-sha>}
head=${2:?usage: check-review-record.sh <body-file> <head-sha>}
[ -f "$f" ] && [ -r "$f" ] || { echo "review record: cannot read the pull request body"; exit 2; }
printf '%s\n' "$head" | grep -qxE '[0-9a-f]{40}' || { echo "review record: the head is not a full commit sha"; exit 2; }
# Visible text only: drop HTML comments (also across lines) and fenced code blocks.
vis=$(tr -d '\r' < "$f" | awk '
  { line = $0; out = "" }
  { while (1) {
      if (inc) { i = index(line, "-->"); if (i == 0) { line = ""; break } line = substr(line, i + 3); inc = 0 }
      i = index(line, "<!--"); if (i == 0) { out = out line; break }
      out = out substr(line, 1, i - 1); line = substr(line, i + 4); inc = 1 } }
  /^[[:space:]]*(```|~~~)/ && !inc { fence = !fence; next }
  !fence { print out }')
n=$(printf '%s\n' "$vis" | grep -cE '^## Review[[:space:]]*$' || true)
[ "$n" = "1" ] || { echo "review record: need exactly one '## Review' section (found $n)"; echo "review record: FAILED"; exit 1; }
sec=$(printf '%s\n' "$vis" | awk '/^## Review[[:space:]]*$/ { on = 1; next } /^#/ { on = 0 } on')
fail=0
for who in opus codex; do
  lines=$(printf '%s\n' "$sec" | grep -E "^- $who:" || true)
  if [ "$(printf '%s\n' "$lines" | grep -c . || true)" != "1" ]; then echo "review record: need exactly one '- $who:' line under '## Review'"; fail=1; continue; fi
  v=$(printf '%s\n' "$lines" | sed "s/^- $who:[[:space:]]*//; s/[[:space:]]*\$//")
  if ! printf '%s\n' "$v" | grep -qxE '[0-9a-f]{40}'; then echo "review record: '- $who:' is not a full commit sha"; fail=1
  elif [ "$v" != "$head" ]; then echo "review record: $who reviewed $(printf '%.8s' "$v"), the head is $(printf '%.8s' "$head") (review the new diff, then update the record)"; fail=1; fi
done
[ "$fail" -eq 0 ] && echo "review record: matches the head" || { echo "review record: FAILED"; exit 1; }
