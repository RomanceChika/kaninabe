#!/bin/sh
# gitleaks for a public log: the old CI steps' scans (`gitleaks dir .` / `gitleaks git .`, with the tool's own
# configuration handling, unchanged) with output limited to what may be printed: ok, or a count and rule names, or the
# exit code of a run that failed. gitleaks' own messages are never shown: its errors can name paths and its findings
# name the file, the commit and the author, and the logs of a public repository are public.
# Usage: gitleaks-public.sh dir|git [<path>]     ($GL_BIN names the gitleaks binary; default: gitleaks on PATH)
# Exit 0 = nothing found, 1 = found, 2 = could not run (or bad usage).
set -eu
mode=${1:-}
case $mode in dir | git) ;; *) echo "gitleaks-public: usage: gitleaks-public.sh dir|git [<path>]" >&2; exit 2 ;; esac
target=${2:-.}
bin=${GL_BIN:-gitleaks}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' '{{ range . }}{{ .RuleID }}{{ "\n" }}{{ end }}' > "$tmp/rules.tpl"
rc=0
"$bin" "$mode" "$target" --no-banner --redact --exit-code 99 --log-level error \
  --report-format template --report-template "$tmp/rules.tpl" --report-path "$tmp/rules.out" > /dev/null 2>&1 || rc=$?
case $rc in
  0) echo "gitleaks $mode: ok" ;;
  99)
    : > "$tmp/lines"; [ ! -f "$tmp/rules.out" ] || grep . "$tmp/rules.out" > "$tmp/lines" || true
    echo "gitleaks $mode: FAILED ($(wc -l < "$tmp/lines" | tr -d ' ') finding(s))"
    sort "$tmp/lines" | uniq -c | sed 's/^ *\([0-9]*\) \(.*\)$/  rule \2: \1/'
    exit 1 ;;
  *) echo "gitleaks $mode: could not run (exit $rc)"; exit 2 ;;
esac
