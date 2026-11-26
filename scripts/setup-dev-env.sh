#!/bin/sh
# Sets up a development environment for the push-before gate: the hook path, and the two scanners the gate needs
# (gitleaks and actionlint), each downloaded at a pinned version and installed only after its sha256 matches the pin.
# Optionally records where the word list is and who the repository owner is (git config kaninabe.scanWords / scanOwner;
# the list itself is never read, printed or copied here).
# Usage: setup-dev-env.sh [--bin-dir <dir>] [--words <file>] [--owner <name>]
#   --bin-dir  where the tools go (default /usr/local/bin; it must be on PATH afterwards)
#   --words    the word list file (default: $SCAN_WORDS_FILE); recorded as kaninabe.scanWords
#   --owner    the repository owner (default: $SCAN_OWNER); recorded as kaninabe.scanOwner
# The hook path is set last, after both tools are in and run. Exit 0 only when everything is in place.
# SETUP_DEV_ENV_MIRROR (a base URL holding the same file names) replaces github.com for the download, for tests; the
# pinned checksums below are not overridable, so a mirror cannot change what gets installed.
set -eu

GITLEAKS_VERSION=8.30.0
GITLEAKS_SHA256=79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e
GITLEAKS_FILE="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
GITLEAKS_URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_FILE}"
# From the checksums file published with the release (actionlint_1.7.7_checksums.txt), line linux_amd64.
ACTIONLINT_VERSION=1.7.7
ACTIONLINT_SHA256=023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757
ACTIONLINT_FILE="actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
ACTIONLINT_URL="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${ACTIONLINT_FILE}"

die() { echo "setup-dev-env: $*" >&2; exit 1; }

bin_dir=/usr/local/bin
words=${SCAN_WORDS_FILE:-}
owner=${SCAN_OWNER:-}
while [ $# -gt 0 ]; do
  case $1 in
    --bin-dir) [ $# -ge 2 ] || die "--bin-dir needs a value"; bin_dir=$2; shift 2 ;;
    --words) [ $# -ge 2 ] || die "--words needs a value"; words=$2; shift 2 ;;
    --owner) [ $# -ge 2 ] || die "--owner needs a value"; owner=$2; shift 2 ;;
    *) die "unknown argument (usage: setup-dev-env.sh [--bin-dir <dir>] [--words <file>] [--owner <name>])" ;;
  esac
done

[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || die "the pinned tools are for linux x64 only; install gitleaks ${GITLEAKS_VERSION} and actionlint ${ACTIONLINT_VERSION} by hand and set core.hooksPath"
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -n "$words" ]; then
  [ -f "$words" ] && [ -r "$words" ] && [ -s "$words" ] || die "the word list is not a readable, non-empty file"
  case $words in /*) ;; *) words="$(pwd)/$words" ;; esac
fi
if [ -n "$owner" ]; then
  case $owner in *[!A-Za-z0-9-]* | '') die "the owner is not a GitHub account name" ;; esac
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "neither sha256sum nor shasum is available"; fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# fetch NAME FILE URL SHA: download, then refuse unless the sha256 is the pinned one.
fetch() {
  url=$3
  [ -z "${SETUP_DEV_ENV_MIRROR:-}" ] || url="${SETUP_DEV_ENV_MIRROR%/}/$2"
  curl -sSfL --retry 2 -o "$work/$2" "$url" 2>/dev/null || die "could not download $1 ${2}"
  got=$(sha256_of "$work/$2")
  [ "$got" = "$4" ] || die "checksum mismatch for $1 (the download is not the pinned release; nothing was installed)"
  echo "setup-dev-env: $1 download verified"
}

# Both downloads are verified before anything is installed.
fetch gitleaks "$GITLEAKS_FILE" "$GITLEAKS_URL" "$GITLEAKS_SHA256"
fetch actionlint "$ACTIONLINT_FILE" "$ACTIONLINT_URL" "$ACTIONLINT_SHA256"

mkdir -p "$work/gl" "$work/al"
tar -xzf "$work/$GITLEAKS_FILE" -C "$work/gl" gitleaks || die "could not unpack gitleaks"
tar -xzf "$work/$ACTIONLINT_FILE" -C "$work/al" actionlint || die "could not unpack actionlint"
mkdir -p "$bin_dir" || die "cannot create $bin_dir (use --bin-dir <dir> and put it on PATH)"
install -m 0755 "$work/gl/gitleaks" "$bin_dir/gitleaks" || die "cannot write to $bin_dir (use --bin-dir <dir> and put it on PATH)"
install -m 0755 "$work/al/actionlint" "$bin_dir/actionlint" || die "cannot write to $bin_dir (use --bin-dir <dir> and put it on PATH)"

# Whatever the gate will find on PATH must be the tools just installed, and they must run.
for t in gitleaks actionlint; do
  found=$(command -v "$t" 2>/dev/null || true)
  [ -n "$found" ] || die "$t is not on PATH: add $bin_dir to PATH"
  [ "$found" = "$bin_dir/$t" ] || die "$t on PATH is $found, not the one just installed in $bin_dir: put $bin_dir first on PATH"
done
gitleaks version >/dev/null 2>&1 || die "gitleaks was installed but does not run"
actionlint -version >/dev/null 2>&1 || die "actionlint was installed but does not run"

[ -x "$root/.githooks/pre-push" ] || die ".githooks/pre-push is missing or not executable"
git -C "$root" config core.hooksPath .githooks || die "could not set core.hooksPath"
[ -z "$words" ] || git -C "$root" config kaninabe.scanWords "$words" || die "could not set kaninabe.scanWords"
[ -z "$owner" ] || git -C "$root" config kaninabe.scanOwner "$owner" || die "could not set kaninabe.scanOwner"
[ "$(git -C "$root" config --get core.hooksPath)" = .githooks ] || die "core.hooksPath is not set"
if [ -z "$(git -C "$root" config --get kaninabe.scanWords || true)" ] && [ -z "${SCAN_WORDS_FILE:-}" ]; then
  echo "setup-dev-env: note: no word list is configured yet; the pre-push hook will stop until you pass --words <file> or set SCAN_WORDS_FILE"
fi
echo "setup-dev-env: ready (hooks: .githooks, gitleaks ${GITLEAKS_VERSION}, actionlint ${ACTIONLINT_VERSION}, tools in $bin_dir)"
