#!/bin/sh
# gitleaks for a public log: the old CI steps' key scans (`gitleaks dir .` / the history), run the way the push gate runs
# gitleaks, with output limited to what may be printed: ok, or a count, or a line saying that the run or its result could not
# be used. Nothing derived from gitleaks' output is printed (its errors can name paths and its findings name the file, the
# commit and the author, and the logs of a public repository are public); to see details, run gitleaks yourself.
#   - the configuration is the gate's fixed file (scripts/gitleaks-gate.toml), never one in the scanned tree or in the
#     environment; the ignore file is a path that does not exist and inline `gitleaks:allow` comments are not honoured;
#   - `dir` scans a copy of the directory without its .git and without any .gitleaksignore (gitleaks reads
#     <source>/.gitleaksignore whatever flag says); `git` reads the history from the neutral repository (see neutral-git.sh),
#     one commit at a time, each commit checked on its own (gitleaks cuts large input into chunks and can lose a key that
#     straddles a boundary, so a stream is not used for history);
#   - an error line in gitleaks' log, with exit 0 or with findings, is "could not run".
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
printf '%s\n' '{{ range . }}x{{ "\n" }}{{ end }}' > "$tmp/rules.tpl"

# gl <subcommand> <arguments...>: the tool with the fixed flags, in an environment of explicit inputs only.
gl() {
  gl_sub=$1; shift
  ng_env ${ng_empty:+"GIT_ATTR_SOURCE=$ng_empty"} "$bin" "$gl_sub" --no-banner --redact --exit-code 99 --log-level "${gl_level:-error}" --config "$cfg" \
    --gitleaks-ignore-path "$tmp/no-gitleaksignore" --ignore-gitleaks-allow "$@"
}
could_not_run() { echo "gitleaks $mode: could not run (exit $1)"; exit 2; }

rc=0
if [ "$mode" = dir ]; then
  mkdir "$tmp/src"
  # two steps, each checked (a pipe would lose the first tar's status)
  tar -C "$target" --exclude=.git -cf "$tmp/src.tar" . > /dev/null 2>&1 || could_not_run 2
  tar -C "$tmp/src" -xf "$tmp/src.tar" > /dev/null 2>&1 || could_not_run 2
  find "$tmp/src" -name .gitleaksignore -exec rm -f {} + || could_not_run 2
  ( cd "$tmp/src" && gl dir --report-format template --report-template "$tmp/rules.tpl" --report-path "$tmp/rules.out" . ) > /dev/null 2> "$tmp/gl.log" || rc=$?
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
    [ -s "$tmp/commits" ] || could_not_run 2
    # one commit at a time, each checked (scan_history in neutral-git.sh); the findings are summed and the count is the result
    scan_history "$tmp/commits" "$tmp/rules.tpl" "$tmp" || { echo "gitleaks git: $hist_err"; exit 2; }
    if [ "$hist_n" -gt 0 ]; then
      echo "gitleaks git: FAILED ($hist_n finding(s))"
      echo "  (details: run gitleaks yourself on your own copy, for example: gitleaks git .)"
      exit 1
    fi
  else
    echo "gitleaks git: ok"; exit 0
  fi
fi
case $rc in
  0 | 99) if [ -f "$tmp/gl.log" ] && log_has_error "$tmp/gl.log"; then echo "gitleaks $mode: could not run (it logged an error)"; exit 2; fi ;;
esac
case $rc in
  0) echo "gitleaks $mode: ok" ;;
  99)
    # findings: the report must be readable (every line the x of the template), else this is not "zero findings"
    if [ ! -s "$tmp/rules.out" ] || ! grep -q . "$tmp/rules.out" || grep . "$tmp/rules.out" | grep -qvx x; then echo "gitleaks $mode: could not read the result"; exit 2; fi
    echo "gitleaks $mode: FAILED ($(grep -c . "$tmp/rules.out") finding(s))"
    echo "  (details: run gitleaks yourself on your own copy, for example: gitleaks $mode .)"
    exit 1 ;;
  *) could_not_run "$rc" ;;
esac
