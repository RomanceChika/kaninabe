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
  rm -f "$2.raw" || return 1
}
# wc_num <-l|-c> <file>: sets $wc_v to the lines or bytes of <file>, from ONE `wc` (no pipe), status checked, leading blanks
# dropped, digits only. Returns 1 when wc fails or prints anything else: a count that cannot be read is never a number, so the
# caller stops (exit 2). Every number the scripts compare or add comes from here, from x_count, or from gl_scanned (checked).
wc_num() {
  wc_v=$(wc "$1" < "$2" 2>/dev/null) || return 1
  while :; do case $wc_v in ' '*) wc_v=${wc_v# } ;; *) break ;; esac; done
  case $wc_v in '' | *[!0-9]*) return 1 ;; esac
}
# wc_lines <file>: sets $wc_v to the number of lines of a LIST, counting an unterminated last line too (`wc -l` counts line breaks, and
# `read` drops an unterminated last line, so counting with wc would make a loop and its expected count agree on a skipped entry).
# A list loop compares the lines it processed with this count: a list whose last line has no line break is a difference (exit 2).
# One checked awk, digits only; returns 1 otherwise.
wc_lines() {
  wc_v=$(LC_ALL=C awk 'END { print NR }' "$1" 2>/dev/null) || return 1
  case $wc_v in '' | *[!0-9]*) return 1 ;; esac
}
now_secs() { now_t=$(date +%s 2>/dev/null) || return 1; case $now_t in '' | *[!0-9]*) return 1 ;; esac; }
# grep_q <grep arguments...>: grep for a condition: 0 = found, 1 = not found, and any other status (a bad pattern, an unreadable
# input, an I/O error) calls grep_failed, which the caller defines and which does not return: a search that failed is never
# "nothing found". (Output of grep is the caller's: the -q or -c is among the arguments.)
grep_q() { gq_rc=0; grep "$@" || gq_rc=$?; case $gq_rc in 0 | 1) return "$gq_rc" ;; *) grep_failed "$gq_rc" ;; esac; }   # GATE-EXCEPTION: the one helper that runs grep itself, and checks its status
# x_count <file>: prints the number of lines of a gitleaks report (an "x" per finding; blank lines are ignored). Fails (status 1)
# for an empty report, a line that is not "x", or an awk that does not run: a result that cannot be read is never a count.
x_count() { LC_ALL=C awk -v who=x_count '$0 == "" { next } $0 != "x" { bad = 1 } { n++ } END { if (bad || !n) exit 1; print n }' "$1"; }
# word_list_read <list> <pattern-out> <scoped-out>: the one reader of the word list. Lines that are not comments or blank and do
# not begin with '@' go to <pattern-out>, the '@' lines to <scoped-out>. Every status is checked (no pipe), and a list with a NUL
# byte, a CR in any line, a UTF-8 byte order mark at the start of a line or a line that is not valid UTF-8 is refused (a grep in a UTF-8 locale silently drops such a line, so it would leave the
# list). On failure returns 1 with a fixed reason in $wl_err; a line of the list is never shown.
word_list_read() {
  wl_err="could not be read"; wl_t=$2.chk
  [ -f "$1" ] && [ -r "$1" ] || return 1
  tr -d '\000' < "$1" > "$wl_t" 2>/dev/null || return 1
  wc_num -c "$1" || return 1; wl_a=$wc_v; wc_num -c "$wl_t" || return 1; wl_b=$wc_v
  if [ "$wl_a" != "$wl_b" ]; then wl_err="contains a NUL byte"; return 1; fi
  tr -d '\r' < "$1" > "$wl_t" 2>/dev/null || return 1
  wc_num -c "$wl_t" || return 1
  if [ "$wl_a" != "$wc_v" ]; then wl_err="contains a carriage return"; return 1; fi
  wl_bom=$(printf '\357\273\277') || return 1
  wl_rc=0; (LC_ALL=C && export LC_ALL && grep_q -qa "^$wl_bom" "$1") || wl_rc=$?
  case $wl_rc in 0) wl_err="begins a line with a byte order mark"; return 1 ;; 1) ;; *) return 1 ;; esac
  # in C.UTF-8 a line that is not valid UTF-8 is not matched by '^.*$': with -v -a it is the one that is selected. A self-test
  # first, so that a system without that locale (where every byte is a character) does not pass everything.
  printf 'caf\351\n' > "$wl_t" || return 1
  wl_rc=0; (LC_ALL=C.UTF-8 && export LC_ALL && grep_q -qav '^.*$' "$wl_t") || wl_rc=$?
  if [ "$wl_rc" != 0 ]; then wl_err="cannot be checked for UTF-8 here"; return 1; fi
  wl_rc=0; (LC_ALL=C.UTF-8 && export LC_ALL && grep_q -qav '^.*$' "$1") || wl_rc=$?
  case $wl_rc in 0) wl_err="is not valid UTF-8"; return 1 ;; 1) ;; *) return 1 ;; esac
  LC_ALL=C awk -v who=WORDLIST-READ '!/^#/ && !/^$/ && !/^@/' "$1" > "$2" 2>/dev/null || return 1
  LC_ALL=C awk -v who=WORDLIST-READ '/^@/' "$1" > "$3" 2>/dev/null || return 1
  rm -f "$wl_t" || return 1
}
# guard_exit <status>: for an EXIT trap. A command that failed under `set -e` can exit 1, which these scripts use for "found
# something"; unless the script said so (verdict_exit set just before its own exit 1), any status but 0 or 2 becomes 2.
guard_exit() { [ "$1" = 0 ] || [ "$1" = 2 ] || [ -n "${verdict_exit:-}" ] || exit 2; }
log_has_error() {
  { tr -d '\033' < "$1" > "$1.n1" && sed 's/\[[0-9;]*m//g' "$1.n1" > "$1.n2"; } 2>/dev/null || grep_failed 1
  grep_q -Eq '^[^ ]+ (ERR|FTL|PNC) ' "$1.n2"
}
# gl_scanned <log>: sets $gl_n to the number in gitleaks' "N commits scanned." line (colour codes removed). Each stage writes a file
# (<log>.g1 .. .g3) and its status is checked: returns 1 when any stage fails or no number comes out (the count is then unknown).
gl_scanned() {
  gl_n=
  tr -d '\033' < "$1" > "$1.g1" 2>/dev/null || return 1
  sed 's/\[[0-9;]*m//g' "$1.g1" > "$1.g2" 2>/dev/null || return 1
  sed -n 's/.*[^0-9]\([0-9][0-9]*\) commits scanned.*/\1/p' "$1.g2" > "$1.g3" 2>/dev/null || return 1
  gl_n=$(tail -n 1 "$1.g3" 2>/dev/null) || return 1
  case $gl_n in '' | *[!0-9]*) return 1 ;; esac
}
# scan_history <list> <template-file> <tmp>: (the template writes `x TAB commit TAB file` per finding; see report_read and keys_count)
# why one commit at a time: gitleaks cuts large input (`stdin`, `dir`) into chunks and
# loses a secret that straddles a boundary; `git` reads a patch whole. Each commit is also checked on its own, so that "the patch
# was readable and gitleaks read it" is confirmed per commit: (a) neutral_adds_text (status checked); (b) gitleaks git with
# --log-opts="-1 -m <id>" (ids only, never names; the info log goes to a private file and is never printed); (c) its "N commits
# scanned" must be a number: 1 when (a) found text, 0 or 1 otherwise. Findings (exit 99) must come with a readable report (an x per
# finding) and are summed in $hist_n. Any other status, an error line in the log, a patch that cannot be read, or a count that does
# not fit returns 2 with the reason in $hist_err.
scan_history() {
  hist_n=0; hist_err=
  # This function is called under `||`, where set -e is off: a list that cannot be opened would make the loop below not run and
  # the function return 0 ("no findings"). So the list is checked first, and the lines the loop processed are counted against
  # the lines of the list, an unterminated last line counted (wc_lines): a read that fails midway, or a last line without a line break, is a difference.
  [ -f "$1" ] && [ -r "$1" ] || { hist_err="could not run (the list of commits cannot be read)"; return 2; }
  wc_lines "$1" || { hist_err="could not run (could not count the list of commits)"; return 2; }
  sh_expect=$wc_v; sh_seen=0
  while IFS= read -r sh_c; do
    sh_seen=$((sh_seen + 1))
    [ -n "$sh_c" ] || continue
    sh_t=0; neutral_adds_text "$sh_c" || sh_t=$?
    [ "$sh_t" != 2 ] || { hist_err="could not run (could not read the patch of a commit)"; return 2; }
    rm -f "$3/hist.out" || { hist_err="could not run (could not clear a result file)"; return 2; }
    sh_rc=0; gl_level=info
    gl git --report-format template --report-template "$2" --report-path "$3/hist.out" --log-opts="-1 -m $sh_c" "$ng_dir" > /dev/null 2> "$3/hist.log" || sh_rc=$?
    gl_level=error
    case $sh_rc in 0 | 99) ;; *) hist_err="could not run (exit $sh_rc)"; return 2 ;; esac
    if log_has_error "$3/hist.log"; then hist_err="could not run (it logged an error)"; return 2; fi
    if [ "$sh_rc" = 99 ]; then
      # a finding is silenced only by a `keys` entry of the exclusion list (hist_keys: lines `path TAB blob id`) for that path and that blob
      report_read "$3/hist.out" "$3/hist.agg" || { hist_err="could not read the result"; return 2; }
      keys_count "$3/hist.agg" "${hist_keys:-/dev/null}" "$3/hist.kw" || { hist_err="could not read the result"; return 2; }
      hist_n=$((hist_n + kc_n))
    fi
    gl_scanned "$3/hist.log" || { hist_err="could not confirm what it scanned"; return 2; }
    sh_n=$gl_n
    if [ "$sh_t" = 0 ]; then [ "$sh_n" -eq 1 ] || { hist_err="could not confirm what it scanned"; return 2; }
    else [ "$sh_n" -le 1 ] || { hist_err="could not confirm what it scanned"; return 2; }; fi
  done < "$1"
  [ "$sh_seen" = "$sh_expect" ] || { hist_err="could not run (the list of commits was not read to the end)"; return 2; }
  return 0
}

# ---- the exclusion list (scripts/scan-exclusions.tsv) and the checks that read it ----
# excl_read <list> <out>: the one reader of the exclusion list. Every line is `kind TAB path TAB value TAB reason` (kind binary, keys or
# mail; the rest of the grammar is in tests/push-gate/scan-exclusions.test.mjs). On success <out> holds `kind TAB path TAB value` per line.
# An empty file is an empty list; a missing file, a NUL byte, a line that is not valid UTF-8, a malformed line and an exact duplicate
# (same kind, path and value) return 1 with a fixed reason in $ex_err (which names scan-exclusions.tsv and a line number, never a line).
excl_read() {
  ex_err="scan-exclusions.tsv could not be read"; ex_t=$2.chk
  [ -f "$1" ] && [ -r "$1" ] || { ex_err="scan-exclusions.tsv is missing or cannot be read"; return 1; }
  # a NUL byte (grep -P: a NUL can be matched, whatever the length of the line)
  ex_rc=0; (LC_ALL=C && export LC_ALL && grep_q -qaP '\x00' "$1") || ex_rc=$?
  case $ex_rc in 0) ex_err="scan-exclusions.tsv contains a NUL byte"; return 1 ;; 1) ;; *) return 1 ;; esac
  printf 'caf\351\n' > "$ex_t" || return 1
  ex_rc=0; (LC_ALL=C.UTF-8 && export LC_ALL && grep_q -qav '^.*$' "$ex_t") || ex_rc=$?
  [ "$ex_rc" = 0 ] || { ex_err="scan-exclusions.tsv cannot be checked for UTF-8 here"; return 1; }
  ex_rc=0; (LC_ALL=C.UTF-8 && export LC_ALL && grep_q -qav '^.*$' "$1") || ex_rc=$?
  case $ex_rc in 0) ex_err="scan-exclusions.tsv is not valid UTF-8"; return 1 ;; 1) ;; *) return 1 ;; esac
  : > "$2" || return 1
  ex_rc=0
  LC_ALL=C awk '
    function check(line,    f, nf, kind, p, v) {
      if (index(line, "\r")) return "a carriage return"
      nf = split(line, f, "\t")
      if (nf != 4) return nf " fields, not 4"
      kind = f[1]; p = f[2]; v = f[3]
      if (kind != "binary" && kind != "keys" && kind != "mail") return "an unknown kind"
      if (p == "") return "an empty path"
      if (p ~ /[*?]/ || index(p, "[") || index(p, "]")) return "a glob character in the path"
      if (substr(p, 1, 1) == "/") return "a leading slash"
      if (substr(p, length(p), 1) == "/") return "a trailing slash"
      if (p == "." || p == ".." || p ~ /^\.\.?\// || p ~ /\/\.\.?\// || p ~ /\/\.\.?$/ || index(p, "//")) return "an empty, . or .. segment in the path"
      if (p ~ /[\001-\037\177]/) return "a control character in the path"
      if (kind == "mail") {
        if (length(v) != 71 || substr(v, 1, 7) != "sha256:" || substr(v, 8) !~ /^[0-9a-f]+$/) return "a mail value that is not sha256: and 64 hex digits"
      } else if (length(v) != 40 || v !~ /^[0-9a-f]+$/) return "a " kind " value that is not a blob id"
      if (f[4] ~ /^[ \t]*$/) return "an empty reason"
      return ""
    }
    { if (msg != "") next
      m = check($0)
      if (m == "") { split($0, g, "\t"); k = g[1] "\t" g[2] "\t" g[3]; if (k in seen) m = "an exact duplicate"; seen[k] = 1 }
      if (m != "") { msg = "scan-exclusions.tsv line " NR ": " m; next }
      split($0, g, "\t"); print g[1] "\t" g[2] "\t" g[3] }
    END { if (msg != "") { print msg > "/dev/stderr"; exit 1 } }
  ' "$1" > "$2" 2> "$2.err" || ex_rc=$?
  if [ "$ex_rc" = 1 ]; then ex_err=$(cat "$2.err") || ex_err="scan-exclusions.tsv has a line that does not fit"; return 1; fi
  [ "$ex_rc" = 0 ] || return 1
  rm -f "$ex_t" "$2.err" || return 1
}
# excl_kind <list-read> <kind> <out>: the `path TAB value` lines of one kind from what excl_read wrote.
excl_kind() { LC_ALL=C awk -F'\t' -v k="$2" '$1 == k { print $2 "\t" $3 }' "$1" > "$3"; }

# report_read <report> <out>: reads a gitleaks report (a line per finding: "x", or "x TAB <40 hex> TAB <file>") and writes <out>: one
# line `count TAB commit TAB file` per distinct place, and `count TAB bare TAB -` for the lines that are only "x". Returns 1 for an
# empty report, any other line, or an awk that does not run: a result that cannot be read is never a count.
report_read() {
  LC_ALL=C awk '
    $0 == "" { next }
    $0 == "x" { bare++; n++; next }
    { nf = split($0, f, "\t")
      if (nf != 3 || f[1] != "x" || length(f[2]) != 40 || f[2] !~ /^[0-9a-f]+$/ || f[3] == "") { bad = 1; next }
      n++; c[f[2] "\t" f[3]]++ }
    END { if (bad || !n) exit 1
      if (bare) print bare "\tbare\t-"
      for (k in c) print c[k] "\t" k }
  ' "$1" > "$2"
}
# keys_count <report-read-output> <keys> <work>: sets $kc_n to the number of findings that no `keys` entry silences. <keys> holds
# `path TAB blob id` lines. A finding is silenced only when an entry has exactly its path and the blob at that path in that commit
# (neutral_git rev-parse <commit>:<path>) has exactly the entry's blob id; a rev-parse that fails is "not silenced". A bare "x" is not
# silenced either. Returns 1 when the input cannot be read to the end.
keys_count() {
  kc_n=0; kc_seen=0; kc_tab=$(printf '\t') || return 1
  wc_lines "$1" || return 1; kc_expect=$wc_v
  while IFS=$kc_tab read -r kc_c kc_commit kc_path; do
    kc_seen=$((kc_seen + 1))
    case $kc_c in '' | *[!0-9]*) return 1 ;; esac
    if [ "$kc_commit" = bare ]; then kc_n=$((kc_n + kc_c)); continue; fi
    P=$kc_path LC_ALL=C awk -F'\t' '$1 == ENVIRON["P"] { print $2 }' "$2" > "$3" || return 1
    kc_hit=0
    if [ -s "$3" ]; then
      kc_blob=$(neutral_git rev-parse --verify -q "$kc_commit:$kc_path" 2>/dev/null) || kc_blob=
      if [ -n "$kc_blob" ] && grep_q -qFx "$kc_blob" "$3"; then kc_hit=1; fi
    fi
    [ "$kc_hit" = 1 ] || kc_n=$((kc_n + kc_c))
  done < "$1"
  [ "$kc_seen" = "$kc_expect" ] || return 1
}

# ---- files that cannot be read as text (known-gaps 16(e)) ----
# A file is unreadable when it holds a NUL byte anywhere (git itself looks only at the first 8000 bytes) or is not valid UTF-8; the word
# scans, the mail scan and gitleaks read text, so such a file is not scanned, and it is red unless a `binary` entry names its blob id at its
# path. Not red: valid UTF-8 text, an empty file, a symlink, a submodule gitlink. The candidates of a commit are what it adds or changes
# (`diff-tree -c`: for a merge only the paths that differ from every parent); the candidates of the tree are all its files.
# Every file name is checked too: a name with a control character (a line feed, a tab ...) or a byte that is not UTF-8 cannot be written in
# the list, so it stops the scan (status 3 of the two candidate readers below and of unr_names_utf8).
# (a control character is found in the awk programs below; a byte that is not UTF-8 is found afterwards by unr_names_utf8 on the names they write)
# unr_commit_cands <commit> <cands>: appends `commit TAB blob TAB path` per file the commit adds or changes. Returns 2 when the commit cannot
# be read, 3 for a file name that cannot be named.
unr_commit_cands() {
  neutral_git diff-tree -c --root -r --no-renames -z --no-commit-id --no-ext-diff "$1" > "$2.raw" 2>/dev/null || return 2
  uc_rc=0
  LC_ALL=C awk -v RS='\0' -v c="$1" -v nf="$2.names" '
    NR % 2 == 1 { meta = $0; next }
    { if ($0 ~ /[\001-\037\177]/) { bad = 1; exit 3 }
      print $0 >> nf
      nc = 0; s = meta
      while (substr(s, 1, 1) == ":") { nc++; s = substr(s, 2) }
      if (split(s, a, " ") != 2 * nc + 3) { bad = 2; exit 4 }
      mode = a[nc + 1]
      if (mode == "000000" || mode == "120000" || mode == "160000") next
      print c "\t" a[2 * nc + 2] "\t" $0 }
    END { if (!bad && NR % 2 != 0) exit 4 }
  ' "$2.raw" >> "$2" || uc_rc=$?
  case $uc_rc in 0) return 0 ;; 3) return 3 ;; *) return 2 ;; esac
}
# unr_tree_cands <tree> <cands>: appends `tree TAB blob TAB path` for every regular file of the tree. Returns 2 / 3 as above.
unr_tree_cands() {
  neutral_git ls-tree -r -z "$1" > "$2.raw" 2>/dev/null || return 2
  uc_rc=0
  LC_ALL=C awk -v RS='\0' -v nf="$2.names" '
    { i = index($0, "\t")
      if (!i) { bad = 2; exit 4 }
      p = substr($0, i + 1)
      if (p ~ /[\001-\037\177]/) { bad = 1; exit 3 }
      print p >> nf
      if (split(substr($0, 1, i - 1), a, " ") != 3) { bad = 2; exit 4 }
      if (a[2] != "blob" || a[1] == "120000") next
      print "tree\t" a[3] "\t" p }
  ' "$2.raw" >> "$2" || uc_rc=$?
  case $uc_rc in 0) return 0 ;; 3) return 3 ;; *) return 2 ;; esac
}
# unr_names_utf8 <names>: the names that the two readers above wrote (one per line, no control character in any): returns 0 when every
# one is valid UTF-8, 3 when one is not, 1 when the check cannot run (a self-test line that is not UTF-8 must be found first, or the locale
# does not do what the check needs).
unr_names_utf8() {
  printf 'caf\351\n' > "$1.canary" || return 1
  nu_rc=0; (LC_ALL=C.UTF-8 && export LC_ALL && grep_q -qav '^.*$' "$1.canary") || nu_rc=$?
  [ "$nu_rc" = 0 ] || return 1
  nu_rc=0; (LC_ALL=C.UTF-8 && export LC_ALL && grep_q -qav '^.*$' "$1") || nu_rc=$?
  case $nu_rc in 0) return 3 ;; 1) return 0 ;; *) return 1 ;; esac
}
# unr_bad_blobs <cands...-file> <out>: the blob ids of the candidates that are not readable as text, one per line, into <out>. All the
# distinct blobs are put into ONE throwaway tree (names b1, b2 ...) that `git grep` reads twice (NUL byte; a line that is not valid UTF-8),
# which is how thousands of files are read in seconds. A canary of each kind is in the tree and must come out as it should, or the check
# itself does not work here (no PCRE in git, no UTF-8 locale) and returns 1: a check that cannot run is never "nothing unreadable".
unr_bad_blobs() {
  ub=$ng_dir/ub
  LC_ALL=C awk -F'\t' '{ print $2 }' "$1" > "$ub.ids" || return 1
  LC_ALL=C sort -u "$ub.ids" > "$ub.blobs" || return 1
  LC_ALL=C awk '{ print "100644 " $0 "\tb" NR }' "$ub.blobs" > "$ub.info" || return 1
  for ub_k in 1 2 3; do
    case $ub_k in
      1) printf 'plain\000text\n' > "$ub.canary" || return 1 ;;
      2) printf 'caf\351 plain words\n' > "$ub.canary" || return 1 ;;
      3) printf 'caf\303\251 \346\227\245\346\234\254\350\252\236\n' > "$ub.canary" || return 1 ;;
    esac
    ub_id=$(ng_env GIT_DIR="$ng_dir" git hash-object -w "$ub.canary" 2>/dev/null) || return 1
    printf '100644 %s\tc%s\n' "$ub_id" "$ub_k" >> "$ub.info" || return 1
  done
  rm -f "$ng_dir/ub-index" || return 1
  ng_env GIT_DIR="$ng_dir" GIT_INDEX_FILE="$ng_dir/ub-index" git update-index --add --index-info < "$ub.info" > /dev/null 2>&1 || return 1
  ub_tree=$(ng_env GIT_DIR="$ng_dir" GIT_INDEX_FILE="$ng_dir/ub-index" git write-tree 2>/dev/null) || return 1
  : > "$ub.hits" || return 1
  ub_rc=0; ng_env LC_ALL=C GIT_DIR="$ng_dir" git grep -a -l -P '\x00' "$ub_tree" > "$ub.nul" 2>/dev/null || ub_rc=$?
  case $ub_rc in 0 | 1) ;; *) return 1 ;; esac
  ub_rc=0; ng_env GIT_DIR="$ng_dir" git grep -a -l -v -e '^.*$' "$ub_tree" > "$ub.utf" 2>/dev/null || ub_rc=$?
  case $ub_rc in 0 | 1) ;; *) return 1 ;; esac
  LC_ALL=C awk '{ print substr($0, index($0, ":") + 1) }' "$ub.nul" > "$ub.nul.n" || return 1
  LC_ALL=C awk '{ print substr($0, index($0, ":") + 1) }' "$ub.utf" > "$ub.utf.n" || return 1
  grep_q -qxF c1 "$ub.nul.n" || return 1
  grep_q -qxF c2 "$ub.utf.n" || return 1
  if grep_q -qxF c3 "$ub.nul.n" || grep_q -qxF c3 "$ub.utf.n"; then return 1; fi
  cat "$ub.nul.n" "$ub.utf.n" > "$ub.names" || return 1
  LC_ALL=C awk 'FILENAME == ARGV[1] { b[NR] = $0; next } { n = substr($0, 2); if ($0 ~ /^b[0-9]+$/) print b[n] }' "$ub.blobs" "$ub.names" > "$2" || return 1
}
# unr_count <bad-blobs> <binary-entries> <cands>: sets $ur_n to the number of candidates whose blob is in <bad-blobs> and that no `binary`
# entry (`path TAB blob id`) names with that path and that blob.
unr_count() {
  ur_n=$(LC_ALL=C awk -F'\t' '
    FILENAME == ARGV[1] { bad[$1] = 1; next }
    FILENAME == ARGV[2] { ok[$1 "\t" $2] = 1; next }
    { if (($2 in bad) && !(($3 "\t" $2) in ok)) n++ }
    END { print n + 0 }' "$1" "$2" "$3") || return 1
  case $ur_n in '' | *[!0-9]*) return 1 ;; esac
}
# neutral_commit_tree <tree>: a commit of <tree> with no parent, a fixed identity and a fixed date, in the neutral repository only, so that
# gitleaks can read the tree the way it reads a commit. Sets $nct_id to its id; returns 1 on failure.
neutral_commit_tree() {
  nct_id=$(ng_env GIT_DIR="$ng_dir" GIT_AUTHOR_NAME=gate GIT_AUTHOR_EMAIL=gate@users.noreply.github.com GIT_AUTHOR_DATE='2001-01-01T00:00:00Z' \
    GIT_COMMITTER_NAME=gate GIT_COMMITTER_EMAIL=gate@users.noreply.github.com GIT_COMMITTER_DATE='2001-01-01T00:00:00Z' git commit-tree "$1" -m tree 2>/dev/null) || return 1
  [ "$(neutral_git cat-file -t "$nct_id" 2>/dev/null)" = commit ] || return 1
}
