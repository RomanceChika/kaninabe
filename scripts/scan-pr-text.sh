#!/bin/sh
# Scans the text a squash merge will turn into the commit message on the base branch: the pull request's title and
# body, given as a file. A squash commit is made by GitHub at merge time, so scan-public.sh can only see it after the
# merge; this runs the same rules on the same words before it. The merge must then pass this title and body as the
# commit message explicitly (never GitHub's default, which appends the branch's commit messages and trailers).
# Output names only the rule that failed, never a matched line (the logs of a public repository are public).
# Usage: scan-pr-text.sh <file>   (word list: $SCAN_WORDS_FILE, as in scan-public.sh)
set -eu
f=$1
fail=0
if [ -n "${SCAN_WORDS_FILE:-}" ] && [ -s "$SCAN_WORDS_FILE" ]; then
  pat=$(mktemp); trap 'rm -f "$pat"' EXIT
  grep -v '^#' "$SCAN_WORDS_FILE" | grep -v '^$' | grep -v '^@' > "$pat" || true
  if [ -s "$pat" ] && grep -qiE -f "$pat" "$f"; then echo "word list: pull request title or body"; fail=1; fi
fi
# No trailer of any kind is written by hand into a pull request, so this is stricter than the per-commit rule.
if grep -qiE 'Co-Authored|Claude-Session|Generated with' "$f"; then echo "attribution line: pull request title or body"; fail=1; fi
if grep -qE '/Users/[A-Za-z]|C:\\Users|BEGIN [A-Z ]*PRIVATE KEY' "$f" \
   || grep -oE '/home/[a-z0-9_.-]+/' "$f" | grep -qvE '^/home/(u|a|user|x|me|app|runner|node)/$'; then
  echo "local path or key shape: pull request title or body"; fail=1
fi
email='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'
email_ok='(\.example|@example\.(com|org|net)|@users\.noreply\.github\.com|^git@github\.com|@(types|kaninabe|supabase|vitest|next|axiomhq)[./]|@[0-9]|@127\.0\.0\.1|@registry\.npmjs\.org|@api\.axiom\.co|@auth\.external|^evil|\.(ts|tsx|js|mjs|json|md|png|svg)$)'
if grep -oE "$email" "$f" | grep -qvE "$email_ok"; then echo "email-like string: pull request title or body"; fail=1; fi
[ "$fail" -eq 0 ] && echo "scan-pr-text: clean" || { echo "scan-pr-text: FAILED"; exit 1; }
