#!/bin/sh
# Scans the text a squash merge will turn into the commit message on the base branch: the pull request's title and
# body, given as a file. A squash commit is made by GitHub at merge time, so scan-public.sh can only see it after the
# merge; this runs the same rules on the same words before it. For that to hold, a merge passes this title and body as
# the commit title and message explicitly (the repository's default squash message is not relied on).
# The trailer GitHub appends for co-authors is not in this text: scan-public.sh checks authors and committers instead.
# Output names only the rule that failed, never a matched line (the logs of a public repository are public).
# Usage: scan-pr-text.sh <file>   (word list: $SCAN_WORDS_FILE, as in scan-public.sh)
set -eu
. "$(dirname "$0")/scan-rules.sh"
scan_name=scan-pr-text
pat=; scoped=
trap 'rc=$?; scan_cleanup; guard_exit "$rc"' EXIT
f=${1:?usage: scan-pr-text.sh <file>}
[ -f "$f" ] && [ -r "$f" ] || { echo "scan-pr-text: cannot read the input"; exit 2; }
fail=0
if [ -n "${SCAN_WORDS_FILE:-}" ]; then
  # a list that is named must be readable and acceptable (word_list_read): exit 2 otherwise, never a scan without it
  [ -s "$SCAN_WORDS_FILE" ] || { echo "scan-pr-text: the word list is missing or empty"; echo "scan-pr-text: ERROR"; exit 2; }
  pat=$(mktemp); scoped=$(mktemp)
  word_list_read "$SCAN_WORDS_FILE" "$pat" "$scoped" || { echo "scan-pr-text: the word list $wl_err"; echo "scan-pr-text: ERROR"; exit 2; }
  scan_check_patterns "$pat"
  if [ -s "$pat" ] && scan_grep -qiE -f "$pat" "$f"; then echo "word list: pull request title or body"; fail=1; fi
fi
# A pull request never carries a trailer written by hand, so here no co-author line is allowed at all.
scan_owner=
if scan_attribution "$f"; then echo "attribution line: pull request title or body"; fail=1; fi
pr_hit=0
if scan_grep -qE '/Users/[A-Za-z]|C:\\Users|BEGIN [A-Z ]*PRIVATE KEY' "$f"; then pr_hit=1; fi
scan_filter "$f" "$scan_dir/home.1" -oE '/home/[A-Za-z0-9_.-]+/'
if scan_grep -qvE '^/home/(u|a|user|x|me|app|runner|node)/$' "$scan_dir/home.1"; then pr_hit=1; fi
if [ "$pr_hit" = 1 ]; then echo "local path or key shape: pull request title or body"; fail=1; fi
if scan_bad_email "$f"; then echo "email-like string: pull request title or body"; fail=1; fi
scan_finish scan-pr-text "$fail"
