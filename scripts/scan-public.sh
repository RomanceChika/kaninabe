#!/bin/sh
# Scans every commit (tree, message, author, committer) for: product words, local paths, key shapes, email-like strings,
# AI attribution. Every file of every tree is read as bytes, whatever .gitattributes says (-diff, binary): a file git
# would treat as binary is scanned too. A file that starts with a UTF-16 byte order mark cannot be scanned, so it fails.
# The word list is read from the file named by $SCAN_WORDS_FILE (one extended regex per line; '#' and blank lines
# ignored) and is never printed. A line of the form `@<path-prefix> <regex>` applies only to files under that prefix
# (used to keep the rules under docs/rules free of any product's vocabulary).
# Output is limited to a rule name, a short commit id and a count: never a matched line, a word or a path of a hit,
# because the logs of a public repository are public. Do not add `set -x` or echo any pattern.
# Exit 0 clean, 1 a rule broke, 2 the scan itself could not run (a git or grep error, a bad pattern, an unreadable
# word list, a shallow clone): that is never read as clean.
# Usage: scan-public.sh [--require-words] [<base>]   (scans <base>..HEAD, or every commit reachable from HEAD)
#   --require-words (or SCAN_REQUIRE_WORDS=1): a missing word list is an error. Without a list the scan says so.
set -eu
here=$(dirname "$0")
. "$here/scan-rules.sh"
scan_name=scan-public
usage() { echo "usage: scan-public.sh [--require-words] [<base>]"; exit 2; }
scan_require=0; case ${SCAN_REQUIRE_WORDS:-} in 1|true) scan_require=1 ;; esac
base=
while [ $# -gt 0 ]; do
  case $1 in
    --require-words) scan_require=1 ;;
    -*) usage ;;
    *) [ -z "$base" ] || usage; base=$1 ;;
  esac
  shift
done
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "scan-public: not inside a git repository"; exit 2; }
cd "$root" || exit 2
[ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != true ] || { echo "scan-public: a shallow clone holds only part of the history"; exit 2; }
scan_load_words any

# scan_gg OUT ARGS...: git grep in text mode (never textconv). A status above 1 is an error, not "no hit".
scan_gg() {
  out=$1; shift; rc=0
  git grep -a --no-textconv "$@" > "$out" 2>/dev/null || rc=$?
  if [ "$rc" -gt 1 ]; then scan_fail "git grep failed (exit $rc)"; : > "$out"; fi
  return 0
}
# scan_gg_check FILE: git grep must accept the patterns too (its grammar is not grep's); a bad one is an error.
scan_gg_check() {
  [ -s "$1" ] || return 0
  rc=0; git grep -q -aiE -f "$1" HEAD -- .scan-no-such-path > /dev/null 2>&1 || rc=$?
  if [ "$rc" -gt 1 ]; then scan_fail "git grep cannot read the word list patterns"; fi
}
lines() { wc -l < "$1" | tr -d ' '; }

scan_check_patterns "$scan_pat"; scan_gg_check "$scan_pat"
# Scoped lines: `@<prefix><blanks><regex>`; the prefix and the regex go to files (a regex may start with `-`).
nsc=0
while IFS= read -r line; do
  prefix=$(printf '%s\n' "$line" | sed -n 's/^@\([^[:space:]][^[:space:]]*\)[[:space:]][[:space:]]*[^[:space:]].*$/\1/p')
  re=$(printf '%s\n' "$line" | sed -n 's/^@[^[:space:]][^[:space:]]*[[:space:]][[:space:]]*\([^[:space:]].*\)$/\1/p')
  if [ -z "$prefix" ] || [ -z "$re" ]; then scan_fail "a scoped word list line is malformed"; continue; fi
  nsc=$((nsc + 1))
  printf '%s\n' "$prefix" > "$scan_tmp/sc$nsc.prefix"; printf '%s\n' "$re" > "$scan_tmp/sc$nsc.re"
  scan_check_patterns "$scan_tmp/sc$nsc.re"; scan_gg_check "$scan_tmp/sc$nsc.re"
done < "$scan_scoped"

case $base in -*) usage ;; esac
range=HEAD; [ -z "$base" ] || range="$base..HEAD"
git rev-list "$range" > "$scan_tmp/commits" 2>/dev/null || { echo "scan-public: git rev-list failed (is the base a commit in this history?)"; exit 2; }
ncommits=$(lines "$scan_tmp/commits")
if [ "$ncommits" -eq 0 ] && [ -z "$base" ]; then echo "scan-public: the history is empty"; exit 2; fi
echo "scan-public: $ncommits commit(s)"

nolock="-- . :!package-lock.json :!**/package-lock.json"
bom_le=$(printf '^\377\376'); bom_be=$(printf '^\376\377')
for c in $(cat "$scan_tmp/commits"); do
  short=$(printf '%.8s' "$c")
  # The message and the identities, read as text (a NUL byte is a rule of its own, in scan_text).
  git -c log.showSignature=false log -1 --format=%B "$c" > "$scan_tmp/msg" 2>/dev/null \
    && git -c log.showSignature=false log -1 --format='%an%n%ae%n%cn%n%ce' "$c" > "$scan_tmp/ident" 2>/dev/null \
    || { scan_fail "git log failed in $short"; continue; }
  # `%B` ends at a NUL byte, so the object itself is checked for one (what follows it would go unread).
  git cat-file commit "$c" > "$scan_tmp/raw" 2>/dev/null || { scan_fail "git cat-file failed in $short"; continue; }
  nul=$(tr -cd '\000' < "$scan_tmp/raw" | wc -c | tr -d ' ')
  [ "${nul:-x}" = 0 ] || { echo "NUL byte: the message of $short"; fail=1; }
  scan_text "$scan_tmp/msg" "the message of $short" "$scan_owner"
  if [ -s "$scan_pat" ] && scan_grep -qiE -f "$scan_pat" "$scan_tmp/ident"; then echo "word list: author or committer of $short"; fail=1; fi
  # Author and committer: the owner's noreply address (or any GitHub noreply when no owner is known) and web-flow,
  # naming no AI; a squash merge turns each into a co-author trailer. A name holding an email is not allowed either.
  if scan_grep -qiE -e "($scan_ai)" "$scan_tmp/ident"; then echo "author or committer names an AI: $short"; fail=1; fi
  sed -n '2p;4p' "$scan_tmp/ident" > "$scan_tmp/ident.mail"; sed -n '1p;3p' "$scan_tmp/ident" > "$scan_tmp/ident.name"
  scan_grep -viE -e "$scan_ident_ok" "$scan_tmp/ident.mail" > "$scan_tmp/ident.bad" || true
  if [ -s "$scan_tmp/ident.bad" ]; then echo "author or committer not allowed: $short"; fail=1; fi
  if scan_grep -qE '[@<>]' "$scan_tmp/ident.name"; then echo "author or committer name holds an email-like string: $short"; fail=1; fi

  # The tree, as bytes. Words: case-insensitive, like every other word check.
  if [ -s "$scan_pat" ]; then
    scan_gg "$scan_tmp/o" -l -i -E -f "$scan_pat" "$c"
    n=$(lines "$scan_tmp/o"); if [ "$n" != 0 ]; then echo "word list: $n file(s) in $short"; fail=1; fi
  fi
  i=1
  while [ "$i" -le "$nsc" ]; do
    scan_gg "$scan_tmp/o" -l -i -E -f "$scan_tmp/sc$i.re" "$c" -- "$(cat "$scan_tmp/sc$i.prefix")"
    n=$(lines "$scan_tmp/o"); if [ "$n" != 0 ]; then echo "scoped word list: $n file(s) in $short"; fail=1; fi
    i=$((i + 1))
  done
  # A file that starts with a UTF-16 byte order mark: its words are not bytes of the pattern, so it cannot be scanned.
  # Candidates are found by their first line, then the first two bytes of each are read.
  rc=0; LC_ALL=C git grep -a --no-textconv -lz -E -e "$bom_le|$bom_be" "$c" > "$scan_tmp/o" 2>/dev/null || rc=$?
  if [ "$rc" -gt 1 ]; then scan_fail "git grep failed (exit $rc)"; : > "$scan_tmp/o"; fi
  tr '\0' '\n' < "$scan_tmp/o" > "$scan_tmp/cand"; n=0
  while IFS= read -r cand; do
    [ -n "$cand" ] || continue
    git cat-file -s "$cand" > /dev/null 2>&1 || { scan_fail "git cat-file failed in $short"; continue; }
    h=$(git cat-file blob "$cand" 2>/dev/null | head -c 2 | od -An -tx1 | tr -d ' \n')
    case $h in fffe|feff) n=$((n + 1)) ;; esac
  done < "$scan_tmp/cand"
  if [ "$n" != 0 ]; then echo "a UTF-16 file cannot be scanned: $n file(s) in $short"; fail=1; fi
  # Local paths, key shapes and email-like strings (the lock files list every package's author and are left out).
  scan_gg "$scan_tmp/o" -h -o -E -e "$scan_pathre" "$c" $nolock
  if scan_path_hit "$scan_tmp/o"; then echo "local path or key shape: $(lines "$scan_tmp/ph.rest") hit(s) in $short"; fail=1; fi
  scan_gg "$scan_tmp/o" -h -o -E -e "$scan_email" "$c" $nolock
  scan_grep -viE -e "$scan_email_ok" "$scan_tmp/o" > "$scan_tmp/o.bad" || true
  scan_gg "$scan_tmp/o" -h -o -E -e "$scan_email_wide" "$c" $nolock; cat "$scan_tmp/o" >> "$scan_tmp/o.bad"
  if [ -s "$scan_tmp/o.bad" ]; then echo "email-like string: $(lines "$scan_tmp/o.bad") hit(s) in $short"; fail=1; fi
done
scan_finish
