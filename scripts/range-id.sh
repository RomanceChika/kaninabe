# Sourced by push-range.sh and push-gate.sh (not run). The identity of "what this push puts in front of the scans", computed
# in one place from fixed inputs and nothing else:
#   list id  = sha256 of "head <head sha>\n" followed by the ordered commit list (full ids, one per line, as
#              `git rev-list` prints them from the neutral repository)
#   range id = sha256 of "kaninabe-range-v1\nurl <destination URL actually contacted>\nlist <list id>\n"
# The reviewer records "<head sha> <range id>" (git config kaninabe.contentReviewed); the hook recomputes the range id at push
# time; the gate is given the list id and stops if the commits it would scan are not the list the id was computed from.
#
# range_list_id <head sha> <file holding the commit list>
# range_id <url> <list id>
# (no pipe: each stage writes a file and its status is checked; the work files are <file>.idin / <work>.idin in the caller's private dir.
# Both print the id and return 0, or print nothing and return 1.)
range_list_id() {
  { printf 'head %s\n' "$1"; cat "$2"; } > "$2.idin" || return 1
  rl_h=$(sha256sum < "$2.idin") || return 1
  rl_h=${rl_h%% *}
  range_is_id "$rl_h" || return 1
  printf '%s\n' "$rl_h"
}
# range_id <url> <list id> <work file path>
range_id() {
  printf 'kaninabe-range-v1\nurl %s\nlist %s\n' "$1" "$2" > "$3.idin" || return 1
  ri_h=$(sha256sum < "$3.idin") || return 1
  ri_h=${ri_h%% *}
  range_is_id "$ri_h" || return 1
  printf '%s\n' "$ri_h"
}
# range_is_id <value>: 64 lowercase hex digits. is_commit_id <value>: 40 or 64 lowercase hex digits. (case, no grep)
range_is_id() { case $1 in '' | *[!0-9a-f]*) return 1 ;; esac; [ "${#1}" = 64 ]; }
is_commit_id() { case $1 in '' | *[!0-9a-f]*) return 1 ;; esac; [ "${#1}" = 40 ] || [ "${#1}" = 64 ]; }
