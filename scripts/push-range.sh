#!/bin/sh
# Which commits does a push put in front of the scans? The one place that decides, for the pre-push hook and for the
# human who reads the push for publication (that reader reads exactly the commits this prints).
# Usage: push-range.sh [--gate-args] <remote name or URL> [<remote sha>...]
#   default      prints the commits (full ids, one per line): every commit reachable from HEAD except those that the
#                DESTINATION itself has just said it has
#   --gate-args  prints the arguments that give push-gate.sh the same set: `--all`, or `--not-on <sha>,<sha>...`
#   <remote sha> a commit the destination had for the ref being pushed (git gives it to the hook on stdin); it counts only
#                if the destination advertises it now too, so it can never add to what is subtracted
# The destination is asked now: `git ls-remote --heads <url>`. A commit is subtracted only if the destination advertises
# it, the commit is here, and its history can be read to the end. A remote-tracking ref is local state, not proof, and is
# never consulted. Nothing is guessed: if the destination cannot be asked, or the history cannot be read to the end (a
# shallow clone, missing objects), the script stops (exit 2) with a reason and prints no list, never a smaller scan.
# Commits that the destination holds only under other refs (tags, pull request refs, hidden refs) are not subtracted:
# that is more to scan, never less.
set -eu
die() { echo "push-range: $*" >&2; exit 2; }

gate_args=0
if [ "${1:-}" = "--gate-args" ]; then gate_args=1; shift; fi
dest=${1:-}
[ -n "$dest" ] || die "usage: push-range.sh [--gate-args] <remote name or URL> [<remote sha>...]"
shift
case $dest in -*) die "the destination looks like an option" ;; esac

# Git for everything but the question to the destination runs without the caller's environment and configuration.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/home"
cg() {
  env -i PATH="$PATH" HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/.config" TMPDIR="$tmp" LC_ALL=C.UTF-8 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 git "$@"
}

top=$(cg rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$top"
cg rev-parse --verify -q 'HEAD^{commit}' >/dev/null || die "HEAD is not a commit"
[ "$(cg rev-parse --is-shallow-repository)" = false ] || die "this is a shallow clone, so the history cannot be read to the end"

# A remote name is read as the URL that a push to it uses.
if url=$(cg remote get-url --push "$dest" 2>/dev/null); then dest=$url; fi

git ls-remote --heads -- "$dest" > "$tmp/advertised" 2>/dev/null || die "could not ask the destination for its branches (git ls-remote failed)"
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
  if cg cat-file -e "$s^{commit}" 2>/dev/null; then printf '%s\n' "$s" >> "$tmp/confirmed"; fi
done

confirmed=$(tr '\n' ' ' < "$tmp/confirmed")
if [ -n "$confirmed" ]; then
  # shellcheck disable=SC2086
  cg rev-list $confirmed > /dev/null 2>&1 || die "the history cannot be read to the end"
  revs="HEAD --not $confirmed"
else
  revs="HEAD"
fi
# shellcheck disable=SC2086
cg rev-list $revs > "$tmp/commits" 2>/dev/null || die "the history cannot be read to the end"
# shellcheck disable=SC2086
cg rev-list --objects --missing=print $revs > "$tmp/objects" 2>/dev/null || die "the history cannot be read to the end"
if grep -q '^?' "$tmp/objects"; then die "objects are missing here, so the history cannot be read to the end"; fi

n=$(wc -l < "$tmp/commits" | tr -d ' ')
echo "push-range: $n commit(s) not on the destination ($(grep -c . "$tmp/confirmed" || true) of its commit(s) known here)" >&2
if [ "$gate_args" = 1 ]; then
  if [ -z "$confirmed" ]; then echo "--all"
  else printf -- '--not-on %s\n' "$(tr '\n' ',' < "$tmp/confirmed" | sed 's/,$//')"; fi
else
  cat "$tmp/commits"
fi
