# Rules shared by scan-public.sh and scan-pr-text.sh (sourced, not run, after `set -eu`). Every check here fails closed:
# a pattern a grep cannot compile, a file it cannot open, a git command that fails or a word list that cannot be read
# stops the scan with exit 2 instead of reading as "no match". Nothing here prints a matched line, a path or a word from
# the list (the logs of a public repository are public): output is a rule name, a short commit id and a count.
# The script that sources this file sets $scan_name and must not set its own EXIT trap.

# One temp directory for everything; the one EXIT trap removes it, an interrupt becomes a failure (exit 2).
scan_tmp=$(mktemp -d) || { echo "scan: cannot make a temp directory"; exit 2; }
trap 'rm -rf "$scan_tmp"' EXIT
trap 'exit 2' HUP INT TERM
scan_err=$scan_tmp/err
scan_pat=$scan_tmp/pat
scan_scoped=$scan_tmp/scoped
: > "$scan_pat"; : > "$scan_scoped"
fail=0

# scan_fail MESSAGE: records a scan error. A pipeline runs commands in a subshell, where `exit` would only end that
# subshell, so the error goes to a file that scan_finish reads.
scan_fail() { echo "scan: $1"; echo x >> "$scan_err"; }

# Names of AI tools and bots. `scan_ai_sub` may appear anywhere in a name or an address; `scan_ai_words` only at the
# start of a word (a short name inside another word is not a tool). `scan_ai` is for identities and trailers.
scan_ai_sub='claude|anthropic|copilot|codex|openai|chatgpt|\[bot\]'
scan_ai_words='gemini|cursor|devin|gpt|llm|aider|windsurf|grok|perplexity|deepseek|bot([^[:alnum:]]|$)'
scan_ai="$scan_ai_sub|(^|[^[:alnum:]])($scan_ai_words)"
# A link to a session, a share page or a task of an AI chat or agent service. The class is the host (any path under the
# chat hosts; the session-like paths on hosts that also have ordinary pages), so a new path on a known host is caught.
scan_ai_url='(^|[^[:alnum:].-])([a-z0-9-]+\.)?((claude\.ai|chatgpt\.com|chat\.openai\.com|gemini\.google\.com|bard\.google\.com|aistudio\.google\.com|copilot\.microsoft\.com|perplexity\.ai|poe\.com|grok\.com|chat\.mistral\.ai|chat\.deepseek\.com|devin\.ai)/[^[:space:]]|(claude\.com|openai\.com)/(chat|share|code|codex|c)/|cursor\.com/(agents|chat)|g\.co/gemini)'
# Lines that attribute work to an AI: trailers, "generated with", a phrasing that names an AI, a session link, and any
# `<word>-by:` trailer naming an AI, whatever the word.
scan_attrib="co-?authored|claude-session|generated[[:space:]]+(with|by|using|via)|noreply@anthropic|$scan_ai_url|(generated|written|created|authored|assisted|made|produced|drafted|coded|built|powered)[[:space:]]+(with|by|using|via|through|from).*($scan_ai)|^[[:space:]]*[a-z-]+-by[[:space:]]*:(.*[^[:alnum:]])?($scan_ai_sub|$scan_ai_words)"
# The one co-author trailer allowed in a commit message: the one a squash merge adds for the repository owner's own
# noreply address (owner from $SCAN_OWNER, else the Actions variable GITHUB_REPOSITORY_OWNER; with neither, none).
scan_owner=${SCAN_OWNER:-${GITHUB_REPOSITORY_OWNER:-}}
case $scan_owner in *[!A-Za-z0-9-]*) echo "scan: the repository owner is not a plain account name"; exit 2 ;; esac
scan_email='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'
# Allowed email-like strings, each matched as a whole (an allowlist that is not anchored lets look-alikes through):
# reserved example domains, GitHub's noreply forms, version specifiers (pkg@1.2.3), and a few fixed strings.
scan_email_ok='^([^@]+@(([a-z0-9-]+\.)*example\.(com|org|net)|[a-z0-9.-]*\.(example|test|invalid|localhost)|users\.noreply\.github\.com|registry\.npmjs\.org|api\.axiom\.co|v?[0-9]+(\.[0-9]+)+(-[0-9a-z.-]+)?)|git@github\.com|noreply@github\.com|dotted_key@auth\.external\.apple\.enabled)$'
# An address written with a full-width or small commercial at sign: never an allowed shape.
scan_email_wide='[A-Za-z0-9._%+-]+(＠|﹫)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'
# Local paths and key shapes. The tails of the last two are written so that this file does not match itself.
scan_pathre='/Users/[A-Za-z0-9_.-]+|/home/[A-Za-z0-9_.-]+|[A-Za-z]:\\[Uu][Ss][Ee][Rr][Ss]|[A-Za-z]:/Users|(^|[^A-Za-z0-9_./-])/ro[o]t/|/tmp/clau[d]e-|BEGIN [A-Z ]*PRIVATE KEY'
# The placeholder users are the ones the fixtures use (Je and JE are the part before a non-ASCII letter in a fixture name).
scan_path_ok='/home/(u|a|user|x|me|app|runner|node|Jess|JESS|Je|JE)'
# Author and committer addresses allowed in history: the owner's noreply address (any GitHub account when there is no
# owner) and GitHub's own web-flow committer. A squash merge turns each into a co-author trailer, so the same list holds.
if [ -n "$scan_owner" ]; then who=$scan_owner; else who='[A-Za-z0-9-]+'; fi
scan_ident_ok="^(([0-9]+\\+)?$who@users\\.noreply\\.github\\.com|noreply@github\\.com)\$"

# scan_grep ARGS...: grep in text mode. Exit 2 (bad pattern, unreadable input) is recorded in $scan_err; stderr is never
# shown (an error message can quote a pattern). Returns grep's own status, so a caller sees 0 (found) or 1 (not found).
scan_grep() {
  rc=0; grep -a "$@" 2>/dev/null || rc=$?
  if [ "$rc" -gt 1 ]; then scan_fail "grep failed (exit $rc): an invalid pattern or an unreadable input"; fi
  return "$rc"
}

# scan_finish: the one exit of a scan. A recorded error wins over a clean result.
scan_finish() {
  if [ -s "$scan_err" ]; then echo "$scan_name: ERROR"; exit 2; fi
  [ "$fail" -eq 0 ] && echo "$scan_name: clean" || { echo "$scan_name: FAILED"; exit 1; }
}

# scan_check_patterns FILE: every line must be a valid extended regex (for grep; scan-public.sh also asks git grep).
scan_check_patterns() {
  [ -s "$1" ] || return 0
  scan_grep -qE -f "$1" /dev/null || true
}

# scan_load_words NEED: reads the word list named by $SCAN_WORDS_FILE into $scan_pat (plain lines) and $scan_scoped
# (`@<path-prefix> <regex>` lines); '#' and blank lines are dropped, CRLF and a UTF-8 byte order mark are removed.
# $scan_require=1 means a missing list is an error; NEED is `plain` when a plain pattern is needed, else `any`.
# A list that is named but cannot be read, holds a NUL, or holds nothing is always an error: it is a mistake in how
# the scan is set up, and "no words" must not read as "no hits".
scan_load_words() {
  list=${SCAN_WORDS_FILE:-}
  if [ -z "$list" ]; then
    if [ "$scan_require" = 1 ]; then echo "$scan_name: the word list is required, but SCAN_WORDS_FILE is not set"; exit 2; fi
    echo "word list: NOT USED (SCAN_WORDS_FILE is not set; only the generic rules ran)"; return 0
  fi
  { [ -f "$list" ] && [ -r "$list" ]; } || { echo "$scan_name: the word list cannot be read"; exit 2; }
  bom=$(printf '\357\273\277')
  tr -d '\r' < "$list" > "$scan_tmp/list" || { echo "$scan_name: the word list cannot be read"; exit 2; }
  nul=$(tr -cd '\000' < "$scan_tmp/list" | wc -c | tr -d ' ')
  [ "${nul:-x}" = 0 ] || { echo "$scan_name: the word list holds a NUL byte"; exit 2; }
  sed "1s/^$bom//" "$scan_tmp/list" > "$scan_tmp/list2" || { echo "$scan_name: the word list cannot be read"; exit 2; }
  awk -v p="$scan_pat" -v s="$scan_scoped" '/^#/ { next } /^$/ { next } /^@/ { print > s; next } { print > p }' "$scan_tmp/list2" \
    || { echo "$scan_name: the word list cannot be read"; exit 2; }
  np=$(wc -l < "$scan_pat" | tr -d ' '); ns=$(wc -l < "$scan_scoped" | tr -d ' ')
  if [ "$np" -eq 0 ] && [ "$ns" -eq 0 ]; then echo "$scan_name: the word list holds no pattern"; exit 2; fi
  if [ "$1" = plain ] && [ "$np" -eq 0 ]; then echo "$scan_name: the word list holds no plain pattern"; exit 2; fi
  echo "word list: used ($np pattern(s), $ns scoped)"
}

# scan_attribution FILE OWNER: succeeds (and so means "found") when FILE has an attribution line other than OWNER's own
# co-author trailer. With no OWNER, every co-author trailer counts.
scan_attribution() {
  a=$scan_tmp/attr; rc=0
  scan_grep -iE -e "$scan_attrib" "$1" > "$a" || rc=$?
  [ "$rc" -eq 0 ] || return 1
  [ -n "$2" ] || return 0
  ok="^co-authored-by: [^<@]*<([0-9]+\\+)?$2@users\\.noreply\\.github\\.com>\$"
  scan_grep -viE -e "$ok" "$a" > "$a.rest" || true
  [ ! -s "$a.rest" ] || return 0
  scan_grep -iE '^co-authored-by:' "$1" > "$a.co" || true
  scan_grep -qiE -e "($scan_ai)" "$a.co" && return 0
  return 1
}

# scan_path_hit FILE: succeeds when FILE holds a local path or key shape that is not one of the placeholder users.
scan_path_hit() {
  scan_grep -oE -e "$scan_pathre" "$1" > "$scan_tmp/ph" || true
  [ -s "$scan_tmp/ph" ] || return 1
  scan_grep -vxE -e "$scan_path_ok" "$scan_tmp/ph" > "$scan_tmp/ph.rest" || true
  [ -s "$scan_tmp/ph.rest" ]
}

# scan_bad_email FILE: succeeds when FILE holds an email-like string outside the allowed shapes.
scan_bad_email() {
  scan_grep -oE -e "$scan_email" "$1" > "$scan_tmp/em" || true
  scan_grep -viE -e "$scan_email_ok" "$scan_tmp/em" > "$scan_tmp/em.rest" || true
  [ ! -s "$scan_tmp/em.rest" ] || return 0
  scan_grep -qE -e "$scan_email_wide" "$1"
}

# scan_text FILE WHERE OWNER: the rules for a piece of text (a commit message, a pull request's title and body). Each
# broken rule prints `<rule>: WHERE` and sets $fail. OWNER is whose co-author trailer is allowed ("" for none).
scan_text() {
  nul=$(tr -cd '\000' < "$1" | wc -c | tr -d ' ')
  [ "${nul:-x}" = 0 ] || { echo "NUL byte: $2"; fail=1; }
  if [ -s "$scan_pat" ] && scan_grep -qiE -f "$scan_pat" "$1"; then echo "word list: $2"; fail=1; fi
  if scan_attribution "$1" "$3"; then echo "attribution line: $2"; fail=1; fi
  if scan_path_hit "$1"; then echo "local path or key shape: $2"; fail=1; fi
  if scan_bad_email "$1"; then echo "email-like string: $2"; fail=1; fi
}
