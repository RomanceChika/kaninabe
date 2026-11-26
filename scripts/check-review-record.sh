#!/bin/sh
# Checks the pull request's review record against its head, so that a change made after a review cannot be merged
# without being reviewed again. The record is a `## Review` section in the pull request body:
#
#   ## Review
#   - opus: <full commit sha the review saw, with no finding left open>
#   - codex: <full commit sha the review saw, with no finding left open>
#
# A merge needs both: each reviewer has said that nothing more needs fixing at the head. There is no way to skip one.
#
# Every push moves the head, so the record no longer matches and this check fails until the new diff is reviewed and
# the record is rewritten. Editing the body re-runs it (the workflow listens to `edited`).
# Usage: check-review-record.sh <body-file> <head-sha>
set -eu
f=${1:?usage: check-review-record.sh <body-file> <head-sha>}
head=${2:?usage: check-review-record.sh <body-file> <head-sha>}
[ -f "$f" ] && [ -r "$f" ] || { echo "review record: cannot read the pull request body"; exit 2; }
printf '%s\n' "$head" | grep -qxE '[0-9a-f]{40}' || { echo "review record: the head is not a full commit sha"; exit 2; }
sec=$(tr -d '\r' < "$f" | awk '/^## Review[[:space:]]*$/ { on = 1; next } /^## / { on = 0 } on')
line() { printf '%s\n' "$sec" | sed -n "s/^- $1:[[:space:]]*//p" | sed 's/[[:space:]]*$//'; }
fail=0
opus=$(line opus); codex=$(line codex)
if [ "$(printf '%s\n' "$opus" | grep -c .)" != "1" ]; then echo "review record: need exactly one '- opus:' line under '## Review'"; fail=1
elif [ "$opus" != "$head" ]; then echo "review record: opus reviewed ${opus%"${opus#????????}"}, the head is ${head%"${head#????????}"} (review the new diff, then update the record)"; fail=1; fi
if [ "$(printf '%s\n' "$codex" | grep -c .)" != "1" ]; then echo "review record: need exactly one '- codex:' line under '## Review'"; fail=1
elif [ "$codex" != "$head" ]; then echo "review record: codex reviewed ${codex%"${codex#????????}"}, the head is ${head%"${head#????????}"} (review the new diff, then update the record)"; fail=1; fi
[ "$fail" -eq 0 ] && echo "review record: matches the head" || { echo "review record: FAILED"; exit 1; }
