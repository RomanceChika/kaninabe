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
#   - nothing after it but blank lines and the record lines, so it is the last section: exactly one `- opus:` and one `- codex:` line
#     (either order), then the basis lines of a pull request that changed its basis, in this order:
#       - basis-first: <sha>      0 or 1 (needed when there is a basis-prev)
#       - basis-prev: <sha>       0 or more, oldest first
#       - basis: <sha>            0 or 1 (needed when any other basis line is present)
#       - basis-opus: <sha> <link>, - basis-codex: <sha> <link>     one each, exactly when basis is present (either order)
#     a sha is 40 lowercase hexadecimal digits; a link is exactly https://github.com/OWNER/REPO/pull/N#issuecomment-ID (N and ID
#     without a leading zero, nothing after it); whether the shas name the head or each other is not judged here;
#   - no line before it that looks like a record line (opus, codex, basis, basis-first, basis-prev, basis-opus or basis-codex followed
#     by a colon once markup is stripped), even in fenced code.
# What passes is therefore a visible `Review` heading as the last thing on the page, holding the two lines that name the
# head (and, when there are basis lines, their values in a fixed form: see --emit).
# With `--emit FILE` the values of the basis lines are written to FILE, only when the verdict is "matches", all or nothing, mode 0600
# (made in FILE's directory and moved into place), never over the body, and any old FILE is removed first (once the arguments are valid and FILE is not the body: before the body is read, so that every exit other than 0 from there on leaves no file). The form is one line each,
# in this order, and a last line `end`: `basis-first SHA`, `basis-prev SHA` (each), `basis SHA`, `basis-opus SHA OWNER/REPO N ID`,
# `basis-codex SHA OWNER/REPO N ID`. It is the only reading of the basis lines that the check of the basis record uses. A look-alike of an old record before it (character references, letters from other scripts) is not caught:
# it does not count, and the record that counts is the last section.
# Output never quotes the body: it names the rule and, at most, the first 8 characters of a well-formed sha.
# Usage: check-review-record.sh <body-file> <head-sha> [--emit <file>]
# Exit codes: 0 the record matches the head; 1 it does not match, or the body is malformed; 2 something could not be done (the
# arguments, a tool, the temporary directory): never 1 and never "matches", and a fixed message, never the body. Like the scripts
# that scan, there is no pipeline and no `|| true`: each stage writes a private temporary file and its status is checked.
set -eu
tmp=
et=
emit=
emit_done=
# one EXIT trap: the cleanup, and the guard that turns a status that nobody chose (a command that failed under `set -e`) into 2
# (a verdict is printed only after the temporary directory is gone, so the cleanup here runs only on a path that is already exit 2,
# or on one that this trap makes exit 2; a cleanup that fails here is exit 2 as well; an emit file is never left after exit 2)
trap 'rc=$?; if [ -n "$tmp" ]; then rm -rf "$tmp" || rc=2; fi; if [ -n "$et" ]; then rm -f "$et" || rc=2; fi; if [ "$rc" != 0 ] && [ -n "$emit_done" ]; then rm -f "$emit" || rc=2; fi; if [ "$rc" != 0 ] && [ -z "${verdict_exit:-}" ]; then exit 2; fi' EXIT
could_not() { echo "review record: could not run ($1)"; exit 2; }
f=${1:?usage: check-review-record.sh <body-file> <head-sha>}
head=${2:?usage: check-review-record.sh <body-file> <head-sha>}
if [ $# -gt 2 ]; then
  [ $# -eq 4 ] && [ "$3" = --emit ] && [ -n "$4" ] || could_not "usage: check-review-record.sh <body-file> <head-sha> [--emit <file>]"
  emit=$4
fi
if [ -n "$emit" ]; then
  # by identity, not by spelling (a symbolic or hard link names the same file): checked before anything is removed
  if [ "$emit" -ef "$f" ]; then could_not "usage: the emit file is the body"; fi
  # an old file is removed first, before the body is read, so that no exit other than 0 leaves a stale one from here on
  # (a directory or an unremovable file is exit 2); a usage error above does not touch the path
  rm -f "$emit" || could_not "the old emit file could not be removed"
fi
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
  BEGIN { fence = 0; seen = 0; o = 0; c = 0; last = 0
    lre = "^https://github\\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[1-9][0-9]*#issuecomment-[1-9][0-9]*$" }
  {
    line = $0; sub(/\r$/, "", line); low = tolower(line)
    if (index(line, "\r")) { print "E the body has a carriage return that does not end a line"; stop = 1; exit }
    if (low ~ /<[a-z!?\/]/) print "E the body has an HTML tag or comment (write it without one)"
    if (line ~ /\342\200[\213-\217\252-\256]/ || line ~ /\342\201[\240-\244\246-\251]/ || line ~ /\357\273\277/) print "E the body has an invisible character"
    if (seen) {
      if (line ~ /^[ \t]*$/) next
      if ((line ~ /^- opus:/ || line ~ /^- codex:/) && last > 0) print "E the record lines are not in the required order"
      if (line ~ /^- opus:/) { o++; v = line; sub(/^- opus:[ \t]*/, "", v); sub(/[ \t]*$/, "", v); print "V opus " v; next }
      if (line ~ /^- codex:/) { c++; v = line; sub(/^- codex:[ \t]*/, "", v); sub(/[ \t]*$/, "", v); print "V codex " v; next }
      if (match(line, /^- basis[-a-z]*:/)) nm = substr(line, 3, RLENGTH - 3); else nm = ""
      if (nm == "basis" || nm == "basis-first" || nm == "basis-prev" || nm == "basis-opus" || nm == "basis-codex") {
        v = substr(line, RLENGTH + 1); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
        rk = (nm == "basis-first") ? 1 : (nm == "basis-prev") ? 2 : (nm == "basis") ? 3 : 4
        if (last > rk) print "E the record lines are not in the required order"
        last = rk; cnt[nm]++
        sha = v; link = ""
        if (nm == "basis-opus" || nm == "basis-codex") {
          k = match(v, /[ \t]/)
          if (k > 0) { sha = substr(v, 1, k - 1); link = substr(v, k + 1); sub(/^[ \t]+/, "", link) }
        }
        if (length(sha) != 40 || sha ~ /[^0-9a-f]/) print "E \047- " nm ":\047 is not a full commit sha"
        if (nm == "basis-opus" || nm == "basis-codex") {
          if (link !~ lre) print "E \047- " nm ":\047 link is not https://github.com/OWNER/REPO/pull/N#issuecomment-ID"
          else {
            u = substr(link, 20); split(u, pp, "/"); split(pp[4], qq, "#issuecomment-")
            val[nm, cnt[nm]] = sha " " pp[1] "/" pp[2] " " qq[1] " " qq[2]
          }
        } else val[nm, cnt[nm]] = sha
        next
      }
      print "E the ## Review section must be the last one and hold only the two record lines"; stop = 1; exit
    }
    if (line ~ /^## Review[ \t]*$/) {
      if (fence) { print "E a ## Review line is inside fenced code"; stop = 1; exit }
      seen = 1; next }
    t = low; gsub(/[^a-z:]/, "", t)
    tn = (index(t, ":") > 0) ? substr(t, 1, index(t, ":") - 1) : ""
    if (tn == "opus" || tn == "codex" || tn == "basis" || tn == "basisfirst" || tn == "basisprev" || tn == "basisopus" || tn == "basiscodex") { print "E a record line appears before ## Review"; stop = 1; exit }
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
      else {
        if (o != 1) print "E need exactly one - opus: line under ## Review"; if (c != 1) print "E need exactly one - codex: line under ## Review"
        if (cnt["basis-first"] > 1) print "E at most one - basis-first: line"
        if (cnt["basis"] > 1) print "E at most one - basis: line"
        nb = cnt["basis-first"] + cnt["basis-prev"] + cnt["basis"] + cnt["basis-opus"] + cnt["basis-codex"]
        if (nb > 0 && cnt["basis"] == 0) print "E a - basis: line is required when another basis line is present"
        if (cnt["basis-prev"] > 0 && cnt["basis-first"] == 0) print "E a - basis-prev: line needs a - basis-first: line"
        if (cnt["basis"] > 0 && cnt["basis-opus"] != 1) print "E need exactly one - basis-opus: line"
        if (cnt["basis"] > 0 && cnt["basis-codex"] != 1) print "E need exactly one - basis-codex: line"
        # the values of the basis lines in the fixed form (read back only when the verdict is "matches"): M lines, then the count of them
        n = 0
        if (cnt["basis-first"] >= 1) m[++n] = "basis-first " val["basis-first", 1]
        for (i = 1; i <= cnt["basis-prev"]; i++) m[++n] = "basis-prev " val["basis-prev", i]
        if (cnt["basis"] >= 1) m[++n] = "basis " val["basis", 1]
        if (cnt["basis-opus"] >= 1) m[++n] = "basis-opus " val["basis-opus", 1]
        if (cnt["basis-codex"] >= 1) m[++n] = "basis-codex " val["basis-codex", 1]
        m[++n] = "end"
        for (i = 1; i <= n; i++) print "M " m[i]
        print "N " n
      }
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
# the emit file: the values of the basis lines, proven complete (the count of lines that awk gave, and the last line `end`), made in the
# directory of the target, copied and compared byte for byte, and only then moved into place (the very last thing before the cleanup)
if [ "$fail" -eq 0 ] && [ -n "$emit" ]; then
  sed -n 's/^M //p' "$tmp/out" > "$tmp/em" || could_not "the record could not be read"
  sed -n 's/^N //p' "$tmp/out" > "$tmp/emn" || could_not "the record could not be read"
  read -r en < "$tmp/emn" || could_not "the record could not be read"
  case $en in '' | *[!0-9]*) could_not "the record could not be counted" ;; esac
  lines_of "$tmp/em" || could_not "the record could not be counted"
  [ "$nl" = "$en" ] || could_not "the record was cut short"
  last_is "$tmp/em" end || could_not "the record was cut short"
  [ ! -d "$emit" ] || could_not "the emit file is a directory"
  ed=${emit%/*}
  case $emit in */*) [ -n "$ed" ] || ed=/ ;; *) ed=. ;; esac
  [ -d "$ed" ] || could_not "the directory of the emit file is missing"
  et=$(mktemp "$ed/.emit.XXXXXX") || could_not "the emit file could not be made"
  [ -n "$et" ] && [ -f "$et" ] || could_not "the emit file could not be made"
  cat "$tmp/em" > "$et" || could_not "the emit file could not be written"
  em_rc=0
  cmp -s "$tmp/em" "$et" || em_rc=$?
  [ "$em_rc" = 0 ] || could_not "the emit file differs from the record"
  mv "$et" "$emit" || could_not "the emit file could not be put in place"
  et=
  emit_done=1
fi
# the cleanup is a step like the others: no verdict is printed while the temporary directory cannot be removed
rm -rf "$tmp" || could_not "the temporary directory could not be removed"
tmp=
if [ "$fail" -eq 0 ]; then echo "review record: matches the head"; exit 0; fi
echo "review record: FAILED"; verdict_exit=1; exit 1
