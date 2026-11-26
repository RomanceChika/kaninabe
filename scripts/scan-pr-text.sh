#!/bin/sh
# Scans the text a squash merge will turn into the commit message on the base branch: the pull request's title and
# body, given as a file. A squash commit is made by GitHub at merge time, so scan-public.sh can only see it after the
# merge; this runs the same rules on the same words before it. For that to hold, a merge passes this title and body as
# the commit title and message explicitly (the repository's default squash message is not relied on).
# The trailer GitHub appends for co-authors is not in this text: scan-public.sh checks authors and committers instead.
# Output names only the rule that failed, never a matched line (the logs of a public repository are public).
# Exit 0 clean, 1 a rule broke, 2 the scan could not run (unreadable input, bad pattern, unreadable word list).
# Usage: scan-pr-text.sh [--require-words] <file>   (word list: $SCAN_WORDS_FILE, as in scan-public.sh)
#   --require-words (or SCAN_REQUIRE_WORDS=1): the word list is required; a missing, unreadable or empty one stops the
#   scan at the entrance. Without it, and with no list, the scan runs the generic rules and says the list was not used.
set -eu
. "$(dirname "$0")/scan-rules.sh"
scan_name=scan-pr-text
scan_require=0; case ${SCAN_REQUIRE_WORDS:-} in 1|true) scan_require=1 ;; esac
f=
while [ $# -gt 0 ]; do
  case $1 in
    --require-words) scan_require=1 ;;
    -?*) echo "usage: scan-pr-text.sh [--require-words] <file>"; exit 2 ;;
    *) [ -z "$f" ] || { echo "usage: scan-pr-text.sh [--require-words] <file>"; exit 2; }; f=$1 ;;
  esac
  shift
done
[ -n "$f" ] || { echo "usage: scan-pr-text.sh [--require-words] <file>"; exit 2; }
{ [ -f "$f" ] && [ -r "$f" ]; } || { echo "scan-pr-text: cannot read the input"; exit 2; }
scan_load_words plain
scan_check_patterns "$scan_pat"
# A pull request never carries a trailer written by hand, so here no co-author line is allowed at all.
scan_text "$f" "pull request title or body" ""
scan_finish
