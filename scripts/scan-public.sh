#!/bin/sh
# Scans every commit (tree, message, author) for: product words, local paths, key shapes, email-like strings.
# The word list is read from the file named by $SCAN_WORDS_FILE (one extended regex per line; '#' and blank lines ignored)
# and is never printed. A line of the form `@<path-prefix> <regex>` applies only to files under that prefix
# (used to keep the rules under docs/rules free of any product's vocabulary). Output is limited to a commit short id, a file path, a line number and counts: never a matched
# line or snippet, because the logs of a public repository are public. Do not add `set -x` or echo any pattern.
# With SCAN_QUIET set, the places (the `at path:line` lines) are left out too: counts and short ids only.
# A failing `git rev-list` or `git grep` (exit above 1) stops the scan with exit 2; it never reads as "no match".
# Usage: scan-public.sh [<base>]   (scans <base>..HEAD, or every commit reachable from HEAD)
#        scan-public.sh --revs <rev-list arguments...>   (scans exactly the commits `git rev-list <arguments>` names;
#        used by push-gate.sh to hand over the same commit set as its other steps)
set -eu
# The scan runs with explicit inputs only, not with whatever the caller's environment and git configuration say: it
# starts itself again under `env -i`, keeping just the variables that are inputs of the scan (the word list, the owner,
# the quiet switch, PATH and the temporary directory) and the git directory of the repository, which is decided here once,
# in the caller's environment (repo-context.sh). The second start is told so by its first ARGUMENT, which only this
# re-exec passes: a marker in the environment could be set from outside and would skip the clean environment, so there is none.
if [ "${1:-}" = "--inside-clean-env" ]; then
  shift
  ng_repo=${GIT_DIR:-}
else
  . "$(dirname "$0")/repo-context.sh"
  repo_resolve || { echo "scan: $repo_error"; echo "scan-public: ERROR"; exit 2; }
  exec env -i PATH="$PATH" HOME=/nonexistent XDG_CONFIG_HOME=/nonexistent LC_ALL=C.UTF-8 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 GIT_DIR="$repo_gitdir" \
    ${TMPDIR:+"TMPDIR=$TMPDIR"} ${SCAN_WORDS_FILE:+"SCAN_WORDS_FILE=$SCAN_WORDS_FILE"} ${SCAN_OWNER:+"SCAN_OWNER=$SCAN_OWNER"} \
    ${GITHUB_REPOSITORY_OWNER:+"GITHUB_REPOSITORY_OWNER=$GITHUB_REPOSITORY_OWNER"} ${SCAN_QUIET:+"SCAN_QUIET=$SCAN_QUIET"} \
    sh "$0" --inside-clean-env "$@"
fi
. "$(dirname "$0")/scan-rules.sh"
. "$(dirname "$0")/neutral-git.sh"
if [ "${1:-}" = "--revs" ]; then shift; range="$*"; else range=${1:+$1..}HEAD; fi
pat=$(mktemp); trap 'rm -f "$pat" "$scoped" "$scan_err"' EXIT
if [ -n "${SCAN_WORDS_FILE:-}" ] && [ -s "$SCAN_WORDS_FILE" ]; then
  grep -v '^#' "$SCAN_WORDS_FILE" | grep -v '^$' | grep -v '^@' > "$pat" || true
  scoped=$(mktemp); grep '^@' "$SCAN_WORDS_FILE" > "$scoped" || true
else
  scoped=$(mktemp)
fi
scan_check_patterns "$pat"
while IFS= read -r line; do printf '%s\n' "${line#* }" > "$pat.one"; scan_check_patterns "$pat.one"; done < "$scoped"; rm -f "$pat.one"
fail=0
generic='/Users/[A-Za-z]|/home/[a-z]+/|C:\\Users|BEGIN [A-Z ]*PRIVATE KEY'
email=$scan_email
email_ok=$scan_email_ok
commits=$(mktemp); gg_out=$(mktemp); ng_work=$(mktemp -d)
trap 'rm -rf "$pat" "$scoped" "$commits" "$gg_out" "$ng_work" "$scan_err"' EXIT
# git grep runs in a neutral repository (no attributes from the tree or the clone, no user config): see neutral-git.sh.
neutral_git_setup "$ng_work" || { echo "scan: $ng_error"; echo "scan-public: ERROR"; exit 2; }
# A rev-list that fails is not an empty range: it stops the scan (exit 2), it does not read as "clean".
rc=0; git rev-list $range > "$commits" 2>/dev/null || rc=$?
if [ "$rc" -ne 0 ]; then echo "scan: git rev-list failed (exit $rc)"; echo "scan-public: ERROR"; exit 2; fi
# gg ARGS...: git grep into $gg_out. Exit 1 (no match) is an empty result; anything above is an error that stops the scan.
gg() {
  rc=0; neutral_git grep "$@" > "$gg_out" 2>/dev/null || rc=$?
  if [ "$rc" -gt 1 ]; then echo "scan: git grep failed (exit $rc)"; echo "scan-public: ERROR"; exit 2; fi
}
lines() { wc -l < "$gg_out" | tr -d ' '; }
# show_at: the places (path:line) of the last gg -n; not printed when SCAN_QUIET is set (a public log: counts only).
show_at() { [ -n "${SCAN_QUIET:-}" ] || { cut -d: -f2,3 "$gg_out" | head -50 | sed "s|^|  at |"; }; }
for c in $(cat "$commits"); do
  short=$(echo "$c" | cut -c1-8)
  if [ -s "$pat" ]; then
    gg -IlE -f "$pat" "$c"; n=$(lines)
    if [ "$n" != "0" ]; then echo "word list: $n file(s) in $short"; gg -InE -f "$pat" "$c"; show_at; fail=1; fi
    if git log -1 --format='%an %ae %cn %ce%n%B' "$c" | grep -qiE -f "$pat"; then echo "word list: commit message or author of $short"; fail=1; fi
  fi
  while IFS= read -r line; do
    prefix=${line%% *}; prefix=${prefix#@}; re=${line#* }
    gg -IlE "$re" "$c" -- "$prefix"; n=$(lines)
    if [ "$n" != "0" ]; then if [ -n "${SCAN_QUIET:-}" ]; then echo "scoped word list: $n file(s) in $short"; else echo "scoped word list: $n file(s) under $prefix in $short"; fi; gg -InE "$re" "$c" -- "$prefix"; show_at; fail=1; fi
  done < "$scoped"
  if git log -1 --format='%B' "$c" | scan_attribution; then echo "attribution line in $short"; fail=1; fi
  # Author and committer: a GitHub noreply address naming no AI. A squash merge turns each into a co-author trailer.
  if git log -1 --format='%an%n%cn' "$c" | scan_grep -qiE "$scan_ai" \
     || git log -1 --format='%ae%n%ce' "$c" | { scan_grep -viE "$scan_ident_ok" || true; } | scan_grep -q .; then
    echo "author or committer not allowed in $short"; fail=1
  fi
  if git log -1 --format='%B' "$c" | scan_bad_email; then echo "email-like string in the message of $short"; fail=1; fi
  gg -IlE "$generic" "$c" -- . ':!package-lock.json' ':!**/package-lock.json'; n=$(lines)
  if [ "$n" != "0" ]; then
    gg -IhoE '/Users/[A-Za-z0-9_.-]+|/home/[a-z0-9_.-]+/|C:\\Users|BEGIN [A-Z ]*PRIVATE KEY' "$c" -- . ':!package-lock.json' ':!**/package-lock.json'
    m=$(sed 's/^[^:]*://' "$gg_out" | { scan_grep -vE '^/home/(u|a|user|x|me|app|runner|node)/$' || true; } | wc -l | tr -d ' ')
    if [ "$m" != "0" ]; then echo "local path or key shape: $m hit(s) in $short"; fail=1; fi
  fi
  gg -IhoE "$email" "$c" -- . ':!package-lock.json' ':!**/package-lock.json'
  m=$(sed 's/^[^:]*://' "$gg_out" | { scan_grep -vE "$email_ok" || true; } | wc -l | tr -d ' ')
  if [ "$m" != "0" ]; then echo "email-like string: $m hit(s) in $short"; fail=1; fi
done
scan_finish scan-public "$fail"
