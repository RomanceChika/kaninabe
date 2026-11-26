# Rules shared by scan-public.sh and scan-pr-text.sh (sourced, not run). Every check here fails closed: a pattern
# grep cannot read, or a file it cannot open, stops the scan instead of reading as "no match".
# Nothing here prints a matched line or a word from the list (the logs of a public repository are public).

# Names of AI tools and bots that must never appear as an author, a committer or a co-author.
scan_ai='claude|anthropic|copilot|codex|openai|chatgpt|gemini|cursor|devin|\[bot\]'
# Lines that attribute work to an AI. Any `<word>-by:` trailer naming an AI counts, whatever the word.
scan_attrib="co-?authored|claude-session|generated[[:space:]]+(with|by)|claude\\.ai/code/session_|noreply@anthropic|^[[:space:]]*[a-z-]+-by:.*($scan_ai)"
# The one co-author trailer allowed: the one a squash merge adds for the repository owner's own noreply address
# (owner from $SCAN_OWNER, else the Actions variable GITHUB_REPOSITORY_OWNER; with neither, none is allowed).
scan_owner=${SCAN_OWNER:-${GITHUB_REPOSITORY_OWNER:-}}
scan_email='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'
scan_email_ok='(\.example$|@example\.(com|org|net)$|@users\.noreply\.github\.com$|^git@github\.com|@(types|kaninabe|supabase|vitest|next|axiomhq)[./]|@[0-9]|@127\.0\.0\.1|@registry\.npmjs\.org|@api\.axiom\.co|@auth\.external|^evil|\.(ts|tsx|js|mjs|json|md|png|svg)$)'
# Author and committer addresses allowed in history: GitHub noreply addresses, and GitHub's own web-flow committer.
# Both ends are anchored, and the pattern is applied to one address per line (an address from %ae / %ce holds no line break): a login is
# letters, digits, '-' and '_' (GitHub's own rule, plus the underscore of managed accounts), after an optional numeric id and '+'.
scan_ident_ok='^(([0-9]+\+)?[A-Za-z0-9_-]+@users\.noreply\.github\.com|noreply@github\.com)$'

# scan_grep ARGS...: grep, but an error (exit 2: bad pattern, unreadable file) is recorded in $scan_err and fails the
# scan at scan_finish. A pipeline runs it in a subshell, where `exit` alone would only end that subshell.
scan_err=$(mktemp)
. "$(dirname "$0")/neutral-git.sh"
grep_failed() { echo "scan: grep failed (exit $1): an invalid pattern or an unreadable input"; echo x >> "$scan_err"; exit 2; }
scan_grep() { grep_q "$@"; }

# scan_finish NAME FAIL: the one exit of a scan. A recorded grep error wins over a clean result.
scan_finish() {
  if [ -s "$scan_err" ]; then rm -f "$scan_err"; echo "$1: ERROR"; exit 2; fi
  rm -f "$scan_err"
  [ "$2" -eq 0 ] && echo "$1: clean" || { echo "$1: FAILED"; exit 1; }
}

# scan_check_patterns FILE: every line must be a valid extended regex.
scan_check_patterns() {
  [ -s "$1" ] || return 0
  scan_grep -qE -f "$1" /dev/null || true
}

# scan_attribution: reads text on stdin; succeeds (and so means "found") when an attribution line is present
# other than the owner's own co-author trailer.
scan_attribution() {
  t=$(cat)
  printf '%s\n' "$t" | scan_grep -iE "$scan_attrib" > /dev/null || return 1
  if [ -n "$scan_owner" ]; then
    ok="^co-authored-by: [^<@]*<([0-9]+\\+)?$scan_owner@users\\.noreply\\.github\\.com>\$"
    printf '%s\n' "$t" | scan_grep -iE "$scan_attrib" | { scan_grep -viE "$ok" || true; } | scan_grep -q . && return 0
    printf '%s\n' "$t" | scan_grep -iE '^co-authored-by:' | scan_grep -qiE "$scan_ai" && return 0
    return 1
  fi
  return 0
}

# scan_bad_email: reads text on stdin; succeeds when an email-like string outside the allowed shapes is present.
scan_bad_email() {
  { scan_grep -oE "$scan_email" || true; } | { scan_grep -vE "$scan_email_ok" || true; } | scan_grep -q .
}
