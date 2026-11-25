#!/bin/sh
# Scans every commit (tree, message, author) for: product words, local paths, key shapes, email-like strings.
# The word list is read from the file named by $SCAN_WORDS_FILE (one extended regex per line; '#' and blank lines ignored)
# and is never printed. A line of the form `@<path-prefix> <regex>` applies only to files under that prefix
# (used to keep the rules under docs/rules free of any product's vocabulary). Output is limited to a commit short id, a file path, a line number and counts: never a matched
# line or snippet, because the logs of a public repository are public. Do not add `set -x` or echo any pattern.
# Usage: scan-public.sh [<base>]   (scans <base>..HEAD, or every commit reachable from HEAD)
set -eu
range=${1:+$1..}HEAD
pat=$(mktemp); trap 'rm -f "$pat" "$scoped"' EXIT
if [ -n "${SCAN_WORDS_FILE:-}" ] && [ -s "$SCAN_WORDS_FILE" ]; then
  grep -v '^#' "$SCAN_WORDS_FILE" | grep -v '^$' | grep -v '^@' > "$pat" || true
  scoped=$(mktemp); grep '^@' "$SCAN_WORDS_FILE" > "$scoped" || true
else
  scoped=$(mktemp)
fi
fail=0
generic='/Users/[A-Za-z]|/home/[a-z]+/|C:\\Users|BEGIN [A-Z ]*PRIVATE KEY'
email='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'
email_ok='(\.example|@example\.(com|org|net)|@users\.noreply\.github\.com|^git@github\.com|@(types|kaninabe|supabase|vitest|next|axiomhq)[./]|@[0-9]|@127\.0\.0\.1|@registry\.npmjs\.org|@api\.axiom\.co|@auth\.external|^evil|\.(ts|tsx|js|mjs|json|md|png|svg)$)'
for c in $(git rev-list $range); do
  short=$(echo "$c" | cut -c1-8)
  if [ -s "$pat" ]; then
    n=$(git grep -IlE -f "$pat" "$c" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$n" != "0" ]; then echo "word list: $n file(s) in $short"; git grep -InE -f "$pat" "$c" 2>/dev/null | cut -d: -f2,3 | head -50 | sed "s|^|  at |" ; fail=1; fi
    if git log -1 --format='%an %ae %cn %ce%n%B' "$c" | grep -qiE -f "$pat"; then echo "word list: commit message or author of $short"; fail=1; fi
  fi
  while IFS= read -r line; do
    prefix=${line%% *}; prefix=${prefix#@}; re=${line#* }
    n=$(git grep -IlE "$re" "$c" -- "$prefix" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$n" != "0" ]; then echo "scoped word list: $n file(s) under $prefix in $short"; git grep -InE "$re" "$c" -- "$prefix" 2>/dev/null | cut -d: -f2,3 | head -50 | sed "s|^|  at |"; fail=1; fi
  done < "$scoped"
  if git log -1 --format='%an%n%ae%n%cn%n%ce%n%B' "$c" | grep -qiE 'Co-Authored|Claude-Session|Generated with'; then echo "attribution line in $short"; fail=1; fi
  n=$(git grep -IlE "$generic" "$c" -- . ':!package-lock.json' ':!**/package-lock.json' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" != "0" ]; then
    m=$(git grep -IhoE '/Users/[A-Za-z0-9_.-]+|/home/[a-z0-9_.-]+/|C:\\Users|BEGIN [A-Z ]*PRIVATE KEY' "$c" -- . ':!package-lock.json' ':!**/package-lock.json' | sed 's/^[^:]*://' | grep -vE '^/home/(u|a|user|x|me|app|runner|node)/$' | wc -l | tr -d ' ')
    if [ "$m" != "0" ]; then echo "local path or key shape: $m hit(s) in $short"; fail=1; fi
  fi
  m=$(git grep -IhoE "$email" "$c" -- . ':!package-lock.json' ':!**/package-lock.json' | sed 's/^[^:]*://' | grep -vE "$email_ok" | wc -l | tr -d ' ')
  if [ "$m" != "0" ]; then echo "email-like string: $m hit(s) in $short"; fail=1; fi
done
[ "$fail" -eq 0 ] && echo "scan-public: clean" || { echo "scan-public: FAILED"; exit 1; }
