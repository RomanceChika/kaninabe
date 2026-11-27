#!/bin/sh
# Sorts paths into the three classes of the basis rule (development-flow, "どの path が基準か") by a list of lines:
#
#   class<TAB>pattern<TAB>reason        class: basis | generated | implementation
#
# Lines are tried in order and the first match decides; a path that no line matches is basis. A pattern is a literal path or has `*`
# in it: the matching is the `case` of sh, so `*` stands for any characters, `/` included, anywhere in the pattern (`dir/*` is
# everything under dir, at any depth; `dirx/a` and `x/dir/a` do not match it). A pattern may not hold `?`, `[`, `]` or a backslash,
# start or end with `/`, have an empty, `.` or `..` segment, or hold a control character. `reason` is not empty. The list has no
# blank line, no comment line, no carriage return, no NUL byte and no duplicate pattern, and ends with a line feed; an empty file
# is valid (everything is basis). Anything else is exit 2 with `list: line N: <rule>`, and the line itself is never printed.
#
# The paths come from a NUL-separated file or from the diff between two commits:
#   classify-paths.sh --list <file> (--paths <file> | --range <a> <b>) [--out <file>] [--quiet] [--require basis-only|no-basis|any]
#   --paths   the file holds NUL-terminated records (a name that holds a line feed or another control character, an empty record
#             and a last record without its NUL are exit 2)
#   --range   `git diff --no-renames --name-only -z <a> <b>` in the repository of the current directory: a rename is the delete of the
#             old path and the add of the new one, and both are classified; a delete, a mode change, a type change and a submodule
#             gitlink are one path each. Nothing is classified by its content. Each of <a> and <b> must resolve to ONE COMMIT
#             (`rev-parse --verify <x>^{commit}`, resolved once, to a full sha; a branch, a tag that peels to a commit, an abbreviated
#             sha and HEAD~1 do; a tree, a blob, a range and `B:path` are exit 2), and the two shas are what is diffed.
#             git runs under `env -i` with only PATH, a HOME and XDG_CONFIG_HOME that do not exist, GIT_CONFIG_NOSYSTEM,
#             GIT_CONFIG_GLOBAL=/dev/null, GIT_ATTR_NOSYSTEM and GIT_NO_REPLACE_OBJECTS=1, and with `--no-replace-objects`. That
#             NEUTRALISES everything the caller's environment or configuration could change: every GIT_* variable (GIT_DIR, GIT_WORK_TREE,
#             GIT_INDEX_FILE, GIT_CONFIG_COUNT/KEY/VALUE, the object and alternate directories, GIT_NO_REPLACE_OBJECTS, GIT_EXTERNAL_DIFF),
#             the user's and the system's git configuration, and replace refs; and the diff options fix rename detection, relative paths,
#             hidden submodules and the external diff. It does NOT neutralise what belongs to the repository itself: its own
#             configuration, its object directory and the alternates it records, and git refusing a repository owned by another user
#             (safe.directory is not read, so that is exit 2). The repository is found from the current directory, never from GIT_DIR.
#   --out     one `<class><TAB><path>` per path, in the order given. All or nothing: a file already at --out is removed first, the result is
#             written to a temporary file in the same directory and moved into place as the very last step (after the cleanup), so a
#             file at --out exists only after exit 0 or 1, and an exit 2 leaves no stale, partial or temporary file. --out may not be the
#             list or the paths file. Without --out and without --quiet the rows go to standard output instead.
#   --quiet   no row on standard output (counts only)
#   --require basis-only: no implementation path; no-basis: no basis path; any (the default). Generated paths satisfy both.
# Standard output ends with `classify-paths: N path(s): B basis, G generated, I implementation`, then, when --require is violated,
# `classify-paths: FAILED (<rule>: <count> ... path(s))`. A path, a list line and a git message are never printed.
# Exit codes: 0 the rule holds; 1 it is violated; 2 something could not be done (the arguments, the list, the paths, a tool, the temporary
# directory): never 1, never a verdict and never a row, and a fixed message `classify-paths: could not run (<reason>)`.
#
# The rule of the scripts that decide: no pipeline and no `|| true` (no awk, sed, sort or grep is needed, so no awk is supported or
# unsupported: there is none), every status is checked, every stage writes a private temporary file, and what is read from a stage is
# proven complete first (a count taken by another command, or the frame of the data), so a cut-short output of any tool is exit 2.
# NUL-separated input is turned into lines by `tr` (POSIX: `\000`), and a line feed inside a name is found by comparing the number of
# NUL bytes with the number of lines. The tools used: env and git (--range only), mktemp, rm, tr, wc, cmp, and cat and mv (--out only).
set -eu
LC_ALL=C
export LC_ALL
tmp=
outtmp=
out_done=
out=
verdict_exit=
# one EXIT trap: the cleanup, and the guard that turns a status that nobody chose (a command that failed under `set -e`) into 2.
# (a verdict is printed only after the temporary directory is gone, so this cleanup runs only on a path that is already exit 2, or on
# one that this trap makes exit 2; a cleanup that fails here is exit 2 as well)
trap 'rc=$?; if [ -n "$tmp" ]; then rm -rf "$tmp" || rc=2; fi; if [ -n "$outtmp" ]; then rm -f "$outtmp" || rc=2; fi; if [ "$rc" != 0 ] && [ -z "$verdict_exit" ] && [ -n "$out_done" ]; then rm -f "$out" || rc=2; fi; if [ "$rc" != 0 ] && [ -z "$verdict_exit" ]; then exit 2; fi' EXIT
could_not() { echo "classify-paths: could not run ($1)"; exit 2; }
tab=$(printf '\t')
cr=$(printf '\r')
nl='
'

list= paths= ra= rb= req=any quiet=0
list_set=0 paths_set=0 range_set=0 out_set=0 req_set=0
while [ $# -gt 0 ]; do
  case $1 in
    --list)
      [ $# -ge 2 ] || could_not "usage: --list needs a file"
      [ "$list_set" = 0 ] || could_not "usage: --list given twice"
      list_set=1; list=$2; shift 2 ;;
    --paths)
      [ $# -ge 2 ] || could_not "usage: --paths needs a file"
      [ "$paths_set" = 0 ] || could_not "usage: --paths given twice"
      paths_set=1; paths=$2; shift 2 ;;
    --range)
      [ $# -ge 3 ] || could_not "usage: --range needs two commits"
      [ "$range_set" = 0 ] || could_not "usage: --range given twice"
      range_set=1; ra=$2; rb=$3; shift 3 ;;
    --out)
      [ $# -ge 2 ] || could_not "usage: --out needs a file"
      [ "$out_set" = 0 ] || could_not "usage: --out given twice"
      out_set=1; out=$2; shift 2 ;;
    --require)
      [ $# -ge 2 ] || could_not "usage: --require needs a rule"
      [ "$req_set" = 0 ] || could_not "usage: --require given twice"
      req_set=1; req=$2; shift 2
      case $req in
        basis-only | no-basis | any) ;;
        *) could_not "usage: --require is basis-only, no-basis or any" ;;
      esac ;;
    --quiet)
      [ "$quiet" = 0 ] || could_not "usage: --quiet given twice"
      quiet=1; shift ;;
    *) could_not "usage: classify-paths.sh --list <file> (--paths <file> | --range <a> <b>) [--out <file>] [--quiet] [--require basis-only|no-basis|any]" ;;
  esac
done
[ "$list_set" = 1 ] || could_not "usage: --list is required"
case $list in -*) could_not "usage: a file name starts with -" ;; esac
case $paths in -*) could_not "usage: a file name starts with -" ;; esac
case $out in -*) could_not "usage: a file name starts with -" ;; esac
[ "$((paths_set + range_set))" = 1 ] || could_not "usage: exactly one of --paths and --range"
if [ "$out_set" = 1 ]; then
  [ -n "$out" ] || could_not "usage: --out needs a file"
  [ "$out" != "$list" ] && [ "$out" != "$paths" ] || could_not "usage: --out is the list or the paths file"
  # a result that an earlier run left is removed first, so that no exit 2 leaves a stale one (a directory or an unremovable file is exit 2)
  rm -f "$out" || could_not "the old output file could not be removed"
fi
if [ "$range_set" = 1 ]; then
  case $ra in '' | -*) could_not "usage: a commit is empty or starts with -" ;; esac
  case $rb in '' | -*) could_not "usage: a commit is empty or starts with -" ;; esac
fi

tmp=$(mktemp -d) || could_not "no temporary directory"
[ -n "$tmp" ] && [ -d "$tmp" ] || could_not "no temporary directory"

# lines_of <file>: sets $nl_n to the number of line feeds in <file> (counted by wc, read back from a file; anything but digits is a failure)
lines_of() {
  wc -l < "$1" > "$tmp/wc.out" || return 1
  read -r nl_n < "$tmp/wc.out" || return 1
  case $nl_n in '' | *[!0-9]*) return 1 ;; esac
}
# nuls_of <file>: sets $nl_n to the number of NUL bytes in <file>
nuls_of() {
  tr -cd '\000' < "$1" > "$tmp/nul.out" || return 1
  wc -c < "$tmp/nul.out" > "$tmp/wc.out" || return 1
  read -r nl_n < "$tmp/wc.out" || return 1
  case $nl_n in '' | *[!0-9]*) return 1 ;; esac
}

# gitc <git arguments...>: git with nothing of the caller's: no GIT_* variable, no user or system configuration, no replace refs
gitc() {
  env -i PATH="$PATH" HOME=/nonexistent XDG_CONFIG_HOME=/nonexistent LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_ATTR_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1 git --no-replace-objects "$@"
}
# resolve_commit <revision> <file>: sets $r_sha to the full sha of the commit that <revision> names (a tag is peeled); fails for anything
# that is not one commit (a tree, a blob, a range, an unknown name, an empty answer, a cut-short answer, a name that is not 40 hex digits)
resolve_commit() {
  gitc rev-parse --verify --quiet --end-of-options "$1^{commit}" > "$2" 2> "$tmp/git.err" || return 1
  read -r r_sha < "$2" || return 1
  case $r_sha in '' | *[!0-9a-f]*) return 1 ;; esac
  [ "${#r_sha}" = 40 ]
}

# ---- the list: read whole, every line judged, then proven complete ----
[ -f "$list" ] && [ -r "$list" ] || could_not "list: cannot read"
tr -d '\000' < "$list" > "$tmp/list.nonul" || could_not "list: could not be read"
nul_rc=0
cmp -s "$list" "$tmp/list.nonul" || nul_rc=$?
case $nul_rc in
  0) ;;
  1) could_not "list: contains a NUL byte" ;;
  *) could_not "list: could not be read" ;;
esac
ln=0
seen=$nl
lbad() { could_not "list: line $ln: $1"; }
while IFS= read -r line || [ -n "$line" ]; do
  ln=$((ln + 1))
  [ -n "$line" ] || lbad "blank line"
  case $line in '#'*) lbad "comment line" ;; esac
  rest=$line notab= ntab=0
  while :; do
    case $rest in
      *"$tab"*) notab=$notab${rest%%"$tab"*}; rest=${rest#*"$tab"}; ntab=$((ntab + 1)) ;;
      *) notab=$notab$rest; break ;;
    esac
  done
  case $notab in *"$cr"*) lbad "carriage return" ;; esac
  case $notab in *[[:cntrl:]]*) lbad "control character" ;; esac
  [ "$ntab" = 2 ] || lbad "not three tab-separated fields"
  l_class=${line%%"$tab"*}
  l_rest=${line#*"$tab"}
  l_pat=${l_rest%%"$tab"*}
  l_why=${l_rest#*"$tab"}
  case $l_class in basis | generated | implementation) ;; *) lbad "unknown class" ;; esac
  [ -n "$l_pat" ] || lbad "empty pattern"
  [ -n "$l_why" ] || lbad "empty reason"
  case $l_pat in /* | */) lbad "pattern starts or ends with /" ;; esac
  case $l_pat in
    *//* | . | .. | ./* | ../* | */./* | */../* | */. | */..) lbad "pattern has an empty, . or .. segment" ;;
  esac
  case $l_pat in
    *'?'* | *'['* | *']'* | *'\'*) lbad "pattern has a ?, [, ] or backslash" ;;
  esac
  case $seen in *"$nl$l_pat$nl"*) lbad "duplicate pattern" ;; esac
  seen=$seen$l_pat$nl
done < "$list"
lines_of "$list" || could_not "list: could not be counted"
if [ "$ln" != "$nl_n" ]; then
  if [ "$ln" = "$((nl_n + 1))" ]; then lbad "no line feed at the end"; fi
  could_not "list: could not be read completely"
fi

# ---- the paths: one record per line in $tmp/recs, proven complete ----
if [ "$paths_set" = 1 ]; then
  src=paths
  [ -f "$paths" ] && [ -r "$paths" ] || could_not "paths: cannot read"
  rec_in=$paths
else
  src=range
  # git runs in a clean environment (see the header). Each argument is resolved once, to the sha of ONE commit, and the shas are diffed.
  # Then two runs of git: the names, and the raw form that holds the same names with two NUL bytes per path; the second is the count
  # that proves the first complete. The options fix what a configuration could change: no rename detection, no relative paths, no
  # hidden submodule change, no external diff. git's own messages go to a file and are never shown.
  resolve_commit "$ra" "$tmp/sha.a" || could_not "range: the first argument is not a commit"
  sha_a=$r_sha
  resolve_commit "$rb" "$tmp/sha.b" || could_not "range: the second argument is not a commit"
  sha_b=$r_sha
  gitc diff --no-renames --no-relative --ignore-submodules=none --no-ext-diff --name-only -z "$sha_a" "$sha_b" -- > "$tmp/diff.names" 2> "$tmp/diff.err" || could_not "range: git diff failed"
  gitc diff --no-renames --no-relative --ignore-submodules=none --no-ext-diff --raw -z "$sha_a" "$sha_b" -- > "$tmp/diff.raw" 2> "$tmp/diff.err2" || could_not "range: git diff failed"
  nuls_of "$tmp/diff.raw" || could_not "range: the diff could not be counted"
  raw_nuls=$nl_n
  nuls_of "$tmp/diff.names" || could_not "range: the diff could not be counted"
  [ "$raw_nuls" = "$((nl_n * 2))" ] || could_not "range: the diff was cut short"
  rec_in=$tmp/diff.names
fi
tr '\000' '\n' < "$rec_in" > "$tmp/recs" || could_not "$src: could not be read"
nuls_of "$rec_in" || could_not "$src: could not be counted"
n_nul=$nl_n
lines_of "$tmp/recs" || could_not "$src: could not be counted"
[ "$n_nul" = "$nl_n" ] || could_not "$src: a line feed in a name (or the input was cut short)"
nrec=$n_nul

# classify_one <path>: sets $cls from the first list line whose pattern matches (basis when none does). The list is read again for
# every path: it was judged above, so only `*` is special in a pattern, and a path never acts as a pattern.
classify_one() {
  cls=basis
  while IFS= read -r c_line; do
    c_rest=${c_line#*"$tab"}
    c_pat=${c_rest%%"$tab"*}
    case $1 in
      $c_pat) cls=${c_line%%"$tab"*}; return 0 ;;
    esac
  done < "$list"
  return 0
}

: > "$tmp/res" || could_not "the result could not be written"
nb=0 ng=0 ni=0 got=0
rowtext=
while IFS= read -r p || [ -n "$p" ]; do
  got=$((got + 1))
  [ -n "$p" ] || could_not "$src: record $got: empty path"
  case $p in *[[:cntrl:]]*) could_not "$src: record $got: control character" ;; esac
  classify_one "$p"
  printf '%s\t%s\n' "$cls" "$p" >> "$tmp/res" || could_not "the result could not be written"
  case $cls in
    basis) nb=$((nb + 1)) ;;
    generated) ng=$((ng + 1)) ;;
    *) ni=$((ni + 1)) ;;
  esac
  if [ "$out_set" = 0 ] && [ "$quiet" = 0 ]; then rowtext=$rowtext$cls$tab$p$nl; fi
done < "$tmp/recs"
[ "$got" = "$nrec" ] || could_not "$src: the last record has no NUL (or the read was cut short)"
lines_of "$tmp/res" || could_not "the result could not be counted"
[ "$nl_n" = "$nrec" ] || could_not "the result was cut short"
[ "$((nb + ng + ni))" = "$nrec" ] || could_not "the result was cut short"

if [ "$out_set" = 1 ]; then
  # the copy is made next to --out under a temporary name, and proven complete; it is moved into place only after the cleanup below
  outtmp=$(mktemp "$out.XXXXXX") || could_not "the output file could not be made"
  [ -n "$outtmp" ] && [ -f "$outtmp" ] || could_not "the output file could not be made"
  cat "$tmp/res" > "$outtmp" || could_not "the output file could not be written"
  lines_of "$outtmp" || could_not "the output file could not be counted"
  [ "$nl_n" = "$nrec" ] || could_not "the output file is incomplete"
fi

viol=
case $req in
  basis-only) if [ "$ni" -ne 0 ]; then viol="basis-only: $ni implementation path(s)"; fi ;;
  no-basis) if [ "$nb" -ne 0 ]; then viol="no-basis: $nb basis path(s)"; fi ;;
esac
# the cleanup is a step like the others: no verdict is printed while the temporary directory cannot be removed
rm -rf "$tmp" || could_not "the temporary directory could not be removed"
tmp=
if [ "$out_set" = 1 ]; then
  mv "$outtmp" "$out" || could_not "the output file could not be put in place"
  outtmp=
  out_done=1
fi
printf '%s' "$rowtext"
printf 'classify-paths: %s path(s): %s basis, %s generated, %s implementation\n' "$nrec" "$nb" "$ng" "$ni"
if [ -n "$viol" ]; then
  echo "classify-paths: FAILED ($viol)"
  verdict_exit=1
  exit 1
fi
exit 0
