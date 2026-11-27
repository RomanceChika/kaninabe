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
#   - fences only at the start of a line, outside any other block (a fence indented into a list item ends where
#     GitHub ends the item, which a line-based reader cannot follow), so they can be tracked by character and length;
#     no `[^` anywhere (a footnote, even one defined inside a quote or a list item, is shown after the record); exactly one `## Review` line, outside fenced code;
#   - nothing after it but blank lines and exactly one `- opus:` and one `- codex:` line, so it is the last section;
#   - no line before it that looks like a record line (opus: or codex: once markup is stripped), even in fenced code.
# What passes is therefore a visible `Review` heading as the last thing on the page, holding the two lines that name the
# head. A look-alike of an old record before it (character references, letters from other scripts) is not caught:
# it does not count, and the record that counts is the last section.
# Output never quotes the body: it names the rule and, at most, the first 8 characters of a well-formed sha.
# Usage: check-review-record.sh <body-file> <head-sha>
# Exit codes: 0 the record matches the head; 1 it does not match, or the body is malformed; 2 something could not be done (the
# arguments, a tool, the temporary directory): never 1 and never "matches", and a fixed message, never the body. Like the scripts
# that scan, there is no pipeline and no `|| true`: each stage writes a private temporary file and its status is checked.
set -eu
tmp=
# one EXIT trap: the cleanup, and the guard that turns a status that nobody chose (a command that failed under `set -e`) into 2
trap 'rc=$?; if [ -n "$tmp" ]; then rm -rf "$tmp" || rm_failed=1; fi; if [ "$rc" != 0 ] && [ "$rc" != 2 ] && [ -z "${verdict_exit:-}" ]; then exit 2; fi' EXIT
could_not() { echo "review record: could not run ($1)"; exit 2; }
f=${1:?usage: check-review-record.sh <body-file> <head-sha>}
head=${2:?usage: check-review-record.sh <body-file> <head-sha>}
[ -f "$f" ] && [ -r "$f" ] || { echo "review record: cannot read the pull request body"; exit 2; }
case $head in *[!0-9a-f]*) bad=1 ;; *) bad=0 ;; esac
[ "$bad" -eq 0 ] && [ "${#head}" -eq 40 ] || { echo "review record: the head is not a full commit sha"; exit 2; }
tmp=$(mktemp -d) || could_not "no temporary directory"
[ -n "$tmp" ] && [ -d "$tmp" ] || could_not "no temporary directory"
# One line per finding: "E <rule>" for a broken rule, "V <who> <value>" for a record value (never printed as is), and a last line
# "D" that only a program that ran to its end prints: a file without it was cut short (a write error that nobody saw), so no
# result is read from it. The same last line (as "~D", which sorts after every finding) is carried through the next stages.
LC_ALL=C awk '
  function run(s, c,   n) { n = 0; while (substr(s, n + 1, 1) == c) n++; return n }
  BEGIN { fence = 0; seen = 0; o = 0; c = 0 }
  {
    line = $0; sub(/\r$/, "", line); low = tolower(line)
    if (index(line, "\r")) { print "E the body has a carriage return that does not end a line"; stop = 1; exit }
    if (low ~ /<[a-z!?\/]/) print "E the body has an HTML tag or comment (write it without one)"
    if (line ~ /\342\200[\213-\217\252-\256]/ || line ~ /\342\201[\240-\244\246-\251]/ || line ~ /\357\273\277/) print "E the body has an invisible character"
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
    if (t ~ /^opus:/ || t ~ /^codex:/) { print "E a record line appears before ## Review"; stop = 1; exit }
    if (index(line, "[^")) { print "E the body has a footnote or [^ (a footnote is shown after the record)"; stop = 1; exit }
    if ((index(line, "```") || index(line, "~~~")) && substr(line, 1, 3) != "```" && substr(line, 1, 3) != "~~~") {
      print "E a fence or a run of three backticks or tildes that does not start the line"; stop = 1; exit }
    ch = substr(line, 1, 1)
    if ((ch == "`" || ch == "~") && run(line, ch) >= 3) {
      k = run(line, ch); rest = substr(line, k + 1)
      if (!fence) { if (!(ch == "`" && index(rest, "`"))) { fence = 1; fch = ch; flen = k } }
      else if (ch == fch && k >= flen && rest ~ /^[ \t]*$/) fence = 0
    }
  }
  END {
    if (!stop) {
      if (!seen) print "E need one ## Review section (found none outside fenced code)"
      else { if (o != 1) print "E need exactly one - opus: line under ## Review"; if (c != 1) print "E need exactly one - codex: line under ## Review" }
    }
    print "D"
  }' < "$f" > "$tmp/out" || could_not "the body could not be read"
# last_is <file> <line>: the last line of <file> is exactly <line>. (A cut-short output of either tool here leaves an empty or other
# line, which is not <line>: the caller stops.)
last_is() {
  sed -n '$p' "$1" > "$1.last" || return 1
  li=$(cat "$1.last") || return 1
  [ "$li" = "$2" ]
}
# lines_of <file>: sets $nl to the number of lines of <file> (digits only; an output that is empty or not a number is a failure)
lines_of() {
  sed -n '$=' "$1" > "$1.n" || return 1
  nl=$(cat "$1.n") || return 1
  case $nl in '' | *[!0-9]*) return 1 ;; esac
}
last_is "$tmp/out" D || could_not "the result was cut short"
sed -n -e 's/^E //p' -e 's/^D$/~D/p' "$tmp/out" > "$tmp/e1" || could_not "the findings could not be read"
LC_ALL=C sort -u "$tmp/e1" > "$tmp/e2" || could_not "the findings could not be read"
last_is "$tmp/e2" '~D' || could_not "the findings were cut short"
# findings exist when the first line of the sorted file is not the sentinel (decided on the checked file, not on a later stage's output)
sed -n '1p' "$tmp/e2" > "$tmp/e2.first" || could_not "the findings could not be read"
first=$(cat "$tmp/e2.first") || could_not "the findings could not be read"
[ -n "$first" ] || could_not "the findings were cut short"
fail=0
if [ "$first" != '~D' ]; then
  # each stage that makes what is printed is checked by its line count against the stage before it, and the print is the shell's own
  lines_of "$tmp/e2" || could_not "the findings could not be counted"; n2=$nl
  sed '$d' "$tmp/e2" > "$tmp/e3" || could_not "the findings could not be written"
  lines_of "$tmp/e3" || could_not "the findings could not be counted"; n3=$nl
  [ "$n3" = "$((n2 - 1))" ] || could_not "the findings were cut short"
  sed 's/^/review record: /' "$tmp/e3" > "$tmp/e4" || could_not "the findings could not be written"
  lines_of "$tmp/e4" || could_not "the findings could not be counted"
  [ "$nl" = "$n3" ] || could_not "the findings were cut short"
  while IFS= read -r msg; do
    printf '%s\n' "$msg" || could_not "the findings could not be written"
  done < "$tmp/e4"
  fail=1
else
  for who in opus codex; do
    sed -n -e "s/^V $who /v:/p" -e 's/^D$/~D/p' "$tmp/out" > "$tmp/v.$who" || could_not "the record could not be read"
    last_is "$tmp/v.$who" '~D' || could_not "the record was cut short"
    sed -n '1p' "$tmp/v.$who" > "$tmp/v.$who.1" || could_not "the record could not be read"
    vl=$(cat "$tmp/v.$who.1") || could_not "the record could not be read"
    case $vl in v:*) v=${vl#v:} ;; *) could_not "the record was cut short" ;; esac
    case $v in *[!0-9a-f]*|'') ok=0 ;; *) ok=1 ;; esac
    if [ "$ok" -eq 0 ] || [ "${#v}" -ne 40 ]; then echo "review record: '- $who:' is not a full commit sha"; fail=1
    elif [ "$v" != "$head" ]; then echo "review record: $who reviewed $(printf '%.8s' "$v"), the head is $(printf '%.8s' "$head") (review the new diff, then update the record)"; fail=1; fi
  done
fi
if [ "$fail" -eq 0 ]; then echo "review record: matches the head"; exit 0; fi
echo "review record: FAILED"; verdict_exit=1; exit 1
