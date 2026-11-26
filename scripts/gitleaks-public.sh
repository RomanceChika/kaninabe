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
  ng_env ${ng_empty:+"GIT_ATTR_SOURCE=$ng_empty"} "$bin" "$gl_sub" --no-banner --redact --exit-code 99 --log-level error --config "$cfg" \
    --gitleaks-ignore-path "$tmp/no-gitleaksignore" --ignore-gitleaks-allow \
    --report-format template --report-template "$tmp/rules.tpl" --report-path "$tmp/rules.out" "$@"
}
could_not_run() { echo "gitleaks $mode: could not run (exit $1)"; exit 2; }

rc=0
if [ "$mode" = dir ]; then
  mkdir "$tmp/src"
  { tar -C "$target" --exclude=.git -cf - . | tar -C "$tmp/src" -xf -; } > /dev/null 2>&1 || could_not_run 2
  find "$tmp/src" -name .gitleaksignore -exec rm -f {} + || could_not_run 2
  ( cd "$tmp/src" && gl dir . ) > /dev/null 2>&1 || rc=$?
else
  cd "$target" 2>/dev/null || could_not_run 2
  repo_resolve || could_not_run 2
  ng_repo=$repo_gitdir
  neutral_git_setup "$tmp" || could_not_run 2
  # every commit that a ref (or HEAD) of the real repository reaches, as ids
  { ng_real git for-each-ref --format='%(objectname)'; ng_real git rev-parse -q --verify 'HEAD^{commit}' || true; } 2>/dev/null | sort -u > "$tmp/tips"
  : > "$tmp/commits"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    neutral_git rev-parse --verify -q "$t^{commit}" >> "$tmp/commits" 2>/dev/null || true
  done < "$tmp/tips"
  sort -u "$tmp/commits" > "$tmp/commits.u"
  if [ -s "$tmp/commits.u" ]; then
    gl git --log-opts="-m $(tr '\n' ' ' < "$tmp/commits.u" | sed 's/ $//')" "$ng_dir" > /dev/null 2>&1 || rc=$?
  fi
fi
case $rc in
  0) echo "gitleaks $mode: ok" ;;
  99)
    # findings: the report must be readable (not missing, not empty), else this is not "zero findings"
    if [ ! -s "$tmp/rules.out" ] || ! grep -q . "$tmp/rules.out"; then echo "gitleaks $mode: could not read the result"; exit 2; fi
    grep . "$tmp/rules.out" > "$tmp/lines"
    echo "gitleaks $mode: FAILED ($(wc -l < "$tmp/lines" | tr -d ' ') finding(s))"
    awk '{ if ($0 ~ /^[a-z0-9][a-z0-9-]{0,63}$/) print $0; else print "other" }' "$tmp/lines" | sort | uniq -c | sed 's/^ *\([0-9]*\) \(.*\)$/  rule \2: \1/'
    exit 1 ;;
  *) could_not_run "$rc" ;;
esac
