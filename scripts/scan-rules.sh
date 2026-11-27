# Rules shared by scan-public.sh and scan-pr-text.sh (sourced, not run). Every check here fails closed: a pattern
# grep cannot read, or a file it cannot open, stops the scan instead of reading as "no match".
# Nothing here prints a matched line or a word from the list (the logs of a public repository are public).

# Names of AI tools and bots that must never appear as an author, a committer or a co-author.
scan_ai='claude|anthropic|copilot|codex|openai|chatgpt|gemini|cursor|devin|\[bot\]'
# Lines that attribute work to an AI. Any `<word>-by:` trailer naming an AI counts, whatever the word.
scan_attrib="co-?authored|claude-session|generated[[:space:]]+(with|by)|claude\\.ai/code/session_|noreply@anthropic|^[[:space:]]*[a-z-]+-by:.*($scan_ai)"
# The one co-author trailer allowed: the one a squash merge adds for the repository owner's own noreply address
# (owner from $SCAN_OWNER, else the Actions variable GITHUB_REPOSITORY_OWNER; with neither, none is allowed).
scan_owner=${SCAN_OWNER:-${GITHUB_REPOSITORY_OWNER:-}}
# An address is matched WHOLE: a local part, an at sign and a host with at least one dot, as one string (grep -o), and the allowed ones are
# a closed set tested against that whole string (anchored at both ends; nothing is allowed because it STARTS or ENDS like something else):
#   - a host whose last label is `example`, and example.com / example.org / example.net exactly (not their subdomains);
#   - GitHub noreply addresses: [<number>+]<login>@users.noreply.github.com, and git@github.com (the SSH remote);
#   - a host whose last label is only digits (a package version such as pkg@1.2.3, or an IP address).
# The full-width at sign (U+FF20) and the small one (U+FE6B) count as at signs when an address is FOUND, and are never in the allowed set.
# GitHub web-flow committer address is allowed only as the committer identity of a commit (scan_ident_ok), never as text.
scan_at=$(printf '(@|\357\274\240|\357\271\253)')
scan_email="[A-Za-z0-9._%+-]+$scan_at[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+"
scan_email_ok='^([A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+example|[A-Za-z0-9._%+-]+@example\.(com|org|net)|([0-9]+\+)?[A-Za-z0-9_-]+@users\.noreply\.github\.com|git@github\.com|[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[0-9]+)$'
# Author and committer addresses allowed in history: GitHub noreply addresses, and GitHub's own web-flow committer.
# Both ends are anchored, and the pattern is applied to one address per line (an address from %ae / %ce holds no line break): a login is
# letters, digits, '-' and '_' (GitHub's own rule, plus the underscore of managed accounts), after an optional numeric id and '+'.
scan_ident_ok='^(([0-9]+\+)?[A-Za-z0-9_-]+@users\.noreply\.github\.com|noreply@github\.com)$'

# scan_grep ARGS...: grep, but an error (exit 2: bad pattern, unreadable file) is recorded in $scan_err and fails the
# scan at scan_finish. A pipeline runs it in a subshell, where `exit` alone would only end that subshell.
scan_err=$(mktemp)
scan_dir=$(mktemp -d)
# scan_io_failed: a stage file could not be written or read; recorded and stopped like a failed grep.
scan_io_failed() { echo "scan: could not read a result"; echo x >> "$scan_err"; echo "${scan_name:-scan}: ERROR"; exit 2; }
. "$(dirname "$0")/neutral-git.sh"
# scan_cleanup: the cleanup of the ONE EXIT trap of a scan script, `trap 'rc=$?; scan_cleanup; guard_exit "$rc"' EXIT` (a second trap
# on EXIT replaces the first, so it would drop guard_exit or part of the cleanup). Names a script has not set yet are empty.
scan_cleanup() {
  for sc_f in "${scan_dir:-}" "${pat:-}" "${scoped:-}" "${commits:-}" "${gg_out:-}" "${ng_work:-}" "${scan_err:-}"; do
    [ -z "$sc_f" ] || rm -rf "$sc_f" "$sc_f".*
  done
}
grep_failed() { echo "scan: grep failed (exit $1): an invalid pattern or an unreadable input"; echo x >> "$scan_err"; echo "${scan_name:-scan}: ERROR"; exit 2; }
scan_grep() { grep_q "$@"; }
# scan_filter <in> <out> <grep arguments...>: the lines of <in> that grep selects, into <out>; "no line" (status 1) is a result, a failed
# grep stops the scan (see scan_grep). Used instead of a pipe, so that no stage can fail unseen.
# The output is created first (a redirect that fails would give status 1 in one shell and 2 in another, and 1 is "no line"): once it
# exists the redirect cannot fail, and the input is read by grep itself, whose failure is status 2 (scan_grep stops the scan).
scan_filter() {
  sf_in=$1; sf_out=$2; shift 2
  : > "$sf_out" || scan_io_failed
  scan_grep "$@" "$sf_in" > "$sf_out" || [ $? = 1 ]
}
# scan_input_ok <file>: the input of a scan function is a path, not a redirect on the call (a redirect that fails before the function
# runs would read as "no finding" in an `if`): it must be a readable file, or the scan stops.
scan_input_ok() { [ -f "$1" ] && [ -r "$1" ] || scan_io_failed; }

# scan_finish NAME FAIL: the one exit of a scan. A recorded grep error wins over a clean result.
scan_finish() {
  if [ -s "$scan_err" ]; then rm -f "$scan_err"; echo "$1: ERROR"; exit 2; fi
  rm -f "$scan_err"
  [ "$2" -eq 0 ] && echo "$1: clean" || { echo "$1: FAILED"; verdict_exit=1; exit 1; }
}

# scan_check_patterns FILE: every line must be a valid extended regex.
scan_check_patterns() {
  [ -s "$1" ] || return 0
  scan_grep -qE -f "$1" /dev/null || [ $? = 1 ]
}

# scan_attribution <file>: reads the text in <file>; succeeds (and so means "found") when an attribution line is present
# other than the owner's own co-author trailer.
scan_attribution() {
  # (every stage is a file in $scan_dir with its status checked: no pipe)
  scan_input_ok "$1"
  scan_filter "$1" "$scan_dir/attr.1" -iE "$scan_attrib"
  [ -s "$scan_dir/attr.1" ] || return 1
  if [ -n "$scan_owner" ]; then
    ok="^co-authored-by: [^<@]*<([0-9]+\\+)?$scan_owner@users\\.noreply\\.github\\.com>\$"
    scan_filter "$scan_dir/attr.1" "$scan_dir/attr.2" -viE "$ok"
    if scan_grep -q . "$scan_dir/attr.2"; then return 0; fi
    scan_filter "$1" "$scan_dir/attr.3" -iE '^co-authored-by:'
    if scan_grep -qiE "$scan_ai" "$scan_dir/attr.3"; then return 0; fi
    return 1
  fi
  return 0
}

# scan_bad_email <file>: reads the text in <file>; succeeds when an email-like string outside the allowed shapes is present.
scan_bad_email() {
  scan_input_ok "$1"
  scan_filter "$1" "$scan_dir/mail.1" -oE "$scan_email"
  scan_filter "$scan_dir/mail.1" "$scan_dir/mail.2" -vE "$scan_email_ok"
  scan_grep -q . "$scan_dir/mail.2"
}

# SHA-256 in awk (the entries of a `mail` kind in scan-exclusions.tsv are `sha256:<hex>` of the exact string, and the tools of the gate are
# only the ones every system has: no sha256sum is assumed). Functions and BEGIN only; a caller adds the main rule. Checked against the
# standard test strings in tests; strings are bytes (run it with LC_ALL=C), at most a few hundred at a time.
scan_sha_awk='
function nib(op, a, b,    r, i, p) {
  r = 0; p = 1
  for (i = 0; i < 8; i++) { r += T[op, a % 16, b % 16] * p; a = int(a / 16); b = int(b / 16); p *= 16 }
  return r
}
function xor(a, b) { return nib(1, a, b) }
function and(a, b) { return nib(2, a, b) }
function rotr(x, n) { return int(x / P[n]) + (x % P[n]) * P[32 - n] }
function shr(x, n) { return int(x / P[n]) }
function sha256(s,    n, i, j, m, len, k, h0, h1, h2, h3, h4, h5, h6, h7, a, b, c, d, e, f, g, h, t1, t2, w, s0, s1, bits) {
  n = length(s)
  for (i = 0; i < n; i++) m[i] = O[substr(s, i + 1, 1)]
  len = n; m[len++] = 128
  while (len % 64 != 56) m[len++] = 0
  bits = n * 8
  for (i = 7; i >= 0; i--) { m[len + i] = bits % 256; bits = int(bits / 256) }
  len += 8
  h0 = H0[0]; h1 = H0[1]; h2 = H0[2]; h3 = H0[3]; h4 = H0[4]; h5 = H0[5]; h6 = H0[6]; h7 = H0[7]
  for (k = 0; k < len; k += 64) {
    for (j = 0; j < 16; j++) w[j] = ((m[k + 4*j] * 256 + m[k + 4*j + 1]) * 256 + m[k + 4*j + 2]) * 256 + m[k + 4*j + 3]
    for (j = 16; j < 64; j++) {
      s0 = xor(xor(rotr(w[j-15], 7), rotr(w[j-15], 18)), shr(w[j-15], 3))
      s1 = xor(xor(rotr(w[j-2], 17), rotr(w[j-2], 19)), shr(w[j-2], 10))
      w[j] = (w[j-16] + s0 + w[j-7] + s1) % 4294967296
    }
    a = h0; b = h1; c = h2; d = h3; e = h4; f = h5; g = h6; h = h7
    for (j = 0; j < 64; j++) {
      s1 = xor(xor(rotr(e, 6), rotr(e, 11)), rotr(e, 25))
      t1 = (h + s1 + xor(and(e, f), and(4294967295 - e, g)) + K[j] + w[j]) % 4294967296
      s0 = xor(xor(rotr(a, 2), rotr(a, 13)), rotr(a, 22))
      t2 = (s0 + xor(xor(and(a, b), and(a, c)), and(b, c))) % 4294967296
      h = g; g = f; f = e; e = (d + t1) % 4294967296; d = c; c = b; b = a; a = (t1 + t2) % 4294967296
    }
    h0 = (h0 + a) % 4294967296; h1 = (h1 + b) % 4294967296; h2 = (h2 + c) % 4294967296; h3 = (h3 + d) % 4294967296
    h4 = (h4 + e) % 4294967296; h5 = (h5 + f) % 4294967296; h6 = (h6 + g) % 4294967296; h7 = (h7 + h) % 4294967296
  }
  return sprintf("%08x%08x%08x%08x%08x%08x%08x%08x", h0, h1, h2, h3, h4, h5, h6, h7)
}
BEGIN {
  for (a = 0; a < 16; a++) for (b = 0; b < 16; b++) {
    x = 0; y = 0; p = 1; u = a; v = b
    for (i = 0; i < 4; i++) { if ((u % 2) != (v % 2)) x += p; if ((u % 2) && (v % 2)) y += p; u = int(u / 2); v = int(v / 2); p *= 2 }
    T[1, a, b] = x; T[2, a, b] = y
  }
  P[0] = 1; for (i = 1; i <= 32; i++) P[i] = P[i - 1] * 2
  for (i = 1; i < 256; i++) O[sprintf("%c", i)] = i
  split("1116352408 1899447441 3049323471 3921009573 961987163 1508970993 2453635748 2870763221 3624381080 310598401 607225278 1426881987 1925078388 2162078206 2614888103 3248222580 3835390401 4022224774 264347078 604807628 770255983 1249150122 1555081692 1996064986 2554220882 2821834349 2952996808 3210313671 3336571891 3584528711 113926993 338241895 666307205 773529912 1294757372 1396182291 1695183700 1986661051 2177026350 2456956037 2730485921 2820302411 3259730800 3345764771 3516065817 3600352804 4094571909 275423344 430227734 506948616 659060556 883997877 958139571 1322822218 1537002063 1747873779 1955562222 2024104815 2227730452 2361852424 2428436474 2756734187 3204031479 3329325298", kk, " ")
  for (i = 1; i <= 64; i++) K[i - 1] = kk[i] + 0
  split("1779033703 3144134277 1013904242 2773480762 1359893119 2600822924 528734635 1541459225", hh, " ")
  for (i = 1; i <= 8; i++) H0[i - 1] = hh[i] + 0
}
'
# mail_allowed <commit>: sets $ma_n to the number of address hits (after the allowed set) that `mail` entries of the list allow at their
# paths in <commit>: for each listed path that is a regular blob in the commit, the hits in that one file are counted by distinct string,
# and a string counts when the list has a `mail` line for that path with exactly its sha256. The list is $scan_dir/excl.mail (`path TAB
# sha256:<hex>` per line). Returns 1 if a step cannot be done (the caller stops).
mail_allowed() {
  ma_n=0
  LC_ALL=C awk -F'\t' '{ print $1 }' "$scan_dir/excl.mail" > "$scan_dir/ma.paths.a" || return 1
  LC_ALL=C sort -u "$scan_dir/ma.paths.a" > "$scan_dir/ma.paths" || return 1
  wc_lines "$scan_dir/ma.paths" || return 1; ma_expect=$wc_v; ma_seen=0
  while IFS= read -r ma_p; do
    ma_seen=$((ma_seen + 1))
    ma_id=$(neutral_git rev-parse --verify -q "$1:$ma_p" 2>/dev/null) || continue
    [ "$(neutral_git cat-file -t "$ma_id" 2>/dev/null)" = blob ] || continue
    ma_rc=0; neutral_git grep -IhoE "$scan_email" "$1" -- ":(literal)$ma_p" > "$scan_dir/ma.hits" 2>/dev/null || ma_rc=$?
    case $ma_rc in 0 | 1) ;; *) return 1 ;; esac
    sed 's/^[^:]*://' "$scan_dir/ma.hits" > "$scan_dir/ma.hits.s" || return 1
    scan_filter "$scan_dir/ma.hits.s" "$scan_dir/ma.red" -vE "$scan_email_ok"
    LC_ALL=C awk "$scan_sha_awk"'{ c[$0]++ } END { for (s in c) print "sha256:" sha256(s) "\t" c[s] }' "$scan_dir/ma.red" > "$scan_dir/ma.hashed" || return 1
    ma_k=$(P=$ma_p LC_ALL=C awk -F'\t' 'FILENAME == ARGV[1] { if ($1 == ENVIRON["P"]) ok[$2] = 1; next } ($1 in ok) { n += $2 } END { print n + 0 }' "$scan_dir/excl.mail" "$scan_dir/ma.hashed") || return 1
    case $ma_k in '' | *[!0-9]*) return 1 ;; esac
    ma_n=$((ma_n + ma_k))
  done < "$scan_dir/ma.paths"
  [ "$ma_seen" = "$ma_expect" ] || return 1
}
