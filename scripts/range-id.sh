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
range_list_id() {
  { printf 'head %s\n' "$1"; cat "$2"; } | sha256sum | cut -d' ' -f1
}
range_id() {
  printf 'kaninabe-range-v1\nurl %s\nlist %s\n' "$1" "$2" | sha256sum | cut -d' ' -f1
}
range_is_id() { printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{64}$'; }
