#!/bin/sh
# The push-before gate: the one script that runs every check that must be green before commits are pushed to a public
# repository (docs/rules/process/common/development-flow.md, "security"). The hook (.githooks/pre-push) and CI call it.
# Usage: push-gate.sh --mode words|general [--head <sha>] (--base <sha> | --not-on <sha>,<sha>... | --all)
#   --mode words    the word list (the file named by $SCAN_WORDS_FILE) is required; without it the gate stops.
#                   Used by the hook, pr-gate and the CI of the main branch.
#   --mode general  the rules without the word list (the list is never read, even if set). For pull requests and
#                   branches, and for a fork's pull request, which cannot be given the list.
#   There is no default mode. A missing or unknown mode is an error.
#   --base <sha>            the commits in <sha>..HEAD
#   --not-on <sha>,...      the commits reachable from HEAD and from none of the given commits (scripts/push-range.sh
#                           decides which: the ones the destination itself says it has)
#   --head <sha>            the commit that is being pushed (the hook passes it); the gate stops if HEAD is another commit
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
. "$here/repo-context.sh"
. "$here/neutral-git.sh"
die() { echo "push-gate: $*" >&2; exit 2; }

mode_set=0; mode=; want_head=
n_ranges=0; range_kind=; range_val=
while [ $# -gt 0 ]; do
  case $1 in
    --mode) [ $# -ge 2 ] || die "--mode needs a value"; mode=$2; mode_set=1; shift 2 ;;
    --base) [ $# -ge 2 ] || die "--base needs a value"; range_kind=base; range_val=$2; n_ranges=$((n_ranges + 1)); shift 2 ;;
    --not-on) [ $# -ge 2 ] || die "--not-on needs a value"; range_kind=noton; range_val=$2; n_ranges=$((n_ranges + 1)); shift 2 ;;
    --head) [ $# -ge 2 ] || die "--head needs a value"; want_head=$2; shift 2 ;;
    --all) range_kind=all; n_ranges=$((n_ranges + 1)); shift ;;
    *) die "unknown argument (usage: push-gate.sh --mode words|general --base <sha> | --not-on <sha>,<sha>... | --all)" ;;
  esac
done
[ "$mode_set" = 1 ] || die "--mode is required (words or general)"
case $mode in words | general) ;; *) die "unknown mode \"$mode\" (words or general)" ;; esac
[ "$n_ranges" = 1 ] || die "exactly one of --base, --not-on, --all is required"
if [ -n "$want_head" ]; then
  printf '%s\n' "$want_head" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$' || die "--head needs a full commit id"
fi

# The repository is decided here, in the caller's environment (GIT_DIR, --git-dir/--work-tree, the current directory),
# and handed explicitly to every git command below; see repo-context.sh.
repo_resolve_top || die "$repo_error"
cd "$repo_top"
ng_repo=$repo_gitdir

tmp=$(mktemp -d 2>/dev/null || TMPDIR=/tmp mktemp -d) || die "could not make a temporary directory"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/home"
# clean <command...>: every tool and every git command of the gate runs with an environment of explicit inputs only,
# not with the caller's (no GIT_*, GREP_*, GITLEAKS_* or anything else), without the user's or the system's git
# configuration, and with the locale and the temporary directory fixed.
clean() {
  env -i PATH="$PATH" HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/.config" TMPDIR="$tmp" LC_ALL=C.UTF-8 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 "$@"
}
# cgit <args...>: git of the repository found above, in the clean environment.
cgit() { clean GIT_DIR="$repo_gitdir" git "$@"; }

if [ "$mode" = words ]; then
  if [ -n "${SCAN_WORDS_FILE:-}" ] && [ -f "$SCAN_WORDS_FILE" ] && [ -r "$SCAN_WORDS_FILE" ] && [ -s "$SCAN_WORDS_FILE" ]; then :
  else die "words mode needs the word list (SCAN_WORDS_FILE is unset, empty or unreadable)"; fi
  # scan-public.sh takes every line that is not a comment or blank as a pattern; with none, nothing would be scanned.
  grep -v '^#' "$SCAN_WORDS_FILE" | grep -v '^$' | grep -q . || die "the word list has no pattern (only comments and blank lines): nothing would be scanned"
else
  unset SCAN_WORDS_FILE
fi
command -v gitleaks >/dev/null 2>&1 || die "gitleaks is not on PATH"
command -v actionlint >/dev/null 2>&1 || die "actionlint is not on PATH"

# The commits, as arguments of `git rev-list` and `git log`.
case $range_kind in
  base)
    case $range_val in -*) die "--base is not a commit of this repository" ;; esac
    base=$(cgit rev-parse --verify -q "$range_val^{commit}") || die "--base is not a commit of this repository"
    revs="$base..HEAD" ;;
  noton)
    # The commits that the destination is known to have (push-range.sh decides which): everything reachable from HEAD
    # except what is reachable from them.
    printf '%s\n' "$range_val" | grep -Eq '^([0-9a-f]{40}(,[0-9a-f]{40})*|[0-9a-f]{64}(,[0-9a-f]{64})*)$' || die "--not-on needs full commit ids, comma separated"
    for sha in $(printf '%s' "$range_val" | tr ',' ' '); do
      cgit rev-parse --verify -q "$sha^{commit}" >/dev/null || die "--not-on is not a commit of this repository"
    done
    revs="HEAD --not $(printf '%s' "$range_val" | tr ',' ' ')" ;;
  all) revs="HEAD" ;;
esac
cgit rev-parse --verify -q 'HEAD^{commit}' >/dev/null || die "HEAD is not a commit"
if [ -n "$want_head" ] && [ "$(cgit rev-parse --verify -q 'HEAD^{commit}')" != "$want_head" ]; then die "HEAD is not the commit being pushed"; fi

# The list is written to a file and the status checked: a failing rev-list is not an empty range.
cgit rev-list $revs > "$tmp/commits" 2>/dev/null || die "could not list the commits"
count=$(wc -l < "$tmp/commits" | tr -d ' ')
# The files of HEAD, exactly as committed (see neutral-git.sh: git archive would honour export-ignore and export-subst
# attributes of the tree). Both the tree scan and the workflow check read this export.
neutral_git_setup "$tmp" || die "$ng_error"
head_sha=$(cgit rev-parse --verify -q 'HEAD^{commit}') || die "HEAD is not a commit"
neutral_export "$head_sha" "$tmp/head" || die "could not export HEAD"
failed=

# Step 1: gitleaks, three ways: the patches of the commits (merges diffed against each parent: -m), each commit message,
# and the tree of HEAD exported cleanly (not the working tree). Findings exit 99 (so that gitleaks' own errors, which
# exit 1, are told apart from findings); anything else is "could not run". Reports are templates that hold only the
# rule, the file, the line and the short commit id; a message is reported by its commit id alone.
# Nothing in the scanned tree may change what is read: the configuration is the fixed file next to this script (not
# .gitleaks.toml of the tree, not GITLEAKS_CONFIG / GITLEAKS_CONFIG_TOML); the ignore file is a path that does not exist
# (not the default ".", where a .gitleaksignore of the tree would be read); inline `gitleaks:allow` comments are not
# honoured; no baseline is given. The environment is not the caller's (see clean above), so no GITLEAKS_* variable gets in.
# gitleaks also reads <source>/.gitleaksignore whatever --gitleaks-ignore-path says, so the history is scanned with the git
# directory as the source (it holds no such file) and the exported tree has every .gitleaksignore taken out before the scan.
gitdir=$repo_gitdir
gl_config="$here/gitleaks-gate.toml"
[ -f "$gl_config" ] && [ -r "$gl_config" ] || die "gitleaks-gate.toml is missing next to the gate"
# gl <subcommand> <arguments...>: gitleaks with the fixed flags; every path is one quoted argument (spaces are fine).
gl() {
  gl_sub=$1; shift
  clean gitleaks "$gl_sub" --no-banner --redact --exit-code 99 --log-level error --config "$gl_config" \
    --gitleaks-ignore-path "$tmp/no-gitleaksignore" --ignore-gitleaks-allow "$@"
}
if [ "$count" -gt 0 ]; then
  printf '%s\n' '{{ range . }}{{ .RuleID }} {{ .File }}:{{ .StartLine }} {{ printf "%.8s" .Commit }}{{ "\n" }}{{ end }}' > "$tmp/gitleaks.tpl"
  gl_lines="$tmp/gitleaks.lines"; : > "$gl_lines"
  gl_msgs=0
  rc=0
  gl git --report-format template --report-template "$tmp/gitleaks.tpl" --report-path "$tmp/gitleaks.out" --log-opts="-m $revs" "$gitdir" > /dev/null 2>&1 || rc=$?
  case $rc in 0) ;; 99) [ ! -f "$tmp/gitleaks.out" ] || grep . "$tmp/gitleaks.out" >> "$gl_lines" || true; echo x > "$tmp/gl.found" ;; *) die "step gitleaks could not run (exit $rc)" ;; esac
  : > "$tmp/gl.msgs"
  for c in $(cat "$tmp/commits"); do
    cgit log -1 --format=%B "$c" > "$tmp/msg" 2>/dev/null || die "step gitleaks could not run (could not read a commit message)"
    rc=0
    gl stdin < "$tmp/msg" > /dev/null 2>&1 || rc=$?
    case $rc in 0) ;; 99) echo "$c" | cut -c1-8 >> "$tmp/gl.msgs"; echo x > "$tmp/gl.found" ;; *) die "step gitleaks could not run (exit $rc)" ;; esac
  done
  find "$tmp/head" -name .gitleaksignore -exec rm -f {} + || die "step gitleaks could not run (could not prepare the export of HEAD)"
  rm -f "$tmp/gitleaks.out"; rc=0; tree_n=0
  ( cd "$tmp/head" && gl dir --report-format template --report-template "$tmp/gitleaks.tpl" --report-path "$tmp/gitleaks.out" . ) > /dev/null 2>&1 || rc=$?
  case $rc in
    0) ;;
    99) echo x > "$tmp/gl.found"
        [ ! -f "$tmp/gitleaks.out" ] || grep . "$tmp/gitleaks.out" > "$tmp/gl.tree" || true
        [ ! -f "$tmp/gl.tree" ] || tree_n=$(wc -l < "$tmp/gl.tree" | tr -d ' ') ;;
    *) die "step gitleaks could not run (exit $rc)" ;;
  esac
  if [ -f "$tmp/gl.found" ]; then
    n=$(wc -l < "$gl_lines" | tr -d ' ')
    nm=$(wc -l < "$tmp/gl.msgs" | tr -d ' ')
    echo "push-gate: step gitleaks: FAILED ($n finding(s) in patches, $nm in commit messages, $tree_n in the tree of HEAD)"
    # In CI (a public log) only rule names and counts; anywhere else, the places.
    if [ -n "${CI:-}" ]; then
      { cat "$gl_lines"; [ ! -f "$tmp/gl.tree" ] || cat "$tmp/gl.tree"; } | cut -d' ' -f1 | sort | uniq -c | sed 's/^ *\([0-9]*\) \(.*\)$/  rule \2: \1/'
    else
      sed 's/^/  at /' "$gl_lines" | head -50
      sed 's/^/  commit message of /' "$tmp/gl.msgs"
      echo "  tree of HEAD: $tree_n finding(s)"
      [ ! -f "$tmp/gl.tree" ] || sed 's/^\([^ ]*\) \.\/\{0,1\}/  at \1 /' "$tmp/gl.tree" | head -50
    fi
    failed="gitleaks"
  else
    echo "push-gate: step gitleaks: ok ($count commit(s))"
  fi
else
  echo "push-gate: step gitleaks: skipped (no commits in range)"
fi

# Step 2: the repository's own scan over the same commits (scan-public prints places, never matched text).
if [ "$count" -gt 0 ]; then
  rc=0
  # shellcheck disable=SC2086
  # In CI (a public log) scan-public gives counts only (SCAN_QUIET); anywhere else it names places.
  if [ -n "${CI:-}" ]; then SCAN_QUIET=1; export SCAN_QUIET; fi
  clean GIT_DIR="$repo_gitdir" ${SCAN_WORDS_FILE:+"SCAN_WORDS_FILE=$SCAN_WORDS_FILE"} ${SCAN_OWNER:+"SCAN_OWNER=$SCAN_OWNER"} ${GITHUB_REPOSITORY_OWNER:+"GITHUB_REPOSITORY_OWNER=$GITHUB_REPOSITORY_OWNER"} ${SCAN_QUIET:+"SCAN_QUIET=$SCAN_QUIET"} sh "$here/scan-public.sh" --revs $revs > "$tmp/scan-public.out" 2>&1 || rc=$?
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
files=$(cgit ls-tree -r --name-only HEAD -- .github/workflows | grep -E '\.ya?ml$' || true)
if [ -z "$files" ]; then
  echo "push-gate: step workflows: ok (no workflow files)"
else
  nfiles=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
  if printf '%s\n' "$files" | grep -qvE '^[A-Za-z0-9._/-]+$'; then
    die "step workflows could not run (a workflow file name has an unsupported character)"
  fi
  mkdir "$tmp/tree"
  cp -R "$tmp/head/.github" "$tmp/tree/.github" || die "step workflows could not run (could not read the committed files)"
  rm -f "$tmp/tree/.github/actionlint.yaml" "$tmp/tree/.github/actionlint.yml"
  rc=0
  # shellcheck disable=SC2086
  ( cd "$tmp/tree" && clean actionlint -no-color -shellcheck= -pyflakes= \
      -format '{{range $e := .}}{{$e.Filepath}}:{{$e.Line}}: [{{$e.Kind}}]|{{end}}' $files ) > "$tmp/actionlint.raw" 2>/dev/null || rc=$?
  # (actionlint cannot be given a line feed or a \n escape in the template; entries are cut at '|' here.)
  tr '|' '\n' < "$tmp/actionlint.raw" | grep . > "$tmp/actionlint.out" || true
  case $rc in
    0) echo "push-gate: step workflows: ok ($nfiles file(s))" ;;
    1)
      echo "push-gate: step workflows: FAILED"
      if [ -n "${CI:-}" ]; then sed 's/^.*\[\(.*\)\]$/\1/' "$tmp/actionlint.out" | sort | uniq -c | sed 's/^ *\([0-9]*\) \(.*\)$/  rule \2: \1/'
      else sed 's/^/  at /' "$tmp/actionlint.out" | head -50; fi
      failed="${failed:+$failed, }workflows" ;;
    *) die "step workflows could not run (exit $rc)" ;;
  esac
fi

if [ -n "$failed" ]; then echo "push-gate: FAILED ($failed)"; exit 1; fi
echo "push-gate: passed (mode $mode, $count commit(s))"
