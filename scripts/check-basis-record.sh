#!/bin/sh
# Checks the order of the commits of a pull request against the record of its basis (development-flow, "基準の commit の記録"): the
# commits that change the basis (specifications, tests and what tests read) come first, and no commit that changes the basis comes after
# the recorded `basis`; and, when the record is there, that it names commits of this pull request and its two answers.
#
#   check-basis-record.sh --body <file> --head <sha> --base <sha> --repo <owner>/<repo> --pr <number> --list <file>
#
# --body  the pull request body (read only by the sibling check-review-record.sh)   --head  the head commit (40 lowercase hex digits)
# --base  the tip of the base branch (40 lowercase hex digits)   --repo, --pr  where the links of the answers must point
# --list  the list of the basis rule (basis-paths.tsv) of the BASE: it decides, whatever the head's own copy says
# It runs in the repository of the current directory, which must hold the base tip, the head and the commits between them (a full
# history, not a shallow one). Nothing is checked out, merged, applied or run, and nothing is written in the repository.
#
# The record is read by ONE parser: `check-review-record.sh --emit` (its grammar and its file; this script reads the basis lines only
# from that file, which must end in `end`). The paths are classified only by `classify-paths.sh` (called once per commit, in the form
# `--range <parent> <commit>`, and once for the whole change in the mode without a record). Both siblings are the files next to this
# script and are run with the `sh` of PATH.
#
# Without a basis line in the record: the change from the origin (the one merge base of base and head) to the head, as a whole, must not
# touch both a basis path and an implementation path (merge commits are allowed; the base's own changes are not counted).
# With a record: F = basis-first (or basis when there is none), S = basis, P = the commits of the first-parent path from the head down
# to the base (`rev-list --first-parent --parents <head> ^<base>`, proven complete by `--count`), oldest first:
#   every commit of P has one parent (a merge commit is red; a commit with no parent means no shared history); the origin is the parent
#   of the oldest one;
#   F, each basis-prev and S are on P, in strictly increasing order;
#   up to F no commit touches an implementation path, and F itself touches a basis path;
#   from F to S no commit touches both;   S itself touches a basis path;   after S no commit touches a basis path.
# basis-opus and basis-codex must name S, and their links must be of this repository and this pull request, with two different ids.
# A generated path (class `generated`) is neither basis nor implementation here. The classes are counted from the summary line of
# classify-paths.sh, whose whole output is checked (one line, the sum of the classes equal to the number of paths).
#
# Output, one line each: `basis record: not needed (one kind of path)` / `basis record: matches (origin XXXXXXXX, basis XXXXXXXX)` (exit 0);
# the findings, each as `basis record: <finding>`, and then `basis record: FAILED` (exit 1); `basis record: could not run (<reason>)`
# (exit 2: the arguments, a tool, a sibling, the repository: never a verdict and never a finding). X is the first 8 characters of a sha.
# A path name, a commit message and the body are never printed.
# The rule of the scripts that decide: no pipeline and no `|| true`; every status is checked; every answer of a tool is proven complete
# before it is used (a count taken by another command, a byte-for-byte comparison, the frame of the data, the summary line); each stage
# writes a private temporary file; the temporary directory is removed before the verdict is printed.
set -eu
LC_ALL=C
export LC_ALL
tmp=
verdict_exit=
# one EXIT trap: the cleanup, and the guard that turns a status that nobody chose (a command that failed under `set -e`) into 2
trap 'rc=$?; if [ -n "$tmp" ]; then rm -rf "$tmp" || rc=2; fi; if [ "$rc" != 0 ] && [ -z "$verdict_exit" ]; then exit 2; fi' EXIT
could_not() { echo "basis record: could not run ($1)"; exit 2; }
nl='
'
usage='usage: check-basis-record.sh --body <file> --head <sha> --base <sha> --repo <owner>/<repo> --pr <number> --list <file>'

body= head= base= repo= pr= list=
b_set=0 h_set=0 s_set=0 r_set=0 p_set=0 l_set=0
while [ $# -gt 0 ]; do
  case $1 in
    --body) [ $# -ge 2 ] && [ "$b_set" = 0 ] || could_not "$usage"; b_set=1; body=$2; shift 2 ;;
    --head) [ $# -ge 2 ] && [ "$h_set" = 0 ] || could_not "$usage"; h_set=1; head=$2; shift 2 ;;
    --base) [ $# -ge 2 ] && [ "$s_set" = 0 ] || could_not "$usage"; s_set=1; base=$2; shift 2 ;;
    --repo) [ $# -ge 2 ] && [ "$r_set" = 0 ] || could_not "$usage"; r_set=1; repo=$2; shift 2 ;;
    --pr) [ $# -ge 2 ] && [ "$p_set" = 0 ] || could_not "$usage"; p_set=1; pr=$2; shift 2 ;;
    --list) [ $# -ge 2 ] && [ "$l_set" = 0 ] || could_not "$usage"; l_set=1; list=$2; shift 2 ;;
    *) could_not "$usage" ;;
  esac
done
[ "$((b_set + h_set + s_set + r_set + p_set + l_set))" = 6 ] || could_not "$usage"
is_sha() { # is_sha <text>: 40 lowercase hexadecimal digits
  case $1 in '' | *[!0-9a-f]*) return 1 ;; esac
  [ "${#1}" = 40 ]
}
is_sha "$head" || could_not "usage: the head is not a full commit sha"
is_sha "$base" || could_not "usage: the base is not a full commit sha"
case $pr in [1-9]*) ;; *) could_not "usage: the pull request number is not a number" ;; esac
case $pr in *[!0-9]*) could_not "usage: the pull request number is not a number" ;; esac
case $repo in */*/* | /* | */ | '') could_not "usage: the repository is not <owner>/<repo>" ;; */*) ;; *) could_not "usage: the repository is not <owner>/<repo>" ;; esac
case $repo in *[!A-Za-z0-9._/-]*) could_not "usage: the repository is not <owner>/<repo>" ;; esac
case $body in -*) could_not "usage: a file name starts with -" ;; esac
case $list in -*) could_not "usage: a file name starts with -" ;; esac
[ -f "$body" ] && [ -r "$body" ] || could_not "the pull request body cannot be read"
[ -f "$list" ] && [ -r "$list" ] || could_not "the list cannot be read"
case $0 in */*) here=${0%/*} ;; *) here=. ;; esac
[ -f "$here/check-review-record.sh" ] && [ -f "$here/classify-paths.sh" ] || could_not "a sibling script is missing"

tmp=$(mktemp -d) || could_not "no temporary directory"
[ -n "$tmp" ] && [ -d "$tmp" ] || could_not "no temporary directory"

# lines_of <file>: sets $nl_n to the number of line feeds in <file> (counted by wc, read back from a file; anything but digits is a failure)
lines_of() {
  wc -l < "$1" > "$tmp/wc.out" || return 1
  read -r nl_n < "$tmp/wc.out" || return 1
  case $nl_n in '' | *[!0-9]*) return 1 ;; esac
}
# same_as <file> <text>: the whole content of <file> is <text> and one line feed (compared byte for byte)
same_as() {
  printf '%s\n' "$2" > "$1.exp" || return 1
  sa_rc=0
  cmp -s "$1" "$1.exp" || sa_rc=$?
  [ "$sa_rc" = 0 ]
}
# gitc <git arguments...>: git with nothing of the caller's: no GIT_* variable, no user or system configuration, no replace refs
gitc() {
  env -i PATH="$PATH" HOME=/nonexistent XDG_CONFIG_HOME=/nonexistent LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_ATTR_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1 git --no-replace-objects "$@"
}
s8() { s8r=${1%"${1#????????}"}; } # sets $s8r to the first 8 characters

# ---- the repository: a full history, and both ends are commits ----
gitc rev-parse --is-shallow-repository > "$tmp/shallow" 2> "$tmp/git.err" || could_not "the repository could not be read"
same_as "$tmp/shallow" false || could_not "the history is shallow (or the repository could not be read)"
gitc cat-file -t "$head" > "$tmp/type.head" 2> "$tmp/git.err" || could_not "the head is not an object of this repository"
same_as "$tmp/type.head" commit || could_not "the head is not a commit"
gitc cat-file -t "$base" > "$tmp/type.base" 2> "$tmp/git.err" || could_not "the base is not an object of this repository"
same_as "$tmp/type.base" commit || could_not "the base is not a commit"

# ---- the record: the review check says it passes, and the values come from its emit file ----
rr_rc=0
sh "$here/check-review-record.sh" "$body" "$head" --emit "$tmp/emit" > "$tmp/rr.out" 2> "$tmp/rr.err" < /dev/null || rr_rc=$?
rr_last=
while IFS= read -r rr_line; do rr_last=$rr_line; done < "$tmp/rr.out"
finds=
nfind=0
find() { finds=$finds"basis record: $1$nl"; nfind=$((nfind + 1)); }
case $rr_rc in
  0)
    same_as "$tmp/rr.out" 'review record: matches the head' || could_not "the review check did not answer completely" ;;
  1)
    [ "$rr_last" = 'review record: FAILED' ] || could_not "the review check did not answer completely"
    find "the review record does not pass (see the review step)" ;;
  *) could_not "the review check could not run" ;;
esac

e_first= e_prev= e_basis= e_bo= e_bc=
if [ "$rr_rc" = 0 ]; then
  [ -f "$tmp/emit" ] || could_not "the review check left no record"
  lines_of "$tmp/emit" || could_not "the record could not be counted"
  e_lines=$nl_n
  got=0 ended=0 phase=0
  while read -r e_key e_a e_b e_c e_d e_x; do
    got=$((got + 1))
    [ "$ended" = 0 ] || could_not "the record has a line after its last line"
    case $e_key in
      end) [ -z "$e_a$e_b$e_c$e_d$e_x" ] || could_not "the record could not be read"; ended=1 ;;
      basis-first) [ "$phase" -lt 1 ] && is_sha "$e_a" && [ -z "$e_b$e_c$e_d$e_x" ] || could_not "the record could not be read"; phase=1; e_first=$e_a ;;
      basis-prev) [ "$phase" -ge 1 ] && [ "$phase" -le 2 ] && is_sha "$e_a" && [ -z "$e_b$e_c$e_d$e_x" ] || could_not "the record could not be read"; phase=2; e_prev=$e_prev$e_a$nl ;;
      basis) [ "$phase" -lt 3 ] && is_sha "$e_a" && [ -z "$e_b$e_c$e_d$e_x" ] || could_not "the record could not be read"; phase=3; e_basis=$e_a ;;
      basis-opus) [ "$phase" = 3 ] && is_sha "$e_a" && [ -n "$e_d" ] && [ -z "$e_x" ] || could_not "the record could not be read"; phase=4; e_bo="$e_a $e_b $e_c $e_d" ;;
      basis-codex) [ "$phase" -ge 3 ] && [ "$phase" -le 4 ] && is_sha "$e_a" && [ -n "$e_d" ] && [ -z "$e_x" ] || could_not "the record could not be read"; phase=5; e_bc="$e_a $e_b $e_c $e_d" ;;
      *) could_not "the record could not be read" ;;
    esac
  done < "$tmp/emit"
  [ "$ended" = 1 ] || could_not "the record was cut short"
  [ "$got" = "$e_lines" ] || could_not "the record was cut short"
  if [ -n "$e_basis" ]; then
    [ -n "$e_bo" ] && [ -n "$e_bc" ] || could_not "the record could not be read"
  else
    [ -z "$e_first$e_prev$e_bo$e_bc" ] || could_not "the record could not be read"
  fi
fi

# classify_range <a> <b>: sets $c_basis, $c_impl: the numbers of basis and implementation paths changed from <a> to <b> (the whole
# answer of the classifier is one summary line whose classes add up to its number of paths)
classify_range() {
  cr_rc=0
  sh "$here/classify-paths.sh" --list "$list" --range "$1" "$2" --quiet > "$tmp/cl.out" 2> "$tmp/cl.err" < /dev/null || cr_rc=$?
  [ "$cr_rc" = 0 ] || could_not "the classifier could not run"
  lines_of "$tmp/cl.out" || could_not "the classifier's answer could not be counted"
  [ "$nl_n" = 1 ] || could_not "the classifier's answer is incomplete"
  read -r cr_line < "$tmp/cl.out" || could_not "the classifier's answer could not be read"
  case $cr_line in 'classify-paths: '*' path(s): '*' basis, '*' generated, '*' implementation') ;; *) could_not "the classifier's answer is incomplete" ;; esac
  cr_r=${cr_line#classify-paths: }
  cr_n=${cr_r%% path(s):*}
  cr_r=${cr_r#*path(s): }
  c_basis=${cr_r%% basis,*}
  cr_r=${cr_r#*basis, }
  cr_g=${cr_r%% generated,*}
  cr_r=${cr_r#*generated, }
  c_impl=${cr_r% implementation}
  for cr_v in "$cr_n" "$c_basis" "$cr_g" "$c_impl"; do
    case $cr_v in '' | *[!0-9]*) could_not "the classifier's answer is incomplete" ;; esac
  done
  [ "$cr_line" = "classify-paths: $cr_n path(s): $c_basis basis, $cr_g generated, $c_impl implementation" ] || could_not "the classifier's answer is incomplete"
  [ "$((c_basis + cr_g + c_impl))" = "$cr_n" ] || could_not "the classifier's answer is incomplete"
}

result=
if [ "$rr_rc" = 1 ]; then
  : # the record is not usable: the finding above is the verdict
elif [ -z "$e_basis" ]; then
  # ---- no basis line: the change as a whole, from the origin ----
  mb_rc=0
  gitc merge-base --all "$base" "$head" > "$tmp/mb" 2> "$tmp/mb.err" || mb_rc=$?
  lines_of "$tmp/mb" || could_not "the merge bases could not be counted"
  mb_n=$nl_n
  mb_got=0
  origin=
  while IFS= read -r mb_line; do
    mb_got=$((mb_got + 1))
    is_sha "$mb_line" || could_not "the merge bases could not be read"
    origin=$mb_line
  done < "$tmp/mb"
  [ "$mb_got" = "$mb_n" ] || could_not "the merge bases were cut short"
  case $mb_rc:$mb_n in
    1:0) find "the pull request shares no history with the base" ;;
    0:1) # one line is not proof of one merge base (an answer cut from 2 lines to 1 looks the same): prove it is the only one.
         # Every common ancestor is an ancestor of the origin exactly when |ancestors(base)| + |ancestors(head)| - |their union| = |ancestors(origin)|.
         for mp_side in "$base" "$head"; do
           mp_rc=0
           gitc merge-base --is-ancestor "$origin" "$mp_side" > "$tmp/mp" 2> "$tmp/mp.err" || mp_rc=$?
           [ "$mp_rc" = 0 ] || could_not "the merge base could not be proved to be the only one"
         done
         mp_a= mp_b= mp_u= mp_o=
         gitc rev-list --count "$base" > "$tmp/mp_a" 2> "$tmp/mp.err" || could_not "the merge base could not be proved to be the only one"
         read -r mp_a < "$tmp/mp_a" || could_not "the merge base could not be proved to be the only one"
         gitc rev-list --count "$head" > "$tmp/mp_b" 2> "$tmp/mp.err" || could_not "the merge base could not be proved to be the only one"
         read -r mp_b < "$tmp/mp_b" || could_not "the merge base could not be proved to be the only one"
         gitc rev-list --count "$base" "$head" > "$tmp/mp_u" 2> "$tmp/mp.err" || could_not "the merge base could not be proved to be the only one"
         read -r mp_u < "$tmp/mp_u" || could_not "the merge base could not be proved to be the only one"
         gitc rev-list --count "$origin" > "$tmp/mp_o" 2> "$tmp/mp.err" || could_not "the merge base could not be proved to be the only one"
         read -r mp_o < "$tmp/mp_o" || could_not "the merge base could not be proved to be the only one"
         for mp_v in "$mp_a" "$mp_b" "$mp_u" "$mp_o"; do
           case $mp_v in '' | *[!0-9]*) could_not "the merge base could not be proved to be the only one" ;; esac
         done
         same_as "$tmp/mp_a" "$mp_a" && same_as "$tmp/mp_b" "$mp_b" && same_as "$tmp/mp_u" "$mp_u" && same_as "$tmp/mp_o" "$mp_o" || could_not "the merge base could not be proved to be the only one"
         [ "$((mp_a + mp_b - mp_u))" = "$mp_o" ] || could_not "the merge base could not be proved to be the only one"
         classify_range "$origin" "$head"
         if [ "$c_basis" -gt 0 ] && [ "$c_impl" -gt 0 ]; then find "record the basis"; else result="basis record: not needed (one kind of path)"; fi ;;
    0:*) if [ "$mb_n" -lt 1 ]; then could_not "the merge base could not be read"; fi
         find "the pull request has several merge bases with the base (rebuild on the base)" ;;
    *) could_not "the merge base could not be found" ;;
  esac
else
  # ---- a record: the commits of the pull request, oldest first ----
  gitc rev-list --first-parent --parents "$head" "^$base" > "$tmp/P" 2> "$tmp/git.err" || could_not "the commits could not be listed"
  gitc rev-list --first-parent --count "$head" "^$base" > "$tmp/Pn" 2> "$tmp/git.err" || could_not "the commits could not be counted"
  read -r p_count < "$tmp/Pn" || could_not "the commits could not be counted"
  case $p_count in '' | *[!0-9]*) could_not "the commits could not be counted" ;; esac
  same_as "$tmp/Pn" "$p_count" || could_not "the commits could not be counted"
  lines_of "$tmp/P" || could_not "the commits could not be counted"
  [ "$nl_n" = "$p_count" ] || could_not "the list of commits was cut short"
  chain=
  p_got=0
  p_root=0
  while IFS=' ' read -r pc pp1 pp2 prest; do
    p_got=$((p_got + 1))
    is_sha "$pc" || could_not "the commits could not be read"
    if [ -z "$pp1" ]; then
      p_root=1
      np=0
    else
      is_sha "$pp1" || could_not "the commits could not be read"
      np=1
      if [ -n "$pp2$prest" ]; then
        np=2
        s8 "$pc"
        find "merge commit $s8r is on the path (rebuild on the new base and record again)"
      fi
    fi
    chain="$pc ${pp1:-none} $np$nl$chain"
  done < "$tmp/P"
  [ "$p_got" = "$p_count" ] || could_not "the list of commits was cut short"
  if [ "$p_root" = 1 ]; then find "the pull request shares no history with the base"; fi
  printf '%s' "$chain" > "$tmp/chain" || could_not "the commits could not be written"

  # idx_of <sha>: sets $r_idx to the place of <sha> on the path (1 is the oldest), 0 when it is not on it
  idx_of() {
    r_idx=0
    ix_i=0
    while read -r ix_c ix_p ix_n; do
      ix_i=$((ix_i + 1))
      if [ "$ix_c" = "$1" ]; then r_idx=$ix_i; break; fi
    done < "$tmp/chain"
  }
  miss=0
  ord_bad=0
  prev_i=0
  F_i=0 S_i=0
  for rec in "first:$e_first" "prev:$e_prev" "basis:$e_basis"; do
    rkind=${rec%%:*}
    rlist=${rec#*:}
    while [ -n "$rlist" ]; do
      rsha=${rlist%%"$nl"*}
      case $rlist in *"$nl"*) rlist=${rlist#*"$nl"} ;; *) rlist= ;; esac
      [ -n "$rsha" ] || continue
      idx_of "$rsha"
      if [ "$r_idx" = 0 ]; then
        s8 "$rsha"
        find "$s8r is not a commit of this pull request"
        miss=1
      else
        [ "$r_idx" -gt "$prev_i" ] || ord_bad=1
        prev_i=$r_idx
      fi
      if [ "$rkind" = first ]; then F_i=$r_idx; fi
      if [ "$rkind" = basis ]; then S_i=$r_idx; fi
    done
  done
  # strictly increasing order is judged only when every record is on the path (a missing one is already a finding)
  if [ "$miss" = 0 ] && [ "$ord_bad" = 1 ]; then find "the recorded commits are not in order on the path"; fi
  if [ "$F_i" = 0 ]; then F_i=$S_i; fi

  # the per-commit rules need single-parent commits and records that are on the path in order
  if [ "$nfind" = 0 ]; then
    k=0
    while read -r kc kp kn; do
      k=$((k + 1))
      classify_range "$kp" "$kc"
      tb=0 ti=0
      if [ "$c_basis" -gt 0 ]; then tb=1; fi
      if [ "$c_impl" -gt 0 ]; then ti=1; fi
      s8 "$kc"
      if [ "$k" -le "$F_i" ]; then
        if [ "$ti" = 1 ]; then find "commit $s8r up to the first record changes implementation path(s)"; fi
        if [ "$k" = "$F_i" ] && [ "$tb" = 0 ]; then find "the first record changes no basis path"; fi
      elif [ "$k" -le "$S_i" ]; then
        if [ "$tb" = 1 ] && [ "$ti" = 1 ]; then find "commit $s8r between the first record and basis changes basis and implementation paths"; fi
      fi
      if [ "$k" = "$S_i" ] && [ "$tb" = 0 ]; then find "basis $s8r changes no basis path"; fi
      if [ "$k" -gt "$S_i" ] && [ "$tb" = 1 ]; then find "commit $s8r after basis changes basis path(s)"; fi
    done < "$tmp/chain"
    [ "$k" = "$p_count" ] || could_not "the list of commits was cut short"
  fi

  # the two answers: the sha of each is basis, the link is a comment of this pull request, and the two are different comments
  for who in opus codex; do
    if [ "$who" = opus ]; then rv=$e_bo; else rv=$e_bc; fi
    rsha=${rv%% *}
    rest=${rv#* }
    rwhere=${rest%% *}
    rest=${rest#* }
    rnum=${rest%% *}
    if [ "$rsha" != "$e_basis" ]; then
      s8 "$rsha"; x=$s8r
      s8 "$e_basis"
      find "basis-$who names $x, basis is $s8r"
    fi
    if [ "$rwhere" != "$repo" ] || [ "$rnum" != "$pr" ]; then find "the basis-$who link is not a comment of this pull request"; fi
  done
  id_o=${e_bo##* }
  id_c=${e_bc##* }
  if [ "$id_o" = "$id_c" ]; then find "basis-opus and basis-codex point to the same comment"; fi

  if [ "$nfind" = 0 ]; then
    # the origin: the parent of the oldest commit of the path, which the base must hold
    read -r o_c o_p o_n < "$tmp/chain" || could_not "the commits could not be read"
    is_sha "$o_p" || could_not "the origin could not be found"
    anc_rc=0
    gitc merge-base --is-ancestor "$o_p" "$base" > "$tmp/anc" 2> "$tmp/git.err" || anc_rc=$?
    [ "$anc_rc" = 0 ] || could_not "the origin is not held by the base"
    s8 "$o_p"; x=$s8r
    s8 "$e_basis"
    result="basis record: matches (origin $x, basis $s8r)"
  fi
fi

# the cleanup is a step like the others: no verdict is printed while the temporary directory cannot be removed
rm -rf "$tmp" || could_not "the temporary directory could not be removed"
tmp=
if [ "$nfind" = 0 ] && [ -n "$result" ]; then
  echo "$result"
  exit 0
fi
[ "$nfind" != 0 ] || could_not "no verdict"
printf '%s' "$finds"
echo "basis record: FAILED"
verdict_exit=1
exit 1
