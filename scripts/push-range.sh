#!/bin/sh
# Which commits does a push put in front of the scans? The one place that decides, for the pre-push hook and for the
# human who reads the push for publication (that reader reads exactly the commits this prints).
# Usage: push-range.sh [--gate-args] [--head <sha>] <remote name or URL> [<remote sha>...]
#   --head <sha> the commit that is being pushed (the hook passes it); the script stops if HEAD is another commit
#   default      prints the commits (full ids, one per line): every commit reachable from HEAD except those that the
#                DESTINATION itself has just said it has
#   --gate-args  prints 3 lines: the arguments that give push-gate.sh the same set (`--all` or `--not-on <sha>,<sha>...`, then
#                `--list-id <id>`), `range-id=<id>`, and `commits=<n>`
#   Either way the range id (see range-id.sh) is the value to record: `git config kaninabe.contentReviewed "<head> <range id>"`
#   <remote sha> a commit the destination had for the ref being pushed (git gives it to the hook on stdin); it counts only
#                if the destination advertises it now too, so it can never add to what is subtracted
# The destination is asked now: `git ls-remote --heads <url>`. A commit is subtracted only if the destination advertises
# it, the commit is here, and its history can be read to the end. A remote-tracking ref is local state, not proof, and is
# never consulted. Nothing is guessed: if the destination cannot be asked, or the history cannot be read to the end (a
# shallow clone, missing objects), the script stops (exit 2) with a reason and prints no list, never a smaller scan.
# The place that is asked is the place the push goes to. A remote name is read as its push URL the way push reads it (in the
# caller's configuration); `git ls-remote <url>` applies url.<x>.insteadOf once more, so the URL it would really contact is
# compared with the one given (`git ls-remote --get-url`, same configuration), and if they differ nothing is subtracted:
# another repository's answer is never used. The repository is the caller's (see repo-context.sh).
# Commits that the destination holds only under other refs (tags, pull request refs, hidden refs) are not subtracted:
# that is more to scan, never less.
set -eu
die() { echo "push-range: $*" >&2; exit 2; }
grep_failed() { die "a search could not run (grep exit $1)"; }

gate_args=0
want_head=
while :; do
  case ${1:-} in
    --gate-args) gate_args=1; shift ;;
    --head) [ $# -ge 2 ] || die "--head needs a value"; want_head=$2; shift 2 ;;
    *) break ;;
  esac
done
dest=${1:-}
[ -n "$dest" ] || die "usage: push-range.sh [--gate-args] [--head <sha>] <remote name or URL> [<remote sha>...]"
shift
case $dest in -*) die "the destination looks like an option" ;; esac
if [ -n "$want_head" ]; then
  printf '%s\n' "$want_head" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$' || die "--head needs a full commit id"
fi

# The repository is decided here, in the caller's environment, and handed on explicitly.
. "$(dirname "$0")/repo-context.sh"
. "$(dirname "$0")/neutral-git.sh"
. "$(dirname "$0")/range-id.sh"
repo_resolve_top || die "$repo_error"
cd "$repo_top"

# Git for everything but the question to the destination runs without the caller's environment and configuration.
tmp=$(mktemp -d)
trap 'rc=$?; rm -rf "$tmp"; guard_exit "$rc"' EXIT
mkdir "$tmp/home"
cg() {
  env -i PATH="$PATH" HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/.config" TMPDIR="$tmp" LC_ALL=C.UTF-8 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1 GIT_DIR="$repo_gitdir" git "$@"
}

# The real repository is asked for the id of HEAD (replace refs ignored) and whether it is shallow, nothing else about
# history: the commits are read from the neutral repository (objects only: no config, no info/, no refs, no replace refs).
head_sha=$(cg rev-parse --verify -q 'HEAD^{commit}') || die "HEAD is not a commit"
if [ -n "$want_head" ] && [ "$head_sha" != "$want_head" ]; then die "HEAD is not the commit being pushed"; fi
ng_repo=$repo_gitdir
neutral_git_setup "$tmp" || die "$ng_error"

# A remote name is read as the URL that a push to it uses (caller's configuration, as push does it).
if url=$(git remote get-url --push "$dest" 2>/dev/null); then dest=$url; fi

# The URL that ls-remote would really contact (same configuration as the ls-remote below). If it is not the URL the push
# goes to, the answer would come from another repository: nothing is subtracted (every commit is scanned).
effective=$(git ls-remote --get-url -- "$dest" 2>/dev/null) || die "could not ask the destination for its branches (git ls-remote failed)"
if [ "$effective" = "$dest" ]; then
  git ls-remote --heads -- "$dest" > "$tmp/advertised" 2>/dev/null || die "could not ask the destination for its branches (git ls-remote failed)"
else
  : > "$tmp/advertised"
  echo "push-range: the destination's URL is rewritten for a question (url.<x>.insteadOf): nothing is subtracted, every commit is scanned" >&2
fi
cut -f1 "$tmp/advertised" > "$tmp/shas"
# The remote shas that git hands the hook are the destination's own answer from a moment ago, but they are only taken
# into account when the destination advertises them now as well: nothing that is merely claimed is subtracted.
for s in "$@"; do
  case $s in *[!0-9a-f]* | '') die "a remote sha is not a commit id" ;; esac
done

# Only what is here as a commit counts; an advertised commit that we do not have is simply not subtracted.
: > "$tmp/confirmed"
sort -u "$tmp/shas" | while IFS= read -r s; do
  [ -n "$s" ] || continue
  if neutral_git cat-file -e "$s^{commit}" 2>/dev/null; then printf '%s\n' "$s" >> "$tmp/confirmed"; fi
done

confirmed=$(tr '\n' ' ' < "$tmp/confirmed")
if [ -n "$confirmed" ]; then
  # shellcheck disable=SC2086
  neutral_git rev-list $confirmed > /dev/null 2>&1 || die "the history cannot be read to the end"
  revs="$head_sha --not $confirmed"
else
  revs="$head_sha"
fi
# shellcheck disable=SC2086
neutral_git rev-list $revs > "$tmp/commits" 2>/dev/null || die "the history cannot be read to the end"
# shellcheck disable=SC2086
neutral_git rev-list --objects --missing=print $revs > "$tmp/objects" 2>/dev/null || die "the history cannot be read to the end"
if grep_q -q '^?' "$tmp/objects"; then die "objects are missing here, so the history cannot be read to the end"; fi

wc_num -l "$tmp/commits" || die "could not count the commits"; n=$wc_v
# The identity of this range: the URL contacted, the head and the exact ordered list (range-id.sh). Computed here, from the
# same resolved inputs the list came from; the gate is handed the list id and checks it against the list it scans.
list_id=$(range_list_id "$head_sha" "$tmp/commits")
rid=$(range_id "$dest" "$list_id")
range_is_id "$list_id" && range_is_id "$rid" || die "could not compute the range id (sha256sum is needed)"
echo "push-range: $n commit(s) not on the destination ($(grep -c . "$tmp/confirmed" || true) of its commit(s) known here)" >&2
if [ "$gate_args" = 1 ]; then
  # line 1: the gate arguments; line 2: the range id; line 3: the number of commits
  if [ -z "$confirmed" ]; then printf -- '--all --list-id %s\n' "$list_id"
  else printf -- '--not-on %s --list-id %s\n' "$(tr '\n' ',' < "$tmp/confirmed" | sed 's/,$//')" "$list_id"; fi
  printf 'range-id=%s\ncommits=%s\n' "$rid" "$n"
else
  cat "$tmp/commits"
  echo "push-range: after reading these commits, record: git config kaninabe.contentReviewed \"$head_sha $rid\"" >&2
fi
