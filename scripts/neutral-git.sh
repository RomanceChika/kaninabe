# Sourced by push-gate.sh and scan-public.sh (not run). The scans must see what is committed, whatever the tree or the
# clone says about it: a .gitattributes line (`binary`, `-diff`, `export-ignore`) in the tree, $GIT_DIR/info/attributes,
# core.attributesFile and the grep.* / core.* settings of the user must not change what `git grep` or an export sees.
# So these commands run in a throwaway bare repository of their own (no config, no info/attributes) that borrows the
# objects of the real one, with the attributes read from the empty tree (`--attr-source`, git 2.40 or newer), and
# without the user's and the system's git configuration. A git too old for --attr-source is not worked around: the
# scans stop, because scanning less is worse than not scanning.
#
# THE RULE FOR EVERY SCRIPT THAT SOURCES THIS FILE: a step that fails must never read as "nothing found" or as a smaller list.
# `set -e` does not cover a non-final stage of a pipe, `|| true`, `2>/dev/null`, a `$(...)` in a `for`, or a command in a
# condition. So: stage results go through files in the private temp dir with every status checked (no pipe feeds a verdict); a
# grep in a condition is grep_q (found / not found / failed); `|| true` is only for a result that is shown and never decides.
#
# (the real repository is $ng_repo, set by the caller)
# neutral_git_setup <dir>   prepares <dir>/neutral.git; on failure prints the reason in $ng_error and returns 1
# neutral_git <args...>     runs git (read-only use: grep, ls-tree) against the commits of the real repository
# neutral_adds_text <sha>   succeeds when the commit adds at least one line of text (a changed-line count above 0 in
#                           `git diff-tree --numstat`, merges against each parent, renames followed as git log does); returns 1
#                           when it adds none (a binary file, a deletion, a mode change, an empty file, a pure rename) and 2
#                           when the patch could not be read
# neutral_commit_text <sha> <out>  writes the text of a commit into <out>: the raw object (`git cat-file commit`: tree, parents, author,
#                           committer, every other header such as mergetag and gpgsig, and the whole message) with NUL turned into a
#                           line break (a message is cut at a NUL by the formats of git log). Not re-encoded: the bytes are the object's.
#                           Returns 1 if either step fails
# now_secs                 sets $now_t to the clock in whole seconds; returns 1 when `date +%s` fails or prints anything but digits
#                           (what it printed is never shown)
# log_has_error <log>       succeeds when a gitleaks log holds an error line (ERR, FTL or PNC; colour codes ignored)
# scan_history <list> <report-args...>  `gitleaks git` over the neutral repository, ONE COMMIT AT A TIME, for the commit ids in
#                           <list>; the caller defines gl <subcommand> <args...> (gitleaks with the fixed flags). Sets $hist_n to the
#                           number of findings, and on failure returns 2 with the reason in $hist_err. See the function.
# neutral_export <sha> <dir> writes the files of the commit into <dir> exactly as committed (no export-ignore, no
#                           export-subst, no end-of-line or filter conversion)
ng_error=
# ng_env <command...>: the command with an environment of explicit inputs only (no GIT_*, GREP_*, GITLEAKS_* or anything else
# the caller had, no user or system git configuration, no attributes from outside the repository).
ng_env() {
  env -i PATH="$PATH" HOME=/nonexistent XDG_CONFIG_HOME=/nonexistent LC_ALL=C.UTF-8 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1 "$@"
}
# ng_real <command...>: the same, inside the real repository named by $ng_repo (its git directory, found by the caller
# once, in the caller's environment: see repo-context.sh). Without it the repository is looked for from the current directory.
ng_repo=${ng_repo:-}
ng_real() {
  if [ -n "${ng_repo:-}" ]; then ng_env GIT_DIR="$ng_repo" "$@"; else ng_env "$@"; fi
}
neutral_git_setup() {
  ng_empty=$(ng_env git hash-object -t tree /dev/null 2>/dev/null) || { ng_error="could not compute the empty tree"; return 1; }
  if ! ng_real git --attr-source="$ng_empty" rev-parse --git-dir >/dev/null 2>&1; then
    ng_error="this git does not support --attr-source (git 2.40 or newer is needed): not scanning with a weaker scan"
    return 1
  fi
  # What cannot be read to the end is not scanned in part: a shallow clone, and a repository whose object names are not SHA-1
  # (the neutral repository is SHA-1). One check, used by every script that reads history.
  [ "$(ng_real git rev-parse --is-shallow-repository 2>/dev/null)" = false ] || { ng_error="this is a shallow clone, so the history cannot be read to the end"; return 1; }
  [ "$(ng_real git rev-parse --show-object-format 2>/dev/null)" = sha1 ] || { ng_error="this repository does not use SHA-1 object names: not supported, so the history cannot be read"; return 1; }
  ng_objects=$(ng_real git rev-parse --path-format=absolute --git-path objects 2>/dev/null) || { ng_error="could not find the objects of the repository"; return 1; }
  ng_dir=$1/neutral.git
  ng_env git init -q --bare "$ng_dir" >/dev/null 2>&1 || { ng_error="could not prepare a neutral git directory"; return 1; }
  printf '%s\n' "$ng_objects" > "$ng_dir/objects/info/alternates" || { ng_error="could not prepare a neutral git directory"; return 1; }
  # A commit-graph (and a multi-pack-index) of the borrowed object directory is not content-addressed: git would read parent
  # links from it. Both are switched off in the neutral repository's own config (which gitleaks' git runs read as well).
  ng_env GIT_DIR="$ng_dir" git config core.commitGraph false && ng_env GIT_DIR="$ng_dir" git config core.multiPackIndex false \
    || { ng_error="could not prepare a neutral git directory"; return 1; }
}
neutral_git() {
  ng_env GIT_DIR="$ng_dir" git --attr-source="$ng_empty" "$@"
}
neutral_export() {
  mkdir -p "$2" || return 1
  ng_env GIT_DIR="$ng_dir" GIT_WORK_TREE="$2" GIT_INDEX_FILE="$ng_dir/export-index" git read-tree "$1" >/dev/null 2>&1 \
    && ng_env GIT_DIR="$ng_dir" GIT_WORK_TREE="$2" GIT_INDEX_FILE="$ng_dir/export-index" git --attr-source="$ng_empty" checkout-index -a -f >/dev/null 2>&1
}
neutral_adds_text() {
  nat_raw=$ng_dir/numstat.raw
  neutral_git diff-tree --root -m -M --numstat -z --no-ext-diff --no-textconv --no-color "$1" > "$nat_raw" 2>/dev/null || return 2
  tr '\000' '\n' < "$nat_raw" > "$nat_raw.t" 2>/dev/null || return 2
  nat_rc=0; awk -F'\t' '$1 ~ /^[0-9]+$/ && $1 > 0 { f = 1 } END { exit f ? 0 : 1 }' "$nat_raw.t" || nat_rc=$?
  case $nat_rc in 0 | 1) return "$nat_rc" ;; *) return 2 ;; esac
}
neutral_commit_text() {
  neutral_git cat-file commit "$1" > "$2.raw" 2>/dev/null || return 1
  LC_ALL=C tr '\000' '\n' < "$2.raw" > "$2" || return 1
  rm -f "$2.raw"
}
now_secs() { now_t=$(date +%s 2>/dev/null) || return 1; case $now_t in '' | *[!0-9]*) return 1 ;; esac; }
# grep_q <grep arguments...>: grep for a condition: 0 = found, 1 = not found, and any other status (a bad pattern, an unreadable
# input, an I/O error) calls grep_failed, which the caller defines and which does not return: a search that failed is never
# "nothing found". (Output of grep is the caller's: the -q or -c is among the arguments.)
grep_q() { gq_rc=0; grep "$@" || gq_rc=$?; case $gq_rc in 0 | 1) return "$gq_rc" ;; *) grep_failed "$gq_rc" ;; esac; }
# x_count <file>: prints the number of lines of a gitleaks report (an "x" per finding; blank lines are ignored). Fails (status 1)
# for an empty report, a line that is not "x", or an awk that does not run: a result that cannot be read is never a count.
x_count() { LC_ALL=C awk -v who=x_count '$0 == "" { next } $0 != "x" { bad = 1 } { n++ } END { if (bad || !n) exit 1; print n }' "$1"; }
# word_list_read <list> <pattern-out> <scoped-out>: the one reader of the word list. Lines that are not comments or blank and do
# not begin with '@' go to <pattern-out>, the '@' lines to <scoped-out>. Every status is checked (no pipe), and a list with a NUL
# byte or a line that is not valid UTF-8 is refused (a grep in a UTF-8 locale silently drops such a line, so it would leave the
# list). On failure returns 1 with a fixed reason in $wl_err; a line of the list is never shown.
word_list_read() {
  wl_err="could not be read"; wl_t=$2.chk
  [ -f "$1" ] && [ -r "$1" ] || return 1
  tr -d '\000' < "$1" > "$wl_t" 2>/dev/null || return 1
  wl_a=$(wc -c < "$1") && wl_b=$(wc -c < "$wl_t") || return 1
  if [ "$wl_a" != "$wl_b" ]; then wl_err="contains a NUL byte"; return 1; fi
  # in C.UTF-8 a line that is not valid UTF-8 is not matched by '^.*$': with -v -a it is the one that is selected. A self-test
  # first, so that a system without that locale (where every byte is a character) does not pass everything.
  printf 'caf\351\n' > "$wl_t" || return 1
  wl_rc=0; (LC_ALL=C.UTF-8; export LC_ALL; grep -qav '^.*$' "$wl_t") || wl_rc=$?
  if [ "$wl_rc" != 0 ]; then wl_err="cannot be checked for UTF-8 here"; return 1; fi
  wl_rc=0; (LC_ALL=C.UTF-8; export LC_ALL; grep -qav '^.*$' "$1") || wl_rc=$?
  case $wl_rc in 0) wl_err="is not valid UTF-8"; return 1 ;; 1) ;; *) return 1 ;; esac
  LC_ALL=C awk -v who=WORDLIST-READ '!/^#/ && !/^$/ && !/^@/' "$1" > "$2" 2>/dev/null || return 1
  LC_ALL=C awk -v who=WORDLIST-READ '/^@/' "$1" > "$3" 2>/dev/null || return 1
  rm -f "$wl_t"
}
# guard_exit <status>: for an EXIT trap. A command that failed under `set -e` can exit 1, which these scripts use for "found
# something"; unless the script said so (verdict_exit set just before its own exit 1), any status but 0 or 2 becomes 2.
guard_exit() { [ "$1" = 0 ] || [ "$1" = 2 ] || [ -n "${verdict_exit:-}" ] || exit 2; }
log_has_error() {
  { tr -d '\033' < "$1" > "$1.n1" && sed 's/\[[0-9;]*m//g' "$1.n1" > "$1.n2"; } 2>/dev/null || grep_failed 1
  grep_q -Eq '^[^ ]+ (ERR|FTL|PNC) ' "$1.n2"
}
# gl_scanned <log>: the number in gitleaks' "N commits scanned." line (colour codes removed), or nothing. The log is private.
gl_scanned() { tr -d '\033' < "$1" | sed 's/\[[0-9;]*m//g' | sed -n 's/.*[^0-9]\([0-9][0-9]*\) commits scanned.*/\1/p' | tail -1; }
# scan_history <list> <template-file> <tmp>: why one commit at a time: gitleaks cuts large input (`stdin`, `dir`) into chunks and
# loses a secret that straddles a boundary; `git` reads a patch whole. Each commit is also checked on its own, so that "the patch
# was readable and gitleaks read it" is confirmed per commit: (a) neutral_adds_text (status checked); (b) gitleaks git with
# --log-opts="-1 -m <id>" (ids only, never names; the info log goes to a private file and is never printed); (c) its "N commits
# scanned" must be a number: 1 when (a) found text, 0 or 1 otherwise. Findings (exit 99) must come with a readable report (an x per
# finding) and are summed in $hist_n. Any other status, an error line in the log, a patch that cannot be read, or a count that does
# not fit returns 2 with the reason in $hist_err.
scan_history() {
  hist_n=0; hist_err=
  while IFS= read -r sh_c; do
    [ -n "$sh_c" ] || continue
    sh_t=0; neutral_adds_text "$sh_c" || sh_t=$?
    [ "$sh_t" != 2 ] || { hist_err="could not run (could not read the patch of a commit)"; return 2; }
    rm -f "$3/hist.out"; sh_rc=0; gl_level=info
    gl git --report-format template --report-template "$2" --report-path "$3/hist.out" --log-opts="-1 -m $sh_c" "$ng_dir" > /dev/null 2> "$3/hist.log" || sh_rc=$?
    gl_level=error
    case $sh_rc in 0 | 99) ;; *) hist_err="could not run (exit $sh_rc)"; return 2 ;; esac
    if log_has_error "$3/hist.log"; then hist_err="could not run (it logged an error)"; return 2; fi
    if [ "$sh_rc" = 99 ]; then
      sh_x=$(x_count "$3/hist.out") || { hist_err="could not read the result"; return 2; }
      hist_n=$((hist_n + sh_x))
    fi
    sh_n=$(gl_scanned "$3/hist.log")
    case $sh_n in '' | *[!0-9]*) hist_err="could not confirm what it scanned"; return 2 ;; esac
    if [ "$sh_t" = 0 ]; then [ "$sh_n" -eq 1 ] || { hist_err="could not confirm what it scanned"; return 2; }
    else [ "$sh_n" -le 1 ] || { hist_err="could not confirm what it scanned"; return 2; }; fi
  done < "$1"
  return 0
}
