#!/bin/sh
# The push-before gate: the one script that runs every check that must be green before commits are pushed to a public
# repository (docs/rules/process/common/development-flow.md, "security"). The hook (.githooks/pre-push) and CI call it.
# Usage: push-gate.sh --mode words|general (--base <sha> | --not-on-remote <remote> | --all)
#   --mode words    the word list (the file named by $SCAN_WORDS_FILE) is required; without it the gate stops.
#                   Used by the hook, pr-gate and the CI of the main branch.
#   --mode general  the rules without the word list (the list is never read, even if set). For pull requests and
#                   branches, and for a fork's pull request, which cannot be given the list.
#   There is no default mode. A missing or unknown mode is an error.
#   --base <sha>            the commits in <sha>..HEAD
#   --not-on-remote <name>  the commits reachable from HEAD and from no remote-tracking ref of that remote (a remote with
#                           no tracking refs is every commit, which is the fail-safe)
#   --all                   every commit reachable from HEAD
# Steps: (1) gitleaks over those commits; (2) scripts/scan-public.sh over the same commits; (3) every workflow file of
# HEAD (.github/workflows) must parse and pass actionlint. An empty range passes (1) and (2), and (3) still runs.
# Fail closed: a missing gitleaks or actionlint, a missing word list in words mode, and any step that errors (as opposed
# to finding something) stop the gate. Exit 0 = passed, 1 = a step found something, 2 = the gate could not run.
# Output is limited to step names, counts, commit short ids, file paths and line numbers. It never prints a matched word,
# a pattern or a line of scanned text, so there is no `set -x` here and nothing from the word list is echoed. In CI
# (a public log) gitleaks findings are reduced to rule names and counts.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
die() { echo "push-gate: $*" >&2; exit 2; }

mode_set=0; mode=
n_ranges=0; range_kind=; range_val=
while [ $# -gt 0 ]; do
  case $1 in
    --mode) [ $# -ge 2 ] || die "--mode needs a value"; mode=$2; mode_set=1; shift 2 ;;
    --base) [ $# -ge 2 ] || die "--base needs a value"; range_kind=base; range_val=$2; n_ranges=$((n_ranges + 1)); shift 2 ;;
    --not-on-remote) [ $# -ge 2 ] || die "--not-on-remote needs a value"; range_kind=remote; range_val=$2; n_ranges=$((n_ranges + 1)); shift 2 ;;
    --all) range_kind=all; n_ranges=$((n_ranges + 1)); shift ;;
    *) die "unknown argument (usage: push-gate.sh --mode words|general --base <sha> | --not-on-remote <remote> | --all)" ;;
  esac
done
[ "$mode_set" = 1 ] || die "--mode is required (words or general)"
case $mode in words | general) ;; *) die "unknown mode \"$mode\" (words or general)" ;; esac
[ "$n_ranges" = 1 ] || die "exactly one of --base, --not-on-remote, --all is required"

top=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$top"

if [ "$mode" = words ]; then
  if [ -n "${SCAN_WORDS_FILE:-}" ] && [ -f "$SCAN_WORDS_FILE" ] && [ -r "$SCAN_WORDS_FILE" ] && [ -s "$SCAN_WORDS_FILE" ]; then :
  else die "words mode needs the word list (SCAN_WORDS_FILE is unset, empty or unreadable)"; fi
else
  unset SCAN_WORDS_FILE
fi
command -v gitleaks >/dev/null 2>&1 || die "gitleaks is not on PATH"
command -v actionlint >/dev/null 2>&1 || die "actionlint is not on PATH"

# The commits, as arguments of `git rev-list` and `git log`.
case $range_kind in
  base)
    case $range_val in -*) die "--base is not a commit of this repository" ;; esac
    base=$(git rev-parse --verify -q "$range_val^{commit}") || die "--base is not a commit of this repository"
    revs="$base..HEAD" ;;
  remote)
    case $range_val in
      '' | -* | *[!A-Za-z0-9._-]*) die "not a valid remote name" ;;
    esac
    revs="HEAD --not --remotes=$range_val" ;;
  all) revs="HEAD" ;;
esac
git rev-parse --verify -q 'HEAD^{commit}' >/dev/null || die "HEAD is not a commit"
count=$(git rev-list $revs | wc -l | tr -d ' ') || die "could not list the commits"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failed=

# Step 1: gitleaks. Findings exit 99 (so that gitleaks' own errors, which exit 1, are told apart from findings).
# The report is a template that holds only the rule, the file, the line and the short commit id.
if [ "$count" -gt 0 ]; then
  printf '%s\n' '{{ range . }}{{ .RuleID }} {{ .File }}:{{ .StartLine }} {{ printf "%.8s" .Commit }}{{ "\n" }}{{ end }}' > "$tmp/gitleaks.tpl"
  rc=0
  gitleaks git --no-banner --redact --exit-code 99 --log-level error \
    --report-format template --report-template "$tmp/gitleaks.tpl" --report-path "$tmp/gitleaks.out" \
    --log-opts="$revs" . > /dev/null 2>&1 || rc=$?
  case $rc in
    0) echo "push-gate: step gitleaks: ok ($count commit(s))" ;;
    99)
      : > "$tmp/gitleaks.lines"
      [ ! -f "$tmp/gitleaks.out" ] || grep . "$tmp/gitleaks.out" > "$tmp/gitleaks.lines" || true
      n=$(wc -l < "$tmp/gitleaks.lines" | tr -d ' ')
      echo "push-gate: step gitleaks: FAILED ($n finding(s))"
      if [ -n "${CI:-}" ]; then cut -d' ' -f1 "$tmp/gitleaks.lines" | sort | uniq -c | sed 's/^ *\([0-9]*\) \(.*\)$/  rule \2: \1/'
      else sed 's/^/  at /' "$tmp/gitleaks.lines" | head -50; fi
      failed="gitleaks" ;;
    *) die "step gitleaks could not run (exit $rc)" ;;
  esac
else
  echo "push-gate: step gitleaks: skipped (no commits in range)"
fi

# Step 2: the repository's own scan over the same commits (scan-public prints places, never matched text).
if [ "$count" -gt 0 ]; then
  rc=0
  # shellcheck disable=SC2086
  sh "$here/scan-public.sh" --revs $revs > "$tmp/scan-public.out" 2>&1 || rc=$?
  cat "$tmp/scan-public.out"
  case $rc in
    0) echo "push-gate: step scan-public: ok ($count commit(s))" ;;
    1) echo "push-gate: step scan-public: FAILED"; failed="${failed:+$failed, }scan-public" ;;
    *) die "step scan-public could not run (exit $rc)" ;;
  esac
else
  echo "push-gate: step scan-public: skipped (no commits in range)"
fi

# Step 3: the workflow files of HEAD (the committed tree, not the working tree), each parsed and checked by actionlint.
# actionlint's own config file is not extracted, so that a file in the tree cannot switch checks off; the shellcheck
# and pyflakes integrations are off so that the result does not depend on what else is installed. The report template
# holds only the file, the line and the kind of problem, never the message or the source line.
files=$(git ls-tree -r --name-only HEAD -- .github/workflows | grep -E '\.ya?ml$' || true)
if [ -z "$files" ]; then
  echo "push-gate: step workflows: ok (no workflow files)"
else
  nfiles=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
  if printf '%s\n' "$files" | grep -qvE '^[A-Za-z0-9._/-]+$'; then
    die "step workflows could not run (a workflow file name has an unsupported character)"
  fi
  mkdir "$tmp/tree"
  git archive HEAD .github | tar -x -C "$tmp/tree" || die "step workflows could not run (could not read the committed files)"
  rm -f "$tmp/tree/.github/actionlint.yaml" "$tmp/tree/.github/actionlint.yml"
  rc=0
  # shellcheck disable=SC2086
  ( cd "$tmp/tree" && actionlint -no-color -shellcheck= -pyflakes= \
      -format '{{range $e := .}}{{$e.Filepath}}:{{$e.Line}}: [{{$e.Kind}}]|{{end}}' $files ) > "$tmp/actionlint.raw" 2>/dev/null || rc=$?
  # (actionlint cannot be given a line feed or a \n escape in the template; entries are cut at '|' here.)
  tr '|' '\n' < "$tmp/actionlint.raw" | grep . > "$tmp/actionlint.out" || true
  case $rc in
    0) echo "push-gate: step workflows: ok ($nfiles file(s))" ;;
    1)
      echo "push-gate: step workflows: FAILED"
      sed 's/^/  at /' "$tmp/actionlint.out" | head -50
      failed="${failed:+$failed, }workflows" ;;
    *) die "step workflows could not run (exit $rc)" ;;
  esac
fi

if [ -n "$failed" ]; then echo "push-gate: FAILED ($failed)"; exit 1; fi
echo "push-gate: passed (mode $mode, $count commit(s))"
