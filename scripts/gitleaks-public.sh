#!/bin/sh
# gitleaks for a public log: the old CI steps' key scans (`gitleaks dir .` / `gitleaks git .`), run the way the push gate
# runs gitleaks, with output limited to what may be printed: ok, or a count and rule names, or a line saying that the run
# or its result could not be used. gitleaks' own messages are never shown: its errors can name paths and its findings name
# the file, the commit and the author, and the logs of a public repository are public.
#   - the configuration is the gate's fixed file (scripts/gitleaks-gate.toml), never one in the scanned tree or in the
#     environment; the ignore file is a path that does not exist and inline `gitleaks:allow` comments are not honoured;
#   - `dir` scans a copy of the directory without its .git and without any .gitleaksignore (gitleaks reads
#     <source>/.gitleaksignore whatever flag says); `git` reads the history from the neutral repository (objects only: see
#     neutral-git.sh), given as commit ids, so local config, info/attributes, grafts and replace refs cannot change it;
#   - a rule name is printed only in the shape [a-z0-9][a-z0-9-]{0,63}; any other text is counted as "other".
# Usage: gitleaks-public.sh dir|git [<path>]     ($GL_BIN names the gitleaks binary; default: gitleaks on PATH)
# Exit 0 = nothing found, 1 = found, 2 = could not run, or could not read the result (a result that cannot be read is never
# "nothing found"), or bad usage.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-}
case $mode in dir | git) ;; *) echo "gitleaks-public: usage: gitleaks-public.sh dir|git [<path>]" >&2; exit 2 ;; esac
target=${2:-.}
bin=${GL_BIN:-gitleaks}
case $bin in /*) ;; */*) bin="$(pwd)/$bin" ;; esac   # a relative path must survive the cd below
. "$here/repo-context.sh"
. "$here/neutral-git.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cfg="$here/gitleaks-gate.toml"
[ -f "$cfg" ] && [ -r "$cfg" ] || { echo "gitleaks $mode: could not run (the fixed config is missing)"; exit 2; }
printf '%s\n' '{{ range . }}{{ .RuleID }}{{ "\n" }}{{ end }}' > "$tmp/rules.tpl"

# gl <subcommand> <arguments...>: the tool with the fixed flags, in an environment of explicit inputs only.
gl() {
  gl_sub=$1; shift
  ng_env ${ng_empty:+"GIT_ATTR_SOURCE=$ng_empty"} "$bin" "$gl_sub" --no-banner --redact --exit-code 99 --log-level "${gl_level:-error}" --config "$cfg" \
    --gitleaks-ignore-path "$tmp/no-gitleaksignore" --ignore-gitleaks-allow \
    --report-format template --report-template "$tmp/rules.tpl" --report-path "$tmp/rules.out" "$@"
}
could_not_run() { echo "gitleaks $mode: could not run (exit $1)"; exit 2; }

# gl_scanned <log>: the number in gitleaks' "N commits scanned." line, or nothing (the log is private and never printed)
gl_scanned() { tr -d '\033' < "$1" | sed 's/\[[0-9;]*m//g' | sed -n 's/.*[^0-9]\([0-9][0-9]*\) commits scanned.*/\1/p' | tail -1; }

# confirm_scanned: for the git scan, what gitleaks says it scanned must be our list (gitleaks exits 0 with "0 commits scanned"
# when it cannot read its options). The log is never printed.
confirm_scanned() {
  [ "$mode" = git ] || return 0
  scanned=$(gl_scanned "$tmp/gl.log")
  # gitleaks counts only commits whose patch has something to scan: a number it printed, not more than our list, and not 0
  # when our list adds a text line
  [ -n "$scanned" ] && [ "$scanned" -le "$ours" ] || { echo "gitleaks git: could not confirm what it scanned"; exit 2; }
  if [ "$scanned" -eq 0 ]; then
    # shellcheck disable=SC2046
    if neutral_git log -m --format= -p -U0 $(cat "$tmp/commit-tips.u") 2>/dev/null | grep -qE '^\+([^+]|\+[^+ ])'; then
      echo "gitleaks git: could not confirm what it scanned"; exit 2
    fi
  fi
}

rc=0
if [ "$mode" = dir ]; then
  mkdir "$tmp/src"
  # two steps, each checked (a pipe would lose the first tar's status)
  tar -C "$target" --exclude=.git -cf "$tmp/src.tar" . > /dev/null 2>&1 || could_not_run 2
  tar -C "$tmp/src" -xf "$tmp/src.tar" > /dev/null 2>&1 || could_not_run 2
  find "$tmp/src" -name .gitleaksignore -exec rm -f {} + || could_not_run 2
  ( cd "$tmp/src" && gl dir . ) > /dev/null 2>&1 || rc=$?
else
  cd "$target" 2>/dev/null || could_not_run 2
  repo_resolve || could_not_run 2
  ng_repo=$repo_gitdir
  # one shared check: stops for a shallow clone and for a repository that is not SHA-1
  neutral_git_setup "$tmp" || could_not_run 2
  # every commit that a ref (or HEAD) of the real repository reaches, as ids; a tip that is missing, or a list that cannot
  # be read, stops here (exit 2): only a repository that truly has no commit is "ok" without a scan
  ng_real git for-each-ref --format='%(objectname)' > "$tmp/tips" 2>/dev/null || could_not_run 2
  ng_real git rev-parse -q --verify 'HEAD^{commit}' >> "$tmp/tips" 2>/dev/null || true
  sort -u "$tmp/tips" > "$tmp/tips.u"
  : > "$tmp/commit-tips"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    type=$(neutral_git cat-file -t "$t" 2>/dev/null) || could_not_run 2
    case $type in
      commit) printf '%s\n' "$t" >> "$tmp/commit-tips" ;;
      tag) peeled=$(neutral_git rev-parse --verify -q "$t^{}" 2>/dev/null) || could_not_run 2
           [ "$(neutral_git cat-file -t "$peeled" 2>/dev/null)" != commit ] || printf '%s\n' "$peeled" >> "$tmp/commit-tips" ;;
    esac
  done < "$tmp/tips.u"
  if [ -s "$tmp/commit-tips" ]; then
    sort -u "$tmp/commit-tips" > "$tmp/commit-tips.u"
    # shellcheck disable=SC2046
    neutral_git rev-list $(cat "$tmp/commit-tips.u") > "$tmp/commits" 2>/dev/null || could_not_run 2
    ours=$(wc -l < "$tmp/commits" | tr -d ' ')
    [ "$ours" -gt 0 ] || could_not_run 2
    gl_level=info
    gl git --log-opts="-m $(tr '\n' ' ' < "$tmp/commit-tips.u" | sed 's/ $//')" "$ng_dir" > /dev/null 2> "$tmp/gl.log" || rc=$?
    gl_level=error
  else
    echo "gitleaks git: ok"; exit 0
  fi
fi
case $rc in
  0) confirm_scanned; echo "gitleaks $mode: ok" ;;
  99)
    # findings: the report must be readable (not missing, not empty), else this is not "zero findings"
    if [ ! -s "$tmp/rules.out" ] || ! grep -q . "$tmp/rules.out"; then echo "gitleaks $mode: could not read the result"; exit 2; fi
    grep . "$tmp/rules.out" > "$tmp/lines"
    confirm_scanned
    echo "gitleaks $mode: FAILED ($(wc -l < "$tmp/lines" | tr -d ' ') finding(s))"
    awk '{ if ($0 ~ /^[a-z0-9][a-z0-9-]{0,63}$/) print $0; else print "other" }' "$tmp/lines" | sort | uniq -c | sed 's/^ *\([0-9]*\) \(.*\)$/  rule \2: \1/'
    exit 1 ;;
  *) could_not_run "$rc" ;;
esac
