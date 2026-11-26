#!/bin/sh
# Checks the pull request's review record against its head, so that a change made after a review cannot be merged
# without being reviewed again. The record is the last section of the pull request body:
#
#   ## Review
#   - opus: <full commit sha at which Opus said nothing more needs fixing>
#   - codex: <full commit sha at which Codex said nothing more needs fixing>
#
# A merge needs both; there is no way to skip one. Every push moves the head, so the record stops matching and this
# fails until the new diff is reviewed by both and the record is rewritten.
# The record is written by the same agent that merges, so this catches a stale or missing record, not a false one.
#
# What is counted must be what a reader sees. Rather than imitate how GitHub renders Markdown, the body is held to a
# shape in which the two cannot differ, and anything else fails (a false failure is fixed by rewriting the body):
#   - no HTML tag or comment anywhere (`<` followed by a letter, `!`, `?` or `/`: an HTML block or an unclosed element
#     can hide or flatten what follows), no invisible character, and no carriage return except before a line feed;
#   - exactly one `## Review` line, outside fenced code (fences are tracked by their character and length);
#   - nothing after it but blank lines and exactly one `- opus:` and one `- codex:` line, so it is the last section;
#   - no line before it that looks like a record line (opus: or codex: once markup is stripped), even in fenced code.
# Output never quotes the body: it names the rule and, at most, the first 8 characters of a well-formed sha.
# Usage: check-review-record.sh <body-file> <head-sha>
set -eu
f=${1:?usage: check-review-record.sh <body-file> <head-sha>}
head=${2:?usage: check-review-record.sh <body-file> <head-sha>}
[ -f "$f" ] && [ -r "$f" ] || { echo "review record: cannot read the pull request body"; exit 2; }
case $head in *[!0-9a-f]*) bad=1 ;; *) bad=0 ;; esac
[ "$bad" -eq 0 ] && [ "${#head}" -eq 40 ] || { echo "review record: the head is not a full commit sha"; exit 2; }
# One line per finding: "E <rule>" for a broken rule, "V <who> <value>" for a record value (never printed as is).
out=$(LC_ALL=C awk '
  function lead(s) { match(s, /^ */); return RLENGTH }
  function run(s, c,   n) { n = 0; while (substr(s, n + 1, 1) == c) n++; return n }
  BEGIN { fence = 0; seen = 0; o = 0; c = 0 }
  {
    line = $0; sub(/\r$/, "", line); low = tolower(line)
    if (index(line, "\r")) { print "E the body has a carriage return that does not end a line"; stop = 1; exit }
    if (low ~ /<[a-z!?\/]/) print "E the body has an HTML tag or comment (write it without one)"
    if (line ~ /\342\200[\213-\217\252-\256]|\342\201[\240-\244\246-\251]|\357\273\277/) print "E the body has an invisible character"
    if (seen) {
      if (line ~ /^[ \t]*$/) next
      if (line ~ /^- opus:/) { o++; v = line; sub(/^- opus:[ \t]*/, "", v); sub(/[ \t]*$/, "", v); print "V opus " v; next }
      if (line ~ /^- codex:/) { c++; v = line; sub(/^- codex:[ \t]*/, "", v); sub(/[ \t]*$/, "", v); print "V codex " v; next }
      print "E the ## Review section must be the last one and hold only the two record lines"; stop = 1; exit
    }
    if (line ~ /^## Review[ \t]*$/) {
      if (fence) { print "E a ## Review line is inside fenced code"; stop = 1; exit }
      seen = 1; next }
    t = low; gsub(/[^a-z:]/, "", t)
    if (t ~ /^(opus|codex):/) { print "E a record line appears before ## Review"; stop = 1; exit }
    n = lead(line)
    if (n <= 3) {
      s = substr(line, n + 1); ch = substr(s, 1, 1)
      if (ch == "`" || ch == "~") {
        k = run(s, ch)
        if (k >= 3) {
          rest = substr(s, k + 1)
          if (!fence) { if (!(ch == "`" && index(rest, "`"))) { fence = 1; fch = ch; flen = k } }
          else if (ch == fch && k >= flen && rest ~ /^[ \t]*$/) fence = 0
        }
      }
    }
  }
  END {
    if (stop) exit
    if (!seen) print "E need one ## Review section (found none outside fenced code)"
    else { if (o != 1) print "E need exactly one - opus: line under ## Review"; if (c != 1) print "E need exactly one - codex: line under ## Review" }
  }' < "$f")
fail=0
errs=$(printf '%s\n' "$out" | sed -n 's/^E //p' | sort -u)
if [ -n "$errs" ]; then printf '%s\n' "$errs" | sed 's/^/review record: /'; fail=1
else
  for who in opus codex; do
    v=$(printf '%s\n' "$out" | sed -n "s/^V $who //p")
    case $v in *[!0-9a-f]*|'') ok=0 ;; *) ok=1 ;; esac
    if [ "$ok" -eq 0 ] || [ "${#v}" -ne 40 ]; then echo "review record: '- $who:' is not a full commit sha"; fail=1
    elif [ "$v" != "$head" ]; then echo "review record: $who reviewed $(printf '%.8s' "$v"), the head is $(printf '%.8s' "$head") (review the new diff, then update the record)"; fail=1; fi
  done
fi
[ "$fail" -eq 0 ] && echo "review record: matches the head" || { echo "review record: FAILED"; exit 1; }
