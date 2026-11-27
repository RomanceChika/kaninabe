/**
 * WIRING tests of the push-before gate: scripts/push-gate.sh, scripts/push-range.sh, .githooks/pre-push and
 * scripts/setup-dev-env.sh, with FAKE gitleaks and actionlint on PATH. They show that the scripts ask the tools the
 * right questions in the right order, stop for the stated reason, and print only what may be printed. They cannot show
 * that a real scanner finds anything: that is the job of push-gate-verdict.test.mjs (real tools, real verdicts).
 *
 * The gate stops for the stated reason (the tests read the reason line, not just the exit code); a scan that cannot
 * run is never a pass; every commit of the range is scanned, the intermediate ones too; the output never repeats a
 * matched word. The hook refuses anything but the checked-out commit, every tag push, wants the content review record
 * to name the pushed commit, asks the destination which commits it has, and always runs the gate in words mode. The
 * setup script refuses a download whose checksum is not the pinned one.
 *
 * Each test builds a throwaway git repository under a temp dir, with a PATH that holds a short list of ordinary tools
 * and fake `gitleaks` / `actionlint` whose behaviour the test controls (exit 1 = the gate found something; exit 2 = it
 * could not run a step). The only word used in word lists is invented and harmless. (One file: the import fence lets
 * tests import only node: built-ins and scripts/ or bin/.)
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- harness ----

const WORD = 'zzgatewordzz';
const ZERO = '0'.repeat(40);
const scripts = fileURLToPath(new URL('../../scripts/', import.meta.url));
const gate = path.join(scripts, 'push-gate.sh');
const hook = fileURLToPath(new URL('../../.githooks/pre-push', import.meta.url));
const setupScript = path.join(scripts, 'setup-dev-env.sh');

/** Ordinary tools the scripts may call. Anything not found on this machine is skipped. */
const CORE = [
  'sh', 'git', 'grep', 'egrep', 'sed', 'cut', 'wc', 'tr', 'head', 'tail', 'mktemp', 'rm', 'cat', 'dirname', 'basename',
  'tar', 'awk', 'sort', 'uniq', 'mkdir', 'ls', 'find', 'xargs', 'id', 'env', 'true', 'false', 'cp', 'mv', 'date',
  'printf', 'echo', 'test', 'expr', 'sha256sum', 'curl', 'uname', 'install', 'chmod', 'od', 'tee', 'less', 'gzip',
];

// The gate runs its tools with an explicit environment (env -i), so a shim cannot be steered by environment variables:
// it reads what the test wants (where to log, which exit code, what to print) from shim.env, next to it in the bin dir.
// What it logs after `#env:` shows the config variables that reached it (none, when the gate does its job).
const SHIM_BODY = (name, exitVar) => `#!/bin/sh
. "$(dirname "$0")/shim.env"
printf '%s\\n' "${name} $* #env:\${GITLEAKS_CONFIG-unset}:\${GITLEAKS_CONFIG_TOML-unset}" >> "$SHIM_LOG"
[ -z "\${SHIM_OUT_${name}:-}" ] || printf '%s' "\${SHIM_OUT_${name}}"
if [ "${name}" = gitleaks ]; then
  [ -z "\${SHIM_STDERR_gitleaks:-}" ] || printf '%b\\n' "\${SHIM_STDERR_gitleaks}" >&2
  # the stdin of a run that has a report path (the batches of commit texts) is appended to a file for the test to read
  if [ "$1" = stdin ] && [ -n "\${SHIM_STDIN_DUMP:-}" ]; then case "$*" in *--report-path*) cat >> "$SHIM_STDIN_DUMP" ;; esac; fi
  # a history run (gitleaks git) says how many commits it scanned, as the real tool does at info level; SHIM_SCANNED sets the
  # number ("none" prints no such line)
  if [ "$1" = git ] && [ "\${SHIM_SCANNED:-1}" != none ]; then printf '%s\\n' "6:02PM INF \${SHIM_SCANNED:-1} commits scanned." >&2; fi
fi
if [ -n "\${SHIM_REPORT_${name}:-}" ]; then prev=; for a in "$@"; do [ "$prev" != --report-path ] || printf '%s' "\${SHIM_REPORT_${name}}" > "$a"; prev=$a; done; fi
exit "\${${exitVar}:-0}"
`;
/** What one gitleaks finding looks like in the gate's report template: a line with an x, nothing from the tool's own text. */
const HIT = 'x\n';
const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

function which(name) {
  // Look in the system directories only: a wrapper earlier on the developer's PATH is not the tool.
  const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin:/usr/local/bin' } });
  const p = r.stdout.trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
}

/** Creates a sandbox: a temp dir, a `bin` with the core tools and the chosen shims, an empty repository. */
function sandbox({ gitleaks = true, actionlint = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'push-gate-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  for (const name of CORE) {
    const p = which(name);
    if (p) symlinkSync(p, path.join(bin, name));
  }
  const add = (name, exitVar) => {
    writeFileSync(path.join(bin, name), SHIM_BODY(name, exitVar));
    chmodSync(path.join(bin, name), 0o755);
  };
  if (gitleaks) add('gitleaks', 'SHIM_GITLEAKS_EXIT');
  if (actionlint) add('actionlint', 'SHIM_ACTIONLINT_EXIT');
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  const sb = {
    dir,
    bin,
    repo,
    log: path.join(dir, 'shim.log'),
    words: path.join(dir, 'words.txt'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    /** What the shims were called with, one line per call. */
    calls: () => (existsSync(sb.log) ? readFileSync(sb.log, 'utf8').split('\n').filter(Boolean) : []),
    env: (extra = {}) => {
      // SHIM_* settings go to shim.env (see SHIM_BODY); everything else is the environment of the process under test.
      const shim = { SHIM_LOG: sb.log };
      const rest = {};
      for (const [k, v] of Object.entries(extra)) (k.startsWith('SHIM_') ? shim : rest)[k] = v;
      writeFileSync(path.join(bin, 'shim.env'), Object.entries(shim).map(([k, v]) => `${k}=${shq(v)}\n`).join(''));
      return {
        PATH: bin,
        HOME: path.join(dir, 'home'),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        LC_ALL: 'C',
        ...rest,
      };
    },
  };
  git(sb, 'init', '-q', '-b', 'main');
  return sb;
}

/** Writes a word list holding the invented word (and optionally more lines). */
function writeWords(sb, text = `${WORD}\n`) {
  writeFileSync(sb.words, text);
  return sb.words;
}

/** Runs git in the sandbox repository (or `cwd`) with a fixed noreply identity; returns trimmed stdout. */
function git(sb, ...args) {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: sb.cwd ?? sb.repo, encoding: 'utf8', env: { ...process.env, ...sb.env() , PATH: process.env.PATH } },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Writes `files` ({path: text}) and commits them with `message`; returns the new commit sha. */
function commit(sb, files, message = 'change') {
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(sb.repo, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    git(sb, 'add', name);
  }
  git(sb, 'commit', '-q', '-m', message);
  return git(sb, 'rev-parse', 'HEAD');
}

/** Removes `name` and commits. */
function removeFile(sb, name, message = 'remove') {
  git(sb, 'rm', '-q', name);
  git(sb, 'commit', '-q', '-m', message);
  return git(sb, 'rev-parse', 'HEAD');
}

/** Makes a bare repository, adds it as `name`, and pushes `main` to it so the remote-tracking ref exists. */
function addRemote(sb, name = 'origin') {
  const bare = path.join(sb.dir, `${name}.git`);
  git({ ...sb, cwd: sb.dir }, 'init', '-q', '--bare', bare);
  git(sb, 'remote', 'add', name, bare);
  return bare;
}

/** Runs the gate script in the sandbox repository. `env` adds to the sandbox environment. */
function runGate(sb, args, env = {}) {
  const r = spawnSync('/bin/sh', [gate, ...args], { cwd: sb.repo, encoding: 'utf8', env: sb.env(env) });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** Runs the pre-push hook as git does: `<remote> <url>` as arguments and the ref lines on stdin. */
function runHook(sb, { remote = 'origin', lines = [], env = {}, url, noFinalNewline = false } = {}) {
  const input = noFinalNewline ? lines.join('\n') : lines.map((l) => `${l}\n`).join('');
  // Git passes the URL it pushes to; by default, the remote's own URL when there is one.
  const own = spawnSync('git', ['remote', 'get-url', remote], { cwd: sb.repo, encoding: 'utf8' });
  const r = spawnSync('/bin/sh', [hook, remote, url ?? (own.status === 0 ? own.stdout.trim() : 'unused-url')], { cwd: sb.repo, encoding: 'utf8', env: sb.env(env), input });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** One stdin line of the hook for pushing `sha` to `refs/heads/main`. */
const pushLine = (sha, remoteSha = ZERO) => `refs/heads/main ${sha} refs/heads/main ${remoteSha}`;


// ---- the gate ----

/** The output of a result of runGate / runHook (`out`) or of spawnSync (`stdout` + `stderr`) must hold the fixed reason of the failure under test. */
function said(r, reason) {
  const out = r.out ?? `${r.stdout}${r.stderr}`;
  assert.ok(out.includes(reason), `expected "${reason}" in: ${out}`);
}

{
let sb;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

/** Asserts that the gate stopped with `status` and that the output holds `reason`. */
function stops(r, status, reason) {
  assert.equal(r.status, status, r.out);
  assert.ok(r.out.includes(reason), `expected "${reason}" in: ${r.out}`);
  assert.ok(!r.out.includes('push-gate: passed'), r.out);
}

describe('push-gate.sh: arguments and mode', () => {
  beforeEach(() => commit(sb, { 'a.txt': 'one\n' }));

  it('has no default mode: a missing or unknown mode is an error', () => {
    stops(runGate(sb, ['--all']), 2, 'push-gate: --mode is required (words or general)');
    stops(runGate(sb, ['--mode', 'strict', '--all']), 2, 'push-gate: unknown mode "strict" (words or general)');
    stops(runGate(sb, ['--mode', '', '--all']), 2, 'push-gate: unknown mode "" (words or general)');
    stops(runGate(sb, ['--mode']), 2, 'push-gate: --mode needs a value');
    assert.deepEqual(sb.calls(), []);
  });

  it('needs exactly one way to say which commits', () => {
    const reason = 'push-gate: exactly one of --base, --not-on, --all is required';
    stops(runGate(sb, ['--mode', 'general']), 2, reason);
    stops(runGate(sb, ['--mode', 'general', '--all', '--base', 'HEAD']), 2, reason);
    stops(runGate(sb, ['--mode', 'general', '--base']), 2, 'push-gate: --base needs a value');
    stops(runGate(sb, ['--mode', 'general', '--nonsense']), 2, 'push-gate: unknown argument');
    assert.deepEqual(sb.calls(), []);
  });

  it('refuses a base that is not a commit and --not-on values that are not commit ids', () => {
    stops(runGate(sb, ['--mode', 'general', '--base', 'no-such-ref']), 2, 'push-gate: --base is not a commit of this repository');
    const need = 'push-gate: --not-on needs full commit ids, comma separated';
    stops(runGate(sb, ['--mode', 'general', '--not-on', 'HEAD']), 2, need);
    stops(runGate(sb, ['--mode', 'general', '--not-on', '']), 2, need);
    stops(runGate(sb, ['--mode', 'general', '--not-on', 'abc123']), 2, need);
    stops(runGate(sb, ['--mode', 'general', '--not-on', `${'a'.repeat(40)},`]), 2, need);
    stops(runGate(sb, ['--mode', 'general', '--not-on', 'a'.repeat(40)]), 2, 'push-gate: --not-on is not a commit of this repository');
    stops(runGate(sb, ['--mode', 'general', '--not-on-remote', 'origin']), 2, 'push-gate: unknown argument');
  });
});

describe('push-gate.sh: the word list', () => {
  const reason = 'push-gate: words mode needs the word list (SCAN_WORDS_FILE is unset, empty or unreadable)';
  beforeEach(() => commit(sb, { 'a.txt': 'one\n' }));

  it('words mode stops without a usable list: unset, empty, missing or unreadable', () => {
    stops(runGate(sb, ['--mode', 'words', '--all']), 2, reason);
    writeFileSync(sb.words, '');
    stops(runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.words }), 2, reason);
    stops(runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: path.join(sb.dir, 'absent.txt') }), 2, reason);
    stops(runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.dir }), 2, reason);
    assert.deepEqual(sb.calls(), [], 'no scanner runs before the list is known to be usable');
  });

  it('words mode with a list runs and passes on a clean history', () => {
    writeWords(sb);
    const r = runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.words });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: passed (mode words, 1 commit(s))'), r.out);
  });

  it('general mode runs without a list, and does not read one even if it is set', () => {
    let r = runGate(sb, ['--mode', 'general', '--all']);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: passed (mode general, 1 commit(s))'), r.out);
    commit(sb, { 'b.txt': `${WORD}\n` });
    writeWords(sb);
    r = runGate(sb, ['--mode', 'general', '--all'], { SCAN_WORDS_FILE: sb.words });
    assert.equal(r.status, 0, `general mode must not read the list: ${r.out}`);
    r = runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.words });
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step scan-public: FAILED'), r.out);
  });

  it('general mode is not stopped by a broken list it must not read', () => {
    writeWords(sb, '(\n');
    const r = runGate(sb, ['--mode', 'general', '--all'], { SCAN_WORDS_FILE: sb.words });
    assert.equal(r.status, 0, r.out);
  });
});

describe('push-gate.sh: the tools fail closed', () => {
  beforeEach(() => {
    commit(sb, { 'a.txt': 'one\n' });
    writeWords(sb);
  });
  const words = () => ({ SCAN_WORDS_FILE: sb.words });

  it('stops when gitleaks is not on PATH, in both modes', () => {
    sb.cleanup();
    sb = sandbox({ gitleaks: false });
    commit(sb, { 'a.txt': 'one\n' });
    writeWords(sb);
    stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: gitleaks is not on PATH');
    stops(runGate(sb, ['--mode', 'words', '--all'], words()), 2, 'push-gate: gitleaks is not on PATH');
    assert.deepEqual(sb.calls(), []);
  });

  it('stops when actionlint is not on PATH, in both modes, and before any scan', () => {
    sb.cleanup();
    sb = sandbox({ actionlint: false });
    commit(sb, { 'a.txt': 'one\n' });
    writeWords(sb);
    stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: actionlint is not on PATH');
    stops(runGate(sb, ['--mode', 'words', '--all'], words()), 2, 'push-gate: actionlint is not on PATH');
    assert.deepEqual(sb.calls(), [], 'gitleaks must not run when the gate cannot finish');
  });

  it('gitleaks reporting a finding fails the gate; gitleaks erroring stops it', () => {
    let r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99', SHIM_REPORT_gitleaks: HIT });
    stops(r, 1, 'push-gate: step gitleaks: FAILED');
    r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '3' });
    stops(r, 2, 'push-gate: step gitleaks could not run (exit 3)');
    r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '1' });
    stops(r, 2, 'push-gate: step gitleaks could not run (exit 1)');
  });

  it('runs gitleaks over the commits in range, redacted, without a banner', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 0, r.out);
    const call = sb.calls().find((l) => l.startsWith('gitleaks git'));
    assert.ok(call, sb.calls().join('\n'));
    assert.ok(call.includes('--no-banner') && call.includes('--redact'), call);
  });

  it('actionlint reporting a problem fails the gate; actionlint erroring stops it', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    let r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_ACTIONLINT_EXIT: '1', SHIM_OUT_actionlint: '.github/workflows/ci.yml:3: [syntax-check]|' });
    stops(r, 1, 'push-gate: step workflows: FAILED');
    r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_ACTIONLINT_EXIT: '3' });
    stops(r, 2, 'push-gate: step workflows could not run (exit 3)');
  });

  it('a word-scan that errors (a pattern grep cannot read) stops the gate instead of reading as clean', () => {
    writeWords(sb, '(\n');
    stops(runGate(sb, ['--mode', 'words', '--all'], words()), 2, 'push-gate: step scan-public could not run (exit 2)');
  });

  it('a failing step does not hide the others: every step runs and all failures are named', () => {
    commit(sb, { 'b.txt': `${WORD}\n` });
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99', SHIM_REPORT_gitleaks: HIT });
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: FAILED (gitleaks, scan-public)'), r.out);
  });
});

describe('push-gate.sh: which commits are scanned', () => {
  const words = () => ({ SCAN_WORDS_FILE: sb.words });
  beforeEach(() => writeWords(sb));

  it('catches a word added in one commit and removed in a later commit of the range', () => {
    const base = commit(sb, { 'a.txt': 'one\n' });
    commit(sb, { 'notes.txt': `${WORD}\n` }, 'add notes');
    removeFile(sb, 'notes.txt', 'drop notes');
    const r = runGate(sb, ['--mode', 'words', '--base', base], words());
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step scan-public: FAILED'), r.out);
    assert.ok(r.out.includes('at notes.txt:1'), `the report names the place: ${r.out}`);
    assert.ok(r.out.includes('2 commit(s)'), r.out);
    assert.equal(runGate(sb, ['--mode', 'words', '--all'], words()).status, 1);
  });

  it('--base scans only what follows the base; --all scans everything', () => {
    commit(sb, { 'notes.txt': `${WORD}\n` });
    removeFile(sb, 'notes.txt');
    const base = commit(sb, { 'a.txt': 'one\n' });
    commit(sb, { 'b.txt': 'two\n' });
    let r = runGate(sb, ['--mode', 'words', '--base', base], words());
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('(mode words, 1 commit(s))'), r.out);
    r = runGate(sb, ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('4 commit(s)'), r.out);
  });

  it('--not-on leaves out every commit reachable from the given commits, and nothing else', () => {
    const first = commit(sb, { 'notes.txt': `${WORD}\n` });
    const second = removeFile(sb, 'notes.txt');
    commit(sb, { 'b.txt': 'two\n' });
    let r = runGate(sb, ['--mode', 'words', '--not-on', first], words());
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('(mode words, 2 commit(s))'), r.out);
    r = runGate(sb, ['--mode', 'words', '--not-on', `${first},${second}`], words());
    assert.ok(r.out.includes('(mode words, 1 commit(s))'), r.out);
    const other = commit(sb, { 'c.txt': 'three\n' });
    r = runGate(sb, ['--mode', 'words', '--not-on', other], words());
    assert.ok(r.out.includes('(mode words, 0 commit(s))'), r.out);
  });

  it('there is no way left to subtract what only a remote-tracking ref says a remote has', () => {
    commit(sb, { 'notes.txt': `${WORD}\n` });
    addRemote(sb);
    git(sb, 'update-ref', 'refs/remotes/origin/main', git(sb, 'rev-parse', 'HEAD'));
    commit(sb, { 'b.txt': 'two\n' });
    const r = runGate(sb, ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('2 commit(s)'), r.out);
  });

  it('an empty range passes the scans, but the workflow check still runs', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    const r = runGate(sb, ['--mode', 'words', '--base', 'HEAD'], words());
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('(mode words, 0 commit(s))'), r.out);
    const calls = sb.calls();
    assert.equal(calls.filter((l) => l.startsWith('gitleaks git')).length, 1, 'only the tree of HEAD is scanned for secrets');
    assert.ok(!calls.some((l) => l.startsWith('gitleaks stdin')), 'no commit text to scan');
    assert.ok(calls.some((l) => l.startsWith('actionlint')), 'the workflows are still checked');
    const bad = runGate(sb, ['--mode', 'words', '--base', 'HEAD'], { ...words(), SHIM_ACTIONLINT_EXIT: '1', SHIM_OUT_actionlint: '.github/workflows/ci.yml:3: [syntax-check]|' });
    stops(bad, 1, 'push-gate: step workflows: FAILED');
  });

  it('scans the commit message and author, not only the files', () => {
    commit(sb, { 'a.txt': 'one\n' }, `notes about ${WORD}`);
    const r = runGate(sb, ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('commit message or author of'), r.out);
  });
});

describe('push-gate.sh: the workflow check', () => {
  it('checks the committed workflow files with actionlint, without shellcheck or pyflakes', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n', '.github/workflows/other.yaml': 'name: y\n', 'a.txt': 'one\n' });
    const r = runGate(sb, ['--mode', 'general', '--all']);
    assert.equal(r.status, 0, r.out);
    const call = sb.calls().find((l) => l.startsWith('actionlint'));
    assert.ok(call, sb.calls().join('\n'));
    assert.ok(call.includes('-shellcheck=') && call.includes('-pyflakes='), call);
    assert.ok(call.includes('.github/workflows/ci.yml') && call.includes('.github/workflows/other.yaml'), call);
    assert.ok(r.out.includes('2 file(s)'), r.out);
  });

  it('passes with a note when there are no workflow files', () => {
    commit(sb, { 'a.txt': 'one\n' });
    const r = runGate(sb, ['--mode', 'general', '--all']);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('no workflow files'), r.out);
  });

  it('reads the committed tree, not an uncommitted edit', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    mkdirSync(path.join(sb.repo, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(sb.repo, '.github/workflows/uncommitted.yml'), 'name: z\n');
    const r = runGate(sb, ['--mode', 'general', '--all']);
    assert.equal(r.status, 0, r.out);
    assert.ok(!sb.calls().some((l) => l.includes('uncommitted.yml')), sb.calls().join('\n'));
  });
});

describe('push-gate.sh: output', () => {
  it('never prints a matched word, whether it is in a file, a message or the list itself', () => {
    writeWords(sb, `# a comment\n${WORD}\n`);
    commit(sb, { 'notes.txt': `line with ${WORD} in it\n` }, `message with ${WORD}`);
    const r = runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.words });
    assert.equal(r.status, 1, r.out);
    assert.ok(!r.out.includes(WORD), `the word leaked into the output: ${r.out}`);
    assert.ok(!r.out.includes('line with'), r.out);
    assert.ok(!r.out.includes(sb.words), 'the list path is not printed either');
  });

  it('does not trace its commands', () => {
    commit(sb, { 'a.txt': 'one\n' });
    writeWords(sb);
    const r = runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.words });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: passed'), r.out);
    assert.ok(!/^\+ /m.test(r.out), r.out);
  });
});

describe('push-gate.sh: review round 1 (what gitleaks reads, quiet logs, failures of listing)', () => {
  const words = () => ({ SCAN_WORDS_FILE: sb.words });
  const scanPublic = path.join(scripts, 'scan-public.sh');
  beforeEach(() => {
    commit(sb, { 'a.txt': 'one\n' });
    commit(sb, { 'b.txt': 'two\n' });
    writeWords(sb);
  });

  it('words mode: a list that holds only comments and blank lines did not run, so the gate stops', () => {
    writeWords(sb, '# only a comment\n\n# another\n');
    stops(runGate(sb, ['--mode', 'words', '--all'], words()), 2, 'push-gate: the word list has no pattern (only comments and blank lines)');
    assert.deepEqual(sb.calls(), []);
  });

  it('runs gitleaks git once per listed commit, each with that commit only (ids, never names), plus the texts of the commits (one batch) and the tree of HEAD', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 0, r.out);
    const calls = sb.calls();
    const ids = git(sb, 'rev-list', 'HEAD').split('\n');
    const histories = calls.filter((l) => l.startsWith('gitleaks git'));
    // one run per commit of the list, and one more for the tree of HEAD (read as a synthetic root commit, never by `gitleaks dir`)
    assert.equal(histories.length, ids.length + 1, calls.join('\n'));
    for (const id of ids) {
      assert.equal(histories.filter((l) => l.includes(`--log-opts=-1 -m ${id} `)).length, 1, `no run for ${id}: ${histories.join('\n')}`);
    }
    assert.equal(calls.filter((l) => l.startsWith('gitleaks stdin')).length, 1, 'one batch for the texts of all the commits');
    assert.equal(calls.filter((l) => l.startsWith('gitleaks dir')).length, 0, `the tree is read like a commit, not by gitleaks dir: ${calls.join('\n')}`);
  });

  it('only the commits of the range are read: not a commit before --base', () => {
    const before = git(sb, 'rev-parse', 'HEAD');
    commit(sb, { 'k.txt': 'newline\n' });
    const r = runGate(sb, ['--mode', 'words', '--base', before], words());
    assert.equal(r.status, 0, r.out);
    const histories = sb.calls().filter((l) => l.startsWith('gitleaks git'));
    assert.equal(histories.length, 2, `one run for the commit of the range and one for the tree of HEAD: ${histories.join('\n')}`);
    assert.equal(histories.filter((l) => l.includes(`-m ${git(sb, 'rev-parse', 'HEAD')} `)).length, 1, histories.join('\n'));
    assert.equal(histories.filter((l) => l.includes(before)).length, 0, histories.join('\n'));
  });

  it('prints the wall time of each step and the total in whole seconds, as numbers only (review round 12, C1a)', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    const r = runGate(sb, ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 0, r.out);
    for (const re of [
      /^push-gate: step gitleaks: ok \(\d+ commit\(s\)\) in \d+ s$/m,
      /^push-gate: step scan-public: ok \(\d+ commit\(s\)\) in \d+ s$/m,
      /^push-gate: step workflows: ok \(\d+ file\(s\)\) in \d+ s$/m,
      /^push-gate: passed \(mode words, \d+ commit\(s\)\) in \d+ s$/m,
    ]) assert.ok(re.test(r.out), `${re}: ${r.out}`);
    const bad = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99', SHIM_REPORT_gitleaks: HIT, CI: 'true' });
    assert.ok(/^push-gate: step gitleaks: FAILED \(.*\) in \d+ s$/m.test(bad.out), bad.out);
    assert.ok(/^push-gate: FAILED \(gitleaks\) in \d+ s$/m.test(bad.out), bad.out);
  });

  describe('the text of each commit (names, emails, message) is scanned in batches of at most 64 KiB (review round 13, Q1, B1)', () => {
        /** The bytes of the text of one commit as the gate reads it: the raw commit object. */
    const textBytes = (rev = 'HEAD') => spawnSync('git', ['cat-file', 'commit', rev], { cwd: sb.repo, env: sb.env() }).stdout.length;
    /** An empty commit whose text is exactly `size` bytes (padding in the message). */
    const commitOfSize = (size) => {
      const f = path.join(sb.dir, 'msg.txt');
      writeFileSync(f, 'p\n');
      git(sb, 'commit', '-q', '--allow-empty', '-F', f);
      const overhead = textBytes() - 2;
      writeFileSync(f, `${'m'.repeat(size - overhead - 1)}\n`);
      git(sb, 'commit', '-q', '--allow-empty', '--amend', '-F', f);
      assert.equal(textBytes(), size, 'the text has the size the test asked for');
    };
    const stdinRuns = () => sb.calls().filter((l) => l.startsWith('gitleaks stdin'));
    const base = () => git(sb, 'rev-parse', 'HEAD');

    it('small commits are one batch: one gitleaks stdin for all of them', () => {
      commit(sb, { 'c.txt': 'x\n' });
      const r = runGate(sb, ['--mode', 'words', '--all'], words());
      assert.equal(r.status, 0, r.out);
      assert.equal(stdinRuns().length, 1, sb.calls().join('\n'));
    });

    it('texts are put together while the batch stays at or under 64 KiB, and a new batch starts otherwise', () => {
      const first = base();
      for (let i = 0; i < 5; i += 1) commitOfSize(30000);
      const r = runGate(sb, ['--mode', 'words', '--base', first], words());
      assert.equal(r.status, 0, r.out);
      assert.equal(stdinRuns().length, 3, `5 texts of 30000 bytes are 2 + 2 + 1: ${sb.calls().join('\n')}`);
    });

    it('a batch exactly at the bound (each text counted with its separator byte) is one batch; one byte more starts another', () => {
      const first = base();
      commitOfSize(32767); commitOfSize(32767);
      assert.equal(runGate(sb, ['--mode', 'words', '--base', first], words()).status, 0);
      assert.equal(stdinRuns().length, 1, 'two texts of 32767 bytes and a separator each are exactly 65536');
      const second = base();
      commitOfSize(32767); commitOfSize(32768);
      const calls = stdinRuns().length;
      assert.equal(runGate(sb, ['--mode', 'words', '--base', second], words()).status, 0);
      assert.equal(stdinRuns().length - calls, 2, 'one byte more than the bound is two batches');
    });

    it('a single text that with its separator byte is exactly 64 KiB passes; one byte over stops (2) with a fixed reason, and nothing of it is printed', () => {
      const first = base();
      commitOfSize(65535);
      assert.equal(runGate(sb, ['--mode', 'words', '--base', first], words()).status, 0);
      const second = base();
      commitOfSize(65536);
      const r = runGate(sb, ['--mode', 'words', '--base', second], words());
      stops(r, 2, 'push-gate: step gitleaks could not run (the text of a commit is over 64 KiB)');
      assert.ok(!r.out.includes('mmmmmmmm'), 'the message is not printed');
    });

    it('a finding in a batch is counted, not named: one number for all batches', () => {
      for (let i = 0; i < 3; i += 1) commitOfSize(40000);
      const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99', SHIM_REPORT_gitleaks: 'x\nx\n' });
      assert.equal(r.status, 1, r.out);
      assert.ok(/, (\d+) in commit messages,/.test(r.out) && Number(/, (\d+) in commit messages,/.exec(r.out)[1]) >= 6, r.out);
      assert.ok(!/commit message of/.test(r.out), r.out);
    });
  });

  describe('a grep that fails is "could not run", never "nothing found" (review round 17, V2)', () => {
    const shimGrep = () => {
      rmSync(path.join(sb.bin, 'grep'), { force: true });
      writeFileSync(path.join(sb.bin, 'grep'), `#!/bin/sh\n. "$(dirname "$0")/shim.env"\ncase "$*" in *"\${SHIM_GREP_FAIL:-NEVER-MATCHES-ANYTHING}"*) exit 2 ;; esac\nexec ${which('grep')} "$@"\n`);
      chmodSync(path.join(sb.bin, 'grep'), 0o755);
    };
    it('the word-list check on commit text: scan-public exits 2 (ERROR), and so does the gate', () => {
      shimGrep(); writeWords(sb);
      const r = spawnSync('/bin/sh', [path.join(scripts, 'scan-public.sh')], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ ...words(), SHIM_GREP_FAIL: '-qiE -f' }) });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.ok((r.stdout + r.stderr).includes('scan: grep failed (exit 2)'), r.stdout + r.stderr);
      assert.ok(!(r.stdout + r.stderr).includes('scan-public: clean'), r.stdout + r.stderr);
      stops(runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GREP_FAIL: '-qiE -f' }), 2, 'push-gate: step scan-public could not run (exit 2)');
    });
    it('the check of gitleaks\' log for an error line: the gate and the wrapper exit 2', () => {
      shimGrep();
      stops(runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GREP_FAIL: '(ERR|FTL|PNC)' }), 2, 'push-gate: a search could not run (grep exit 2)');
      const f = path.join(sb.dir, 'plain-gitleaks');
      writeFileSync(f, '#!/bin/sh\n[ "$1" != git ] || echo "6:02PM INF 1 commits scanned." >&2\nexit 0\n');
      chmodSync(f, 0o755);
      for (const mode of ['git', 'dir']) {
        const r = spawnSync('/bin/sh', [path.join(scripts, 'gitleaks-public.sh'), mode, sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: f, SHIM_GREP_FAIL: '(ERR|FTL|PNC)' }) });
        assert.equal(r.status, 2, `${mode}: ${r.stdout + r.stderr}`);
        said(r, `gitleaks ${mode}: could not run (a search failed)`);
        assert.ok(!(r.stdout + r.stderr).includes(`gitleaks ${mode}: ok`), r.stdout + r.stderr);
      }
    });
    it('the check of the workflow file names: the gate exits 2', () => {
      shimGrep();
      commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
      stops(runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GREP_FAIL: '[A-Za-z0-9._/-]+$' }), 2, 'push-gate: a search could not run (grep exit 2)');
    });
  });

  it('the total time of the gate runs from the very start, not from after the range is fixed (review round 17, V3)', () => {
    // a clock that counts the calls of git: the total must be the number of git calls of the whole run
    const count = path.join(sb.dir, 'git-calls.txt');
    const realGit = which('git');
    rmSync(path.join(sb.bin, 'git'), { force: true });
    writeFileSync(path.join(sb.bin, 'git'), `#!/bin/sh\n. "$(dirname "$0")/shim.env"\necho x >> "$SHIM_COUNT"\nexec ${realGit} "$@"\n`);
    chmodSync(path.join(sb.bin, 'git'), 0o755);
    rmSync(path.join(sb.bin, 'date'), { force: true });
    writeFileSync(path.join(sb.bin, 'date'), '#!/bin/sh\n. "$(dirname "$0")/shim.env"\necho $((1000 + $(wc -l < "$SHIM_COUNT")))\n');
    chmodSync(path.join(sb.bin, 'date'), 0o755);
    writeFileSync(count, '');
    const r = runGate(sb, ['--mode', 'general', '--all'], { SHIM_COUNT: count });
    assert.equal(r.status, 0, r.out);
    const total = Number(/^push-gate: passed .* in (\d+) s$/m.exec(r.out)?.[1]);
    const calls = readFileSync(count, 'utf8').split('\n').filter(Boolean).length;
    assert.equal(total, calls, `the total (${total}) is not start to end (${calls} git calls): ${r.out}`);
  });

  describe('the clock is checked once, in one helper (review round 13, Q3)', () => {
    const shimDate = (body) => {
      rmSync(path.join(sb.bin, 'date'), { force: true });
      writeFileSync(path.join(sb.bin, 'date'), `#!/bin/sh\n${body}\n`);
      chmodSync(path.join(sb.bin, 'date'), 0o755);
    };
    for (const [label, body] of [['fails', 'exit 1'], ['prints text that is not a number', 'echo "Mon Jan  1 SECRETTEXT"'], ['prints nothing', 'exit 0']]) {
      it(`a date that ${label} stops the gate (2) with a fixed reason and nothing of its output`, () => {
        shimDate(body);
        const r = runGate(sb, ['--mode', 'words', '--all'], words());
        stops(r, 2, 'push-gate: could not read the clock');
        assert.ok(!r.out.includes('SECRETTEXT'), r.out);
      });
    }
  });

  describe('what gitleaks says it scanned is checked, commit by commit (review round 11, P1)', () => {
    it('a commit that adds text must be reported as 1 scanned: 0, 2, and no number all stop the gate (2)', () => {
      for (const scanned of ['0', '2', 'none']) {
        const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_SCANNED: scanned });
        stops(r, 2, 'push-gate: step gitleaks could not confirm what it scanned');
        assert.ok(!r.out.includes('push-gate: passed'), r.out);
      }
    });

    it('a commit that adds no text may be 0 or 1, and nothing else, when the tree of HEAD has no text either (and the tree must then still fit)', () => {
      git(sb, 'rm', '-q', 'a.txt', 'b.txt');
      git(sb, 'commit', '-q', '-m', 'delete');
      const before = git(sb, 'rev-parse', 'HEAD');
      git(sb, 'commit', '-q', '--allow-empty', '-m', 'empty');
      for (const scanned of ['0', '1']) {
        const r = runGate(sb, ['--mode', 'words', '--base', before], { ...words(), SHIM_SCANNED: scanned });
        assert.equal(r.status, 0, `${scanned}: ${r.out}`);
      }
      for (const scanned of ['2', 'none']) {
        stops(runGate(sb, ['--mode', 'words', '--base', before], { ...words(), SHIM_SCANNED: scanned }), 2, 'push-gate: step gitleaks could not confirm what it scanned');
      }
    });

    it('D2: the tree of HEAD is read as one commit and must be reported as 1 scanned when it has text: 0 stops the gate (2) even when the range adds no text', () => {
      const before = git(sb, 'rev-parse', 'HEAD');
      git(sb, 'commit', '-q', '--allow-empty', '-m', 'empty');
      const r = runGate(sb, ['--mode', 'words', '--base', before], { ...words(), SHIM_SCANNED: '0' });
      stops(r, 2, 'push-gate: step gitleaks could not confirm what it scanned');
      assert.ok(!r.out.includes('push-gate: passed'), r.out);
    });

    it('a deletion-only commit and a commit that adds an empty file add no text; a blank line and a symlink do', () => {
      const before = git(sb, 'rev-parse', 'HEAD');
      git(sb, 'rm', '-q', 'a.txt', 'b.txt');
      git(sb, 'commit', '-q', '-m', 'delete');
      assert.equal(runGate(sb, ['--mode', 'words', '--base', before], { ...words(), SHIM_SCANNED: '0' }).status, 0);
      commit(sb, { 'empty.txt': '' });
      assert.equal(runGate(sb, ['--mode', 'words', '--base', before], { ...words(), SHIM_SCANNED: '0' }).status, 0, 'an empty file adds no text');
      const only = git(sb, 'rev-parse', 'HEAD');
      commit(sb, { 'blank.txt': '\n' });
      assert.equal(runGate(sb, ['--mode', 'words', '--base', only], { ...words(), SHIM_SCANNED: '0' }).status, 2, 'a blank line is added text');
    });

    it('a failing read of a commit patch stops the gate (2)', () => {
      const first = git(sb, 'rev-list', '--max-parents=0', 'HEAD');
      const blob = git(sb, 'rev-parse', `${first}:a.txt`);
      // a later commit changes the file, so that the blob of the first commit is not in HEAD's tree: the export of HEAD still works
      // and the stop comes from reading the patch of that first commit (a blob of HEAD would stop the export first)
      commit(sb, { 'a.txt': 'changed\n' });
      rmSync(path.join(sb.repo, '.git/objects', blob.slice(0, 2), blob.slice(2)), { force: true });
      const r = runGate(sb, ['--mode', 'words', '--all'], words());
      assert.equal(r.status, 2, r.out);
      said(r, 'push-gate: step gitleaks could not run (could not read the patch of a commit)');
      assert.ok(!r.out.includes('push-gate: passed'), r.out);
    });
  });

  it('closes every way a file in the tree could change what gitleaks reads: fixed config, no ignore file, no inline allow', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), GITLEAKS_CONFIG: '/nonexistent/allow.toml', GITLEAKS_CONFIG_TOML: 'x' });
    assert.equal(r.status, 0, r.out);
    const calls = sb.calls().filter((l) => l.startsWith('gitleaks '));
    assert.equal(calls.length, 4, 'git x2 (the commits), git x1 (the tree of HEAD), stdin x1 (the texts)');
    assert.equal(calls.filter((l) => l.startsWith('gitleaks dir')).length, 0);
    for (const call of calls) {
      assert.ok(call.includes('--config') && call.includes('push-gate.gitleaks.toml') && !call.includes('gitleaks-public.toml'), `no fixed config, or the old check's: ${call}`);
      assert.ok(call.includes('--gitleaks-ignore-path'), `no ignore path: ${call}`);
      assert.ok(call.includes('--ignore-gitleaks-allow'), `inline allow honoured: ${call}`);
      assert.ok(call.endsWith('#env:unset:unset'), `the config environment variables reach gitleaks: ${call}`);
    }
  });

  it('runs every tool with an explicit environment: hostile GIT_*, GREP_* and GITLEAKS_* variables of the caller change nothing', () => {
    const hostile = { GIT_INDEX_FILE: '/nonexistent/index', GIT_ATTR_SOURCE: 'nonsense', GREP_OPTIONS: '-v', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.attributesFile', GIT_CONFIG_VALUE_0: '/nonexistent/attrs', GITLEAKS_BASELINE_PATH: '/nonexistent/baseline.json' };
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), ...hostile });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: passed (mode words, 2 commit(s))'), r.out);
  });

  it('says how much gitleaks found without printing any of it: counts, and the commits of messages', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99', SHIM_REPORT_gitleaks: HIT });
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step gitleaks: FAILED (2 finding(s) in patches, 1 in commit messages, 1 in the tree of HEAD)'), r.out);
    assert.ok(!/commit message of/.test(r.out), 'a count, no ids');
  });

  it('a gitleaks error while reading a message or the tree stops the gate', () => {
    stops(runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '2' }), 2, 'push-gate: step gitleaks could not run (exit 2)');
  });

  it('stops when the commits cannot be listed (a missing parent object), instead of scanning nothing', () => {
    const first = git(sb, 'rev-list', '--max-parents=0', 'HEAD');
    rmSync(path.join(sb.repo, '.git/objects', first.slice(0, 2), first.slice(2)), { force: true });
    stops(runGate(sb, ['--mode', 'words', '--all'], words()), 2, 'push-gate: could not list the commits');
  });

  it('scan-public.sh itself stops when rev-list fails: --revs with nothing after it is not "clean"', () => {
    const r = spawnSync('/bin/sh', [scanPublic, '--revs'], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('scan: git rev-list failed'), r.stdout + r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes('scan-public: clean'));
  });

  it('a git that cannot ignore the tree\'s attributes (before --attr-source) stops the gate and scan-public instead of scanning less', () => {
    const realGit = which('git');
    rmSync(path.join(sb.bin, 'git'));
    writeFileSync(path.join(sb.bin, 'git'), `#!/bin/sh\nfor a in "$@"; do case $a in --attr-source*) echo "unknown option: $a" >&2; exit 129 ;; esac; done\nexec ${realGit} "$@"\n`);
    chmodSync(path.join(sb.bin, 'git'), 0o755);
    const reason = 'this git does not support --attr-source (git 2.40 or newer is needed): not scanning with a weaker scan';
    stops(runGate(sb, ['--mode', 'words', '--all'], words()), 2, `push-gate: ${reason}`);
    const r = spawnSync('/bin/sh', [scanPublic, 'HEAD~1'], { cwd: sb.repo, encoding: 'utf8', env: sb.env(words()) });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes(`scan: ${reason}`), r.stdout + r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes('scan-public: clean'));
  });

  it('the scan scripts leave no temporary file behind, on a clean run or when they stop', () => {
    const tmpDir = path.join(sb.dir, 'tmp');
    mkdirSync(tmpDir);
    const env = sb.env({ TMPDIR: tmpDir, ...words() });
    const left = () => readdirSync(tmpDir);
    spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, env });
    assert.deepEqual(left(), [], 'after a clean scan');
    spawnSync('/bin/sh', [scanPublic, '--revs'], { cwd: sb.repo, env });
    assert.deepEqual(left(), [], 'after a scan that stopped on a rev-list failure');
    spawnSync('/bin/sh', [path.join(scripts, 'scan-pr-text.sh'), path.join(sb.dir, 'absent')], { cwd: sb.repo, env });
    assert.deepEqual(left(), [], 'after scan-pr-text.sh that could not read its input');
    writeFileSync(path.join(sb.dir, 'body'), 'text\n');
    spawnSync('/bin/sh', [path.join(scripts, 'scan-pr-text.sh'), path.join(sb.dir, 'body')], { cwd: sb.repo, env });
    assert.deepEqual(left(), [], 'after a clean scan-pr-text.sh');
  });

  it('in quiet mode even the scope of a scoped word-list line is not printed', () => {
    writeWords(sb, `@docs/ ${WORD}\n`);
    commit(sb, { 'docs/x.txt': `${WORD}\n` });
    const run = (extra) => {
      const r = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ ...words(), ...extra }) });
      return r.stdout + r.stderr;
    };
    assert.ok(run({}).includes('under docs/'), 'locally the scope is named');
    const quiet = run({ SCAN_QUIET: '1' });
    assert.ok(quiet.includes('scoped word list: 1 file(s) in'), quiet);
    assert.ok(!quiet.includes('docs/') && !quiet.includes('x.txt'), quiet);
  });

  it('the quiet output on an error path holds no path or scanned text either', () => {
    commit(sb, { 'notes.txt': `${WORD}\n` });
    writeWords(sb, '(\n');
    const r = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ ...words(), SCAN_QUIET: '1' }) });
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 2, out);
    assert.ok(out.includes('scan: grep failed'), out);
    assert.ok(!out.includes('notes.txt') && !out.includes(WORD) && !out.includes(sb.words), out);
  });

  it('in CI the public output is counts only; locally the word and workflow checks name places', () => {
    commit(sb, { 'notes.txt': `${WORD}\n`, '.github/workflows/ci.yml': 'name: x\n' });
    const env = { ...words(), SHIM_ACTIONLINT_EXIT: '1', SHIM_OUT_actionlint: '.github/workflows/ci.yml:3: [syntax-check]|' };
    const ci = runGate(sb, ['--mode', 'words', '--all'], { ...env, CI: 'true' });
    assert.equal(ci.status, 1, ci.out);
    assert.ok(ci.out.includes('word list: 1 file(s)'), ci.out);
    assert.ok(ci.out.includes('push-gate: step workflows: FAILED (1 problem(s))'), ci.out);
    assert.ok(!/rule /.test(ci.out) && !ci.out.includes('syntax-check'), `a name from a tool is in the CI output: ${ci.out}`);
    assert.ok(!ci.out.includes('notes.txt'), `a path leaked into the CI output: ${ci.out}`);
    assert.ok(!ci.out.includes('ci.yml:3'), `a path leaked into the CI output: ${ci.out}`);
    const local = runGate(sb, ['--mode', 'words', '--all'], env);
    assert.ok(local.out.includes('at notes.txt:1'), local.out);
    assert.ok(local.out.includes('at .github/workflows/ci.yml:3: [syntax-check]'), local.out);
  });

  it('scan-public.sh keeps its default output (the old CI step relies on it); SCAN_QUIET=1 drops the places', () => {
    commit(sb, { 'notes.txt': `${WORD}\n` });
    const run = (extra) => {
      const r = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ ...words(), CI: 'true', ...extra }) });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    const plain = run({});
    assert.equal(plain.status, 1, plain.out);
    assert.ok(plain.out.includes('at notes.txt:1'), plain.out);
    const quiet = run({ SCAN_QUIET: '1' });
    assert.equal(quiet.status, 1, quiet.out);
    assert.ok(quiet.out.includes('word list: 1 file(s)') && !quiet.out.includes('notes.txt'), quiet.out);
  });
});

  describe('the text of a commit is the raw object, with NUL as a line break (review round 14, R1)', () => {
    const scanPublic = path.join(scripts, 'scan-public.sh');
    const words = () => ({ SCAN_WORDS_FILE: sb.words });
    /** A commit on top of HEAD built by hand: same tree, `extra` header lines, and a message (a Buffer may hold NUL). */
    const NOREPLY = 'Tester <tester@users.noreply.github.com> 1700000000 +0000';
    const rawCommit = ({ extra = '', message = 'plain\n', encoding = 'utf8', author = NOREPLY, committer = NOREPLY } = {}) => {
      const tree = git(sb, 'rev-parse', 'HEAD^{tree}');
      const parent = git(sb, 'rev-parse', 'HEAD');
      const body = Buffer.concat([Buffer.from(`tree ${tree}\nparent ${parent}\nauthor ${author}\ncommitter ${committer}\n${extra}\n`, 'latin1'), Buffer.isBuffer(message) ? message : Buffer.from(message, encoding)]);
      const r = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--literally', '--stdin'], { cwd: sb.repo, input: body, env: sb.env() });
      assert.equal(r.status, 0, String(r.stderr));
      git(sb, 'update-ref', 'refs/heads/main', String(r.stdout).trim());
    };
    const scan = (extra = {}) => {
      const r = spawnSync('/bin/sh', [scanPublic, 'HEAD~1'], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ ...words(), ...extra }) });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    const MAIL = ['someone', 'mailhost.test'].join('@');
    const cases = {
      'a header of the commit (mergetag, with continuation lines)': (t) => ({ extra: `mergetag object ${ZERO}\n type commit\n tag t1\n tagger T <t@users.noreply.github.com> 1 +0000\n \n ${t}\n` }),
      'an extra header': (t) => ({ extra: `x-extra: ${t}\n` }),
      'a gpgsig-shaped continuation line': (t) => ({ extra: `gpgsig -----BEGIN PGP SIGNATURE-----\n \n ${t}\n -----END PGP SIGNATURE-----\n` }),
      'the message after a NUL': (t) => ({ message: Buffer.concat([Buffer.from('subject\n'), Buffer.from([0]), Buffer.from(`hidden ${t}\n`)]) }),
    };
    beforeEach(() => { commit(sb, { 'b.txt': 'two\n' }); writeWords(sb); });
    for (const [label, build] of Object.entries(cases)) {
      it(`a word of the list in ${label} is found by scan-public`, () => {
        rawCommit(build(WORD));
        const r = scan();
        assert.equal(r.status, 1, r.out);
        assert.ok(r.out.includes('word list: commit message or author of'), r.out);
      });
      it(`an email-like string in ${label} is found by scan-public`, () => {
        rawCommit(build(MAIL));
        const r = scan();
        assert.equal(r.status, 1, r.out);
        assert.ok(r.out.includes('email-like string in the message of'), r.out);
      });
    }
    it('every text is followed by a separator line break, whatever it ends with: two records without a trailing newline stay on their own lines (review round 17, V1)', () => {
      const first = git(sb, 'rev-parse', 'HEAD');
      rawCommit({ message: 'no newline at the end' });
      rawCommit({ message: 'another one' });
      const dump = path.join(sb.dir, 'batches.txt');
      const r = runGate(sb, ['--mode', 'general', '--base', first], { SHIM_STDIN_DUMP: dump });
      assert.equal(r.status, 0, r.out);
      const lines = readFileSync(dump, 'utf8').split('\n');
      assert.equal(lines.filter((l) => /^tree [0-9a-f]{40}$/.test(l)).length, 2, `a record joined the line of the one before: ${lines.join('|')}`);
    });
    it('an attribution trailer inside a header (a merged tag message) is found', () => {
      rawCommit({ extra: `mergetag object x\n type commit\n \n Co-Authored-By: Claude <${['noreply', 'anthropic.com'].join('@')}>\n` });
      const r = scan();
      assert.equal(r.status, 1, r.out);
      assert.ok(r.out.includes('attribution line in'), r.out);
    });
    it('no false positive from the usual lines: tree, parent, a GitHub web-flow committer, and a gpgsig block of random base64', () => {
      const sig = randomBytes(300).toString('base64').match(/.{1,64}/g).map((l) => ` ${l}`).join('\n');
      const tree = git(sb, 'rev-parse', 'HEAD^{tree}');
      const parent = git(sb, 'rev-parse', 'HEAD');
      const body = `tree ${tree}\nparent ${parent}\nauthor Tester <tester@users.noreply.github.com> 1700000000 +0000\ncommitter GitHub <${['noreply', 'github.com'].join('@')}> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n${sig}\n -----END PGP SIGNATURE-----\n\nplain\n`;
      const r = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--literally', '--stdin'], { cwd: sb.repo, input: body, env: sb.env() });
      git(sb, 'update-ref', 'refs/heads/main', String(r.stdout).trim());
      const out = scan();
      assert.equal(out.status, 0, out.out);
    });
    describe('the two identity lines: the address in <...> belongs to the identity rule, everything else on the line to the mail rule (review round 15, S1)', () => {
      const addr = ['jane.roe', 'corp-mail.test'].join('@');
      const NR = '<tester@users.noreply.github.com>';
      const expectMail = (opts) => {
        rawCommit(opts);
        const r = scan();
        assert.equal(r.status, 1, r.out);
        assert.ok(r.out.includes('email-like string in the message of'), r.out);
      };
      it('an address in the author name is found', () => expectMail({ author: `Jane Roe ${addr} ${NR} 1700000000 +0000` }));
      it('an address in the committer name is found', () => expectMail({ committer: `Jane Roe ${addr} ${NR} 1700000000 +0000` }));
      it('an address after the timezone of a literally built object is found', () => expectMail({ author: `Tester ${NR} 1700000000 +0000 ${addr}` }));
      it('the address that the identity rule checks is the first <...>: one in the name is the identity, and not allowed', () => {
        rawCommit({ author: `Jane <${addr}> Roe ${NR} 1700000000 +0000` });
        const r = scan();
        assert.equal(r.status, 1, r.out);
        assert.ok(r.out.includes('author or committer not allowed in'), r.out);
      });
      for (const [label, line] of [['no <...> at all', 'Tester 1700000000 +0000'], ['an empty address', 'Tester <> 1700000000 +0000'], ['an address that is never closed', 'Tester <tester@users.noreply.github.com 1700000000 +0000']]) {
        it(`an author line with ${label} is red in the identity rule`, () => {
          rawCommit({ author: line });
          const r = scan();
          assert.equal(r.status, 1, r.out);
          assert.ok(r.out.includes('author or committer not allowed in'), r.out);
        });
        it(`a committer line with ${label} is red in the identity rule`, () => {
          rawCommit({ committer: line });
          const r = scan();
          assert.equal(r.status, 1, r.out);
          assert.ok(r.out.includes('author or committer not allowed in'), r.out);
        });
      }
      it('an address before the noreply one inside the same <...> is not a noreply identity (plain git config)', () => {
        git(sb, '-c', `user.email=${addr} 1+tester@users.noreply.github.com`, 'commit', '-q', '--allow-empty', '-m', 'q');
        const r = scan();
        assert.equal(r.status, 1, r.out);
        assert.ok(r.out.includes('author or committer not allowed in'), r.out);
      });
      it('the same on a literally built object, in the author and in the committer line', () => {
        for (const opts of [{ author: 'Tester <a@b <1+t@users.noreply.github.com> 1700000000 +0000' }, { committer: 'Tester <a@b <1+t@users.noreply.github.com> 1700000000 +0000' }]) {
          rawCommit(opts);
          const r = scan();
          assert.equal(r.status, 1, r.out);
          assert.ok(r.out.includes('author or committer not allowed in'), r.out);
        }
      });
      it('only the exact noreply shapes pass: a login with other characters, text before or after, a different host', () => {
        for (const bad of ['tester#users.noreply.github.com.attacker.test', 'te ster#users.noreply.github.com', 'tester#users.noreply.github.com ', '+tester#users.noreply.github.com', 'a+b+tester#users.noreply.github.com', 'tester#xusers.noreply.github.com', 'x.noreply#github.com'].map((t) => t.replace('#', '@'))) {
          rawCommit({ author: `Tester <${bad}> 1700000000 +0000` });
          const r = scan();
          assert.equal(r.status, 1, `${bad}: ${r.out}`);
        }
      });
      it('an address that only starts like an allowed one is found by the mail rule (the allowed shapes end the address)', () => {
        for (const bad of ['a#users.noreply.github.com.attacker.test', 'a#example.com.attacker.test', 'a#host.example.attacker.test'].map((t) => t.replace('#', '@'))) {
          rawCommit({ message: `note ${bad}\n` });
          const r = scan();
          assert.equal(r.status, 1, `${bad}: ${r.out}`);
          assert.ok(r.out.includes('email-like string in the message of'), `${bad}: ${r.out}`);
        }
      });
      it('the web-flow committer and a normal noreply identity (with a numeric prefix) still pass', () => {
        rawCommit({ author: 'Tester <12345+tester@users.noreply.github.com> 1700000000 +0000', committer: `GitHub <${['noreply', 'github.com'].join('@')}> 1700000000 +0000` });
        const r = scan();
        assert.equal(r.status, 0, r.out);
      });
      it('the gate stops on an address in the author name', () => {
        rawCommit({ author: `Jane Roe ${addr} ${NR} 1700000000 +0000` });
        const r = runGate(sb, ['--mode', 'words', '--base', 'HEAD~1'], words());
        stops(r, 1, 'push-gate: step scan-public: FAILED');
      });
    });
    it('a commit with an encoding header carries non-UTF-8 bytes: a word in them is still found (raw bytes, both locales)', () => {
      rawCommit({ extra: 'encoding ISO-8859-1\n', message: Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from(` ${WORD}\n`)]) });
      const r = scan();
      assert.equal(r.status, 1, r.out);
      assert.ok(r.out.includes('word list: commit message or author of'), r.out);
    });
  });

  describe('a step that fails is never "nothing found" or "a smaller list" (review round 18, the sweep)', () => {
    const scanPublic = path.join(scripts, 'scan-public.sh');
    const scanPr = path.join(scripts, 'scan-pr-text.sh');
    const wrapper = path.join(scripts, 'gitleaks-public.sh');
    /** Replaces a tool in the sandbox by one that fails (exit `code`, no output) when its arguments contain `needle`, and is the real tool otherwise. */
    const shimFail = (name, needle, code = 2) => {
      rmSync(path.join(sb.bin, name), { force: true });
      writeFileSync(path.join(sb.bin, name), `#!/bin/sh\ncase "$*" in *'${needle}'*) exit ${code} ;; esac\nexec ${which(name)} "$@"\n`);
      chmodSync(path.join(sb.bin, name), 0o755);
    };
    const okGitleaks = () => {
      const f = path.join(sb.dir, 'ok-gitleaks-sweep');
      writeFileSync(f, '#!/bin/sh\n[ "$1" != git ] || echo "6:02PM INF 1 commits scanned." >&2\nexit 0\n');
      chmodSync(f, 0o755);
      return f;
    };
    const wrap = (mode, extra = {}) => {
      const r = spawnSync('/bin/sh', [wrapper, mode, sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: okGitleaks(), ...extra }) });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    beforeEach(() => { commit(sb, { 'a.txt': 'one\n' }); commit(sb, { 'b.txt': 'two\n' }); });

    describe('the word list is read in one place, with every status checked (W1)', () => {
      const lists = {
        'a line that is not valid UTF-8': Buffer.concat([Buffer.from('plainword\ncaf'), Buffer.from([0xe9]), Buffer.from('word\n')]),
        'a NUL byte': Buffer.from('plainword\nab\0cd\n'),
        'a carriage return': Buffer.from('plainword\r\nsecondone\n'),
        'a byte order mark': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('plainword\nsecondone\n')]),
      };
      const why = { 'a line that is not valid UTF-8': 'is not valid UTF-8', 'a NUL byte': 'contains a NUL byte', 'a carriage return': 'contains a carriage return', 'a byte order mark': 'begins a line with a byte order mark' };
      for (const [label, content] of Object.entries(lists)) {
        it(`a list with ${label} stops the gate, scan-public and scan-pr-text (exit 2) with a fixed reason and no line of the list`, () => {
          writeFileSync(sb.words, content);
          const g = runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.words });
          assert.equal(g.status, 2, g.out);
          said(g, `push-gate: the word list ${why[label]}`);
          const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: sb.words }) });
          assert.equal(p.status, 2, p.stdout + p.stderr);
          said(p, `scan: the word list ${why[label]}`);
          said(p, 'scan-public: ERROR');
          const text = path.join(sb.dir, 'pr.txt');
          writeFileSync(text, 'title\n');
          const t = spawnSync('/bin/sh', [scanPr, text], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: sb.words }) });
          assert.equal(t.status, 2, t.stdout + t.stderr);
          said(t, `scan-pr-text: the word list ${why[label]}`);
          for (const o of [g.out, p.stdout + p.stderr, t.stdout + t.stderr]) assert.ok(!o.includes('plainword') && !o.includes('word'.repeat(2)), o);
        });
      }
      it('a stage of the reading that fails (awk) is exit 2 in scan-public, scan-pr-text and the gate, not an empty list', () => {
        writeWords(sb);
        shimFail('awk', 'WORDLIST-READ');
        const env = { SCAN_WORDS_FILE: sb.words };
        const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env(env) });
        assert.equal(p.status, 2, p.stdout + p.stderr);
        said(p, 'scan: the word list could not be read');
        const text = path.join(sb.dir, 'pr.txt');
        writeFileSync(text, 'title\n');
        const t = spawnSync('/bin/sh', [scanPr, text], { cwd: sb.repo, encoding: 'utf8', env: sb.env(env) });
        assert.equal(t.status, 2, t.stdout + t.stderr);
        said(t, 'scan-pr-text: the word list could not be read');
        stops(runGate(sb, ['--mode', 'words', '--all'], env), 2, 'push-gate: the word list could not be read');
      });
      it('a list file that is named but missing or empty is exit 2 in scan-public (not a scan without a list)', () => {
        for (const file of [path.join(sb.dir, 'no-such-list'), sb.words]) {
          writeFileSync(sb.words, '');
          const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: file }) });
          assert.equal(p.status, 2, `${file}: ${p.stdout + p.stderr}`);
          said(p, 'scan: the word list is missing or empty');
        }
      });
    });

    it('W2: an ls-tree that fails is not "no workflow files" (the gate exits 2)', () => {
      commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
      shimFail('git', 'ls-tree');
      stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step workflows could not run (could not list the files of HEAD)');
    });
    describe('the tree of HEAD is read as a synthetic root commit: a failing step of it is exit 2 with a message of its own, never a clean tree line', () => {
      // The range is empty (`--base HEAD`), so only the tree step runs. The shim is the real git except for the commands that
      // build, list or read the tree, whatever their other arguments: any `commit-tree`; any `ls-tree` with `-z`; any `cat-file`
      // that is not `cat-file commit` (the commit texts are read with that). So `cat-file --batch`, `ls-tree -z -r` and the like
      // are caught as well as the spelling the implementation happens to use.
      const BODIES = {
        'commit-tree': 'case " $* " in *commit-tree*) exit 2 ;; esac',
        'ls-tree with -z': 'case " $* " in *ls-tree*" -z "*) exit 2 ;; esac',
        'a cat-file that is not cat-file commit': 'case " $* " in *" cat-file commit "*) ;; *" cat-file "*) exit 2 ;; esac',
      };
      const shimTree = (variant) => {
        rmSync(path.join(sb.bin, 'git'), { force: true });
        writeFileSync(path.join(sb.bin, 'git'), `#!/bin/sh\n${BODIES[variant]}\nexec ${which('git')} "$@"\n`);
        chmodSync(path.join(sb.bin, 'git'), 0o755);
      };
      for (const variant of ['commit-tree', 'ls-tree with -z', 'a cat-file that is not cat-file commit']) {
        it(`${variant} that fails stops the gate (2) with "tree of HEAD could not be read"`, () => {
          shimTree(variant);
          const r = runGate(sb, ['--mode', 'general', '--base', 'HEAD']);
          assert.equal(r.status, 2, r.out);
          assert.ok(r.out.includes('tree of HEAD could not be read'), r.out);
          assert.ok(!r.out.includes('push-gate: passed') && !r.out.includes('step gitleaks: ok') && !r.out.includes('skipped'), r.out);
          assert.ok(!/tree of HEAD[^\n]*(ok|clean)/i.test(r.out), `a clean tree line was printed: ${r.out}`);
        });
      }
    });
    it('a shallow clone stops the gate (2): the history cannot be read to the end', () => {
      const d = path.join(sb.dir, 'shallow');
      git({ ...sb, cwd: sb.dir }, 'clone', '-q', '--depth', '1', `file://${sb.repo}`, d);
      const r = spawnSync('/bin/sh', [gate, '--mode', 'general', '--all'], { cwd: d, encoding: 'utf8', env: sb.env() });
      stops({ status: r.status, out: r.stdout + r.stderr }, 2, 'push-gate: this is a shallow clone, so the history cannot be read to the end');
    });
    it('a repository with no commit stops the gate (2) with "HEAD is not a commit", in every way of naming the range', () => {
      const d = path.join(sb.dir, 'empty');
      mkdirSync(d);
      git({ ...sb, cwd: d }, 'init', '-q', '-b', 'main');
      for (const range of [['--all'], ['--base', 'HEAD']]) {
        const r = spawnSync('/bin/sh', [gate, '--mode', 'general', ...range], { cwd: d, encoding: 'utf8', env: sb.env() });
        stops({ status: r.status, out: r.stdout + r.stderr }, 2, 'push-gate: HEAD is not a commit');
      }
    });
    it('W2: the tr of the text-added decision that fails stops the wrapper (the gate reads the same decision), it is not "nothing added"', () => {
      shimFail('tr', '\\000');
      const r = wrap('git');
      assert.equal(r.status, 2, r.out);
      said(r, 'gitleaks git: could not run (could not read the patch of a commit)');
      assert.ok(!r.out.includes('gitleaks git: ok'), r.out);
    });
    it('W2: the tr of the text-added decision that fails stops the gate, it is not "nothing added"', () => {
      shimFail('tr', '\\000');
      stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step gitleaks could not run (could not read the patch of a commit)');
    });
    it('a cat that fails while the list of commits is read stops the gate and scan-public, never "no commits to scan"', () => {
      rmSync(path.join(sb.bin, 'cat'), { force: true });
      writeFileSync(path.join(sb.bin, 'cat'), `#!/bin/sh\nif [ $# -eq 1 ] && [ -f "$1" ] && head -n 1 "$1" | grep -Eqx '[0-9a-f]{40}'; then exit 1; fi\nexec ${which('cat')} "$@"\n`);
      chmodSync(path.join(sb.bin, 'cat'), 0o755);
      stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step gitleaks could not run (could not read the list of commits)');
      writeWords(sb);
      const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: sb.words }) });
      assert.equal(p.status, 2, p.stdout + p.stderr);
      said(p, 'scan: could not read the list of commits');
      assert.ok(!(p.stdout + p.stderr).includes('scan-public: clean'), p.stdout + p.stderr);
    });
    it('the wrapper: a rev-parse of HEAD that fails is exit 2, and so is a cat-file that fails on the commit a tag points to', () => {
      shimFail('git', '-q --verify HEAD^{commit}', 128);
      let r = wrap('git');
      assert.equal(r.status, 2, r.out);
      said(r, 'gitleaks git: could not run (exit 2)');
      assert.ok(!r.out.includes('gitleaks git: ok'), r.out);
      rmSync(path.join(sb.bin, 'git'), { force: true });
      symlinkSync(which('git'), path.join(sb.bin, 'git'));
      git(sb, 'checkout', '-q', '-b', 'side');
      const only = commit(sb, { 'c.txt': 'three\n' });
      git(sb, 'tag', '-a', '-m', 't', 'tagged');
      git(sb, 'checkout', '-q', 'main');
      git(sb, 'branch', '-D', 'side');
      shimFail('git', `cat-file -t ${only}`, 128);
      r = wrap('git');
      assert.equal(r.status, 2, r.out);
      said(r, 'gitleaks git: could not run (exit 2)');
      assert.ok(!r.out.includes('gitleaks git: ok'), r.out);
    });
    it('scan-public: a sed that fails while the hits of a file are filtered is exit 2, not "no hits"', () => {
      commit(sb, { 'paths.txt': `${['/Us', 'ers/real'].join('')}/project\n` });
      writeWords(sb);
      shimFail('sed', 's/^[^:]*://');
      const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: sb.words }) });
      assert.equal(p.status, 2, p.stdout + p.stderr);
      said(p, 'scan: could not read the hits');
    });
    it('a command that fails with exit 1 under set -e is exit 2 in the gate (1 is "found something")', () => {
      shimFail('mkdir', '/home', 1);
      stops(runGate(sb, ['--mode', 'general', '--all']), 2, '');
    });
    it('a command that fails with exit 1 under set -e is exit 2 in the wrapper (1 is "found something")', () => {
      shimFail('sort', '-u', 1);
      const r = wrap('git'); // (no message by design: the exit guard turns the stray exit 1 into 2, so the check is that no verdict was printed)
      assert.equal(r.status, 2, r.out);
      assert.ok(!r.out.includes('gitleaks git: ok') && !r.out.includes('FAILED'), r.out);
    });
    it('a report whose lines cannot be checked (awk fails) is "could not read the result", not findings', () => {
      shimFail('awk', 'who=x_count');
      const r = runGate(sb, ['--mode', 'general', '--all'], { SHIM_GITLEAKS_EXIT: '99', SHIM_REPORT_gitleaks: HIT });
      stops(r, 2, 'push-gate: step gitleaks could not read the result');
    });
    it('gl_scanned: a stage that fails (sed) is "could not confirm what it scanned", not a count', () => {
      shimFail('sed', 'commits scanned', 1);
      stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step gitleaks could not confirm what it scanned');
    });
    it('neutral_commit_text: a cat-file that fails is "could not read the text of a commit"', () => {
      shimFail('git', 'cat-file commit', 1);
      stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step gitleaks could not run (could not read the text of a commit)');
    });
    it('the hook\'s cfg_get: a git config that fails with a status other than "not set" is exit 2, not an empty value', () => {
      shimFail('git', 'config --get', 128);
      const r = runHook(sb, { lines: [pushLine(git(sb, 'rev-parse', 'HEAD'))] });
      assert.equal(r.status, 2, r.out);
      said(r, 'pre-push: could not read git config kaninabe.contentReviewed');
    });
    describe('a number from wc is validated, one helper for every read (review round 19, X1)', () => {
      it('a line count of the list of commits that fails does not read as "no commits": the gate exits 2, not 0 (the count is the awk of wc_lines)', () => {
        shimFail('awk', 'print NR', 1);
        stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: could not count the commits');
      });
      it('a wc -l that fails inside the scan-public step stops the gate with that step named', () => {
        shimFail('wc', '-l', 1);
        stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step scan-public could not run (exit 2)');
      });
      it('a wc that fails on the size of a commit text does not bypass the 64 KiB bound: the gate exits 2', () => {
        shimFail('wc', '-c', 1);
        stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step gitleaks could not run (could not measure the text of a commit)');
      });
      it('scan-public: a wc that fails is exit 2 with its ERROR line, never a count of nothing', () => {
        writeWords(sb);
        shimFail('wc', '-l', 1);
        const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: sb.words }) });
        assert.equal(p.status, 2, p.stdout + p.stderr);
        said(p, 'scan: could not count lines');
        said(p, 'scan-public: ERROR');
      });
    });
    it('the gate\'s list-id check: a sha256sum that fails is exit 2, never a pass (review round 21, AB1)', () => {
      // the CORRECT list id: with a working sha256sum the gate passes, so that only the failing hash can stop it. (The message is the same
      // as for a wrong id: a hash that cannot be made is "not the list".)
      const headSha = git(sb, 'rev-parse', 'HEAD');
      const listId = createHash('sha256').update(`head ${headSha}\n${git(sb, 'rev-list', 'HEAD')}\n`).digest('hex');
      const control = runGate(sb, ['--mode', 'general', '--all', '--list-id', listId]);
      assert.equal(control.status, 0, control.out);
      shimFail('sha256sum', '', 1);
      stops(runGate(sb, ['--mode', 'general', '--all', '--list-id', listId]), 2, 'push-gate: the commits to scan are not the list');
    });
    describe('a loop over a list is complete: every line is processed, or the run stops (review round 22, AC1)', () => {
      const neutral = path.join(scripts, 'neutral-git.sh');
      const scanRules = path.join(scripts, 'scan-rules.sh');
      /** A line count (the awk of wc_lines) of a list of commits that claims more lines than the file has: the list was not read to the end. (Only the file named `commits`: the other lists keep their real count.) */
      const wcLies = () => {
        rmSync(path.join(sb.bin, 'awk'), { force: true });
        writeFileSync(path.join(sb.bin, 'awk'), `#!/bin/sh\ncase "$*" in *'print NR'*commits*) echo 99; exit 0 ;; esac\nexec ${which('awk')} "$@"\n`);
        chmodSync(path.join(sb.bin, 'awk'), 0o755);
      };
      const stub = "gl() { echo '6:02PM INF 1 commits scanned.' >&2; return 0; }";
      const history = (listArg, pre = '') => {
        const script = `. "${neutral}"\n${pre}\nhist_n=0\nscan_history ${listArg} tpl "${sb.dir}" || echo "rc=$?"\necho "n=$hist_n err=$hist_err"\n`;
        const r = spawnSync('/bin/sh', ['-c', script, neutral], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
        return r.stdout + r.stderr;
      };
      it('scan_history: a list that is missing, or is not a file, is rc=2 with a reason, never "no findings"', () => {
        for (const list of ['/nonexistent/list', `"${sb.dir}"`]) {
          const out = history(list);
          assert.match(out, /rc=2/, out);
          assert.ok(out.includes('err=could not run (the list of commits cannot be read)'), out); // (the same reason for both)
        }
      });
      it('scan_history: a list that cannot be opened by the loop is rc=2 (the check and the loop can disagree)', () => {
        const list = path.join(sb.dir, 'one-commit');
        writeFileSync(list, 'a'.repeat(40) + '\n');
        // the list is checked, then the loop's own redirect fails: simulated by a function that removes the file after the check
        const out = history(`"${list}"`, `wc_lines() { wc_v=1; rm -f "${list}"; }\nneutral_adds_text() { return 1; }\n${stub}`);
        assert.match(out, /rc=2/, out);
        assert.ok(out.includes('err=could not run (the list of commits was not read to the end)'), out);
      });
      it('scan_history: a list whose last line has no line break is rc=2 (the unread last entry is counted), never rc=0', () => {
        const list = path.join(sb.dir, 'unterminated');
        writeFileSync(list, 'a'.repeat(40) + '\n' + 'b'.repeat(40));
        const out = history(`"${list}"`, `neutral_adds_text() { return 1; }\n${stub}`);
        assert.match(out, /rc=2/, out);
        assert.ok(out.includes('err=could not run (the list of commits was not read to the end)'), out);
      });
      it('the shared count of a list counts an unterminated last line too (wc_lines)', () => {
        const list = path.join(sb.dir, 'cnt');
        for (const [text, want] of [['', '0'], ['a\n', '1'], ['a\nb', '2'], ['a\nb\n', '2']]) {
          writeFileSync(list, text);
          const r = spawnSync('/bin/sh', ['-c', `. "${neutral}"\nwc_lines "${list}" && echo "$wc_v"`, neutral], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
          assert.equal(r.stdout.trim(), want, r.stdout + r.stderr);
        }
      });
      it('scan_history: a list whose line count differs from the lines processed is rc=2', () => {
        const list = path.join(sb.dir, 'two-commits');
        writeFileSync(list, 'a'.repeat(40) + '\nb'.repeat(1) + '\n');
        const out = history(`"${list}"`, `wc_lines() { wc_v=5; }\nneutral_adds_text() { return 1; }\n${stub}`);
        assert.match(out, /rc=2/, out);
        assert.ok(out.includes('err=could not run (the list of commits was not read to the end)'), out);
      });
      it('the gate: a count of lines that does not match what scan_history processed is exit 2, not a clean scan', () => {
        wcLies();
        stops(runGate(sb, ['--mode', 'general', '--all']), 2, 'push-gate: step gitleaks could not run (the list of commits was not read to the end)');
      });
      it('the old-step wrapper: the same is exit 2', () => {
        wcLies();
        const w = wrap('git');
        assert.equal(w.status, 2, w.out);
        said(w, 'gitleaks git: could not run (the list of commits was not read to the end)');
      });
      it('scan_attribution and scan_bad_email: an input path that cannot be read is exit 2, never "no finding" (review round 24, AE1)', () => {
        for (const fn of ['scan_attribution', 'scan_bad_email']) {
          const script = `scan_name=t\n. "${scanRules}"\n${fn} /nonexistent/input < /dev/null\necho "rc=$?"\n`;
          const r = spawnSync('/bin/sh', ['-c', script, scanRules], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
          assert.equal(r.status, 2, `${fn}: ${r.stdout}${r.stderr}`);
          said(r, 'scan: could not read a result');
          assert.ok(!r.stdout.includes('rc='), r.stdout);
        }
      });
      it('scan-pr-text: an input that cannot be read is exit 2 (the attribution and mail checks are never reached with a failed open)', () => {
        for (const input of [path.join(sb.dir, 'missing.txt'), sb.dir]) {
          const r = spawnSync('/bin/sh', [scanPr, input], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
          assert.equal(r.status, 2, r.stdout + r.stderr);
          said(r, 'scan-pr-text: cannot read the input');
          assert.ok(!/clean/.test(r.stdout), r.stdout);
        }
      });
      it('scan_filter: an output file that cannot be created is exit 2 whatever the shell says for a failed redirect', () => {
        const inp = path.join(sb.dir, 'in.txt');
        writeFileSync(inp, 'x\n');
        const script = `scan_name=t\n. "${scanRules}"\nscan_filter "${inp}" /nonexistent/dir/out -E x\necho "rc=$?"\n`;
        const r = spawnSync('/bin/sh', ['-c', script, scanRules], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
        assert.equal(r.status, 2, r.stdout + r.stderr);
        // dash ends the shell itself when the redirect of the `:` builtin fails ("cannot create"); other shells run scan_io_failed
        assert.match(r.stdout + r.stderr, /cannot create|scan: could not read a result/, r.stdout + r.stderr);
        assert.ok(!r.stdout.includes('rc='), r.stdout);
      });
      it('scan_attribution: a first stage whose redirect fails is exit 2, not "no attribution line"', () => {
        // a READABLE input path, so that the function gets past the input check and reaches the stage whose output cannot be made (a directory in its place)
        const script = `scan_name=t\n. "${scanRules}"\nmkdir "$scan_dir/attr.1"\nprintf 'Co-Authored-By: someone\\n' > "$scan_dir/in"\nscan_attribution "$scan_dir/in"\necho "rc=$?"\n`;
        const r = spawnSync('/bin/sh', ['-c', script, scanRules], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
        assert.equal(r.status, 2, r.stdout + r.stderr);
        // dash ends the shell itself when the redirect of the `:` builtin fails ("cannot create"); other shells run scan_io_failed
        assert.match(r.stdout + r.stderr, /cannot create|scan: could not read a result/, r.stdout + r.stderr);
        assert.ok(!r.stdout.includes('rc='), r.stdout);
      });
    });
    describe('one trap per script, holding the cleanup and the exit guard (review round 19, X2)', () => {
      it('scan-public: a command that fails with exit 1 late in the run (sed) is exit 2, and so is the gate that runs it', () => {
        writeWords(sb);
        shimFail('sed', '[^:]*:', 1);
        const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: sb.words }) });
        assert.equal(p.status, 2, p.stdout + p.stderr);
        stops(runGate(sb, ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: sb.words }), 2, 'push-gate: step scan-public could not run');
      });
      it('no script sets a second trap on the same signal', () => {
        for (const f of ['push-gate.sh', 'push-range.sh', 'gitleaks-public.sh', 'scan-public.sh', 'scan-pr-text.sh', 'scan-rules.sh', 'neutral-git.sh']) {
          const n = readFileSync(path.join(scripts, f), 'utf8').split('\n').filter((l) => /^\s*[^#]*\btrap\b.*EXIT/.test(l)).length;
          assert.ok(n <= 1, `${f} has ${n} EXIT traps`);
        }
      });
    });
    it('scan-public prints its final ERROR line on the grep-failed path too', () => {
      writeWords(sb);
      shimFail('grep', '-qiE -f');
      const p = spawnSync('/bin/sh', [scanPublic], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ SCAN_WORDS_FILE: sb.words }) });
      assert.equal(p.status, 2, p.stdout + p.stderr);
      said(p, 'scan: grep failed (exit 2)');
      said(p, 'scan-public: ERROR');
    });
  });
}

// ---- the hook ----

{
let sb;
let head;
beforeEach(() => {
  sb = sandbox();
  head = commit(sb, { 'a.txt': 'one\n' });
  addRemote(sb);
  writeWords(sb);
});
afterEach(() => sb.cleanup());

const rangeScript = path.join(scripts, 'push-range.sh');
/** What push-range.sh prints for the destination: the gate arguments (line 1) and the range id (line 2). */
const rangeFor = (url = path.join(sb.dir, 'origin.git')) => {
  const r = spawnSync('/bin/sh', [rangeScript, '--gate-args', url], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
  const [args, id] = r.stdout.split('\n');
  return { status: r.status, args, id: (id ?? '').replace(/^range-id=/, ''), err: r.stderr };
};
/** Writes the review record the way the reviewer is told to: "<head sha> <range id>" for the push as it stands now. */
const record = (sha, url) => {
  const cur = git(sb, 'rev-parse', 'HEAD');
  const id = sha === cur ? rangeFor(url).id : '0'.repeat(64);
  git(sb, 'config', 'kaninabe.contentReviewed', `${sha} ${id}`);
};
const words = () => ({ SCAN_WORDS_FILE: sb.words });

describe('pre-push hook', () => {
  it('passes a clean push of the checked-out commit when the review record names it', () => {
    record(head);
    const r = runHook(sb, { lines: [pushLine(head)], env: words() });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: passed (mode words, 1 commit(s))'), r.out);
  });

  it('lets a deletion through without running anything', () => {
    const r = runHook(sb, { lines: [`(delete) ${ZERO} refs/heads/old ${head}`] });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('the last line git sends is read even without a final line break (review round 23, AD1)', () => {
    const other = commit(sb, { 'b.txt': 'two\n' });
    git(sb, 'checkout', '-q', '--detach', head);
    record(other);
    const r = runHook(sb, { lines: [pushLine(other)], env: words(), noFinalNewline: true });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('not the checked-out commit'), r.out);
    record(head);
    const ok = runHook(sb, { lines: [pushLine(head)], env: words(), noFinalNewline: true });
    assert.equal(ok.status, 0, ok.out);
    assert.ok(ok.out.includes('push-gate: passed (mode words, 1 commit(s))'), ok.out);
  });

  it('refuses to push a commit that is not the checked-out one', () => {
    const other = commit(sb, { 'b.txt': 'two\n' });
    git(sb, 'checkout', '-q', '--detach', head);
    record(other);
    const r = runHook(sb, { lines: [pushLine(other)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: refusing to push'), r.out);
    assert.ok(r.out.includes('not the checked-out commit'), r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('refuses when there is no content review record, and says what to do', () => {
    const r = runHook(sb, { lines: [pushLine(head)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: the content review record (kaninabe.contentReviewed) does not name'), r.out);
    assert.ok(r.out.includes('sh scripts/push-range.sh <remote or URL>, read those commits, and record the value it prints'), r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('refuses when the record names another commit, even the previous one', () => {
    record(head);
    const next = commit(sb, { 'b.txt': 'two\n' });
    const r = runHook(sb, { lines: [pushLine(next)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('does not name'), r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('always uses words mode: without a word list it stops, whatever the environment asks for', () => {
    record(head);
    const r = runHook(sb, { lines: [pushLine(head)], env: { PUSH_GATE_MODE: 'general', SCAN_MODE: 'general' } });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: words mode needs the word list'), r.out);
  });

  it('reads the word list and the owner from git config when the environment has none', () => {
    record(head);
    git(sb, 'config', 'kaninabe.scanWords', sb.words);
    git(sb, 'config', 'kaninabe.scanOwner', 'someowner');
    const r = runHook(sb, { lines: [pushLine(head)] });
    assert.equal(r.status, 0, r.out);
    commit(sb, { 'notes.txt': `${WORD}\n` });
    const next = git(sb, 'rev-parse', 'HEAD');
    record(next);
    const bad = runHook(sb, { lines: [pushLine(next)] });
    assert.notEqual(bad.status, 0, bad.out);
    assert.ok(bad.out.includes('push-gate: step scan-public: FAILED'), bad.out);
    assert.ok(!bad.out.includes(WORD), 'the matched word is not printed');
  });

  it('scans the commits the remote does not have: a word in an earlier unpushed commit is found', () => {
    git(sb, 'push', '-q', 'origin', 'main');
    commit(sb, { 'notes.txt': `${WORD}\n` });
    const last = commit(sb, { 'a.txt': 'clean again\n' });
    git(sb, 'rm', '-q', 'notes.txt');
    git(sb, 'commit', '-q', '-m', 'remove');
    const tip = git(sb, 'rev-parse', 'HEAD');
    record(tip);
    const r = runHook(sb, { lines: [pushLine(tip, last)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: step scan-public: FAILED'), r.out);
    assert.ok(r.out.includes('3 commit(s)'), r.out);
  });

  it('a gate that cannot run refuses the push (a missing scanner is not a pass)', () => {
    sb.cleanup();
    sb = sandbox({ gitleaks: false });
    head = commit(sb, { 'a.txt': 'one\n' });
    writeWords(sb);
    addRemote(sb);
    record(head);
    const r = runHook(sb, { lines: [pushLine(head)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: gitleaks is not on PATH'), r.out);
  });

  it('checks every ref line: one bad line refuses the whole push', () => {
    record(head);
    const r = runHook(sb, { lines: [pushLine(head), `refs/heads/other ${'1'.repeat(40)} refs/heads/other ${ZERO}`], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('not the checked-out commit'), r.out);
  });

  it('subtracts only what the destination itself says it has, never what a tracking ref says', () => {
    const bad = commit(sb, { 'notes.txt': `${WORD}\n` });
    git(sb, 'update-ref', 'refs/remotes/origin/main', bad); // local state: the destination (an empty bare repository) does not have it
    const next = removeFile(sb, 'notes.txt');
    record(next);
    let r = runHook(sb, { lines: [pushLine(next)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: step scan-public: FAILED'), `the commit is scanned: ${r.out}`);
    git(sb, 'push', '-q', 'origin', 'main');
    const tip = commit(sb, { 'c.txt': 'three\n' });
    record(tip);
    r = runHook(sb, { lines: [pushLine(tip, next)], env: words() });
    assert.equal(r.status, 0, `what the destination has is left out: ${r.out}`);
    assert.ok(r.out.includes('(mode words, 1 commit(s))'), r.out);
  });

  it('a remote sha that only git claims, and the destination does not advertise, is not subtracted', () => {
    const first = commit(sb, { 'notes.txt': `${WORD}\n` });
    const next = removeFile(sb, 'notes.txt');
    record(next);
    const r = runHook(sb, { lines: [pushLine(next, first)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: step scan-public: FAILED'), r.out);
  });

  it('stops when the destination cannot be asked, instead of scanning less', () => {
    record(head);
    const r = runHook(sb, { lines: [pushLine(head)], env: words(), url: path.join(sb.dir, 'no-such-remote.git') });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('push-range: could not ask the destination for its branches (git ls-remote failed)'), r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('refuses every push of a tag, a deletion too, with the reason', () => {
    git(sb, 'tag', '-a', 'v1', '-m', 'note');
    const tagObject = git(sb, 'rev-parse', 'v1');
    record(head);
    const lines = [
      `refs/tags/v1 ${tagObject} refs/tags/v1 ${ZERO}`,
      `refs/tags/v1 ${head} refs/tags/v1 ${ZERO}`,
      `(delete) ${ZERO} refs/tags/v1 ${tagObject}`,
    ];
    for (const line of lines) {
      const r = runHook(sb, { lines: [line], env: words() });
      assert.notEqual(r.status, 0, `${line}: ${r.out}`);
      assert.ok(r.out.includes('pre-push: refusing to push a tag'), r.out);
      assert.ok(r.out.includes('tags are created and deleted only by the tag workflow'), r.out);
    }
    assert.deepEqual(sb.calls(), []);
  });

  it('with nothing to push, does nothing', () => {
    const r = runHook(sb, { lines: [] });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(sb.calls(), []);
  });
});

const scanPublic = path.join(scripts, 'scan-public.sh');
/** Runs `git push` for real, with the hook of this repository installed through core.hooksPath. */
const realPush = (extraEnv, ...args) => {
  const r = spawnSync('git', ['-c', `core.hooksPath=${path.dirname(hook)}`, 'push', ...args], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ ...words(), ...extraEnv }) });
  return { status: r.status, out: r.stdout + r.stderr };
};
const remoteRefs = (bare) => spawnSync('git', ['for-each-ref', '--format=%(refname)'], { cwd: bare, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

describe('pre-push hook: only branches, only the checked-out commit, and the caller\'s repository (review round 6)', () => {
  it('refuses an annotated tag OBJECT pushed by id to a branch or to any other ref', () => {
    git(sb, 'tag', '-a', 'v1', '-m', 'note');
    const tagObject = git(sb, 'rev-parse', 'v1');
    record(head);
    for (const remoteRef of ['refs/notes/z', 'refs/heads/x']) {
      const r = runHook(sb, { lines: [`${tagObject} ${tagObject} ${remoteRef} ${ZERO}`], env: words() });
      assert.notEqual(r.status, 0, `${remoteRef}: ${r.out}`);
      assert.ok(r.out.includes('pre-push: refusing to push'), r.out);
    }
    // the same by a name that is not a tag's: the object itself is what is compared with HEAD, not what it points to
    const r = runHook(sb, { lines: [`refs/heads/x ${tagObject} refs/heads/x ${ZERO}`], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: refusing to push'), r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('allows refs/heads/* only: the checked-out commit to any other ref is refused, a branch deletion passes', () => {
    record(head);
    for (const remoteRef of ['refs/notes/z', 'refs/remotes/origin/main', 'refs/for/main', 'refs/pull/1/head', 'refs/changes/01/1/1']) {
      const r = runHook(sb, { lines: [`refs/heads/main ${head} ${remoteRef} ${ZERO}`], env: words() });
      assert.notEqual(r.status, 0, `${remoteRef}: ${r.out}`);
      assert.ok(r.out.includes(`pre-push: refusing to push to ${remoteRef}: only branches (refs/heads/*) are pushed`), r.out);
    }
    assert.deepEqual(sb.calls(), []);
    const ok = runHook(sb, { lines: [`refs/heads/main ${head} refs/heads/feature/x ${ZERO}`], env: words() });
    assert.equal(ok.status, 0, ok.out);
    const del = runHook(sb, { lines: [`(delete) ${ZERO} refs/heads/old ${head}`] });
    assert.equal(del.status, 0, del.out);
    const delOther = runHook(sb, { lines: [`(delete) ${ZERO} refs/notes/old ${head}`] });
    assert.notEqual(delOther.status, 0, delOther.out);
  });

  describe('git --git-dir=A --work-tree=B inside an enclosing repository', () => {
    let work;
    let tip;
    let gitDir;
    const inner = () => ({ GIT_DIR: gitDir, GIT_WORK_TREE: work });
    beforeEach(() => {
      const outer = path.join(sb.dir, 'outer');
      work = path.join(outer, 'sub');
      mkdirSync(work, { recursive: true });
      git({ ...sb, cwd: outer }, 'init', '-q', '-b', 'main');
      writeFileSync(path.join(outer, 'o.txt'), 'outer\n');
      git({ ...sb, cwd: outer }, 'add', 'o.txt');
      git({ ...sb, cwd: outer }, 'commit', '-q', '-m', 'outer only');
      commit(sb, { 'b.txt': 'two\n' });
      tip = commit(sb, { 'c.txt': 'three\n' });
      gitDir = path.join(sb.repo, '.git');
      record(tip);
    });
    const hookIn = (env, lines) => {
      const r = spawnSync('/bin/sh', [hook, 'origin', path.join(sb.dir, 'origin.git')], { cwd: work, encoding: 'utf8', env: sb.env({ ...words(), ...env }), input: lines.map((l) => `${l}\n`).join('') });
      return { status: r.status, out: r.stdout + r.stderr };
    };

    it('the hook scans the commits of A (3), never those of the enclosing repository (1)', () => {
      const r = hookIn(inner(), [pushLine(tip)]);
      assert.equal(r.status, 0, r.out);
      assert.ok(r.out.includes('push-gate: passed (mode words, 3 commit(s))'), r.out);
    });

    it('a word in a commit of A is found even though the enclosing repository is clean', () => {
      const bad = commit(sb, { 'w.txt': `${WORD}\n` });
      record(bad);
      const r = hookIn(inner(), [pushLine(bad)]);
      assert.notEqual(r.status, 0, r.out);
      assert.ok(r.out.includes('push-gate: step scan-public: FAILED'), r.out);
    });

    it('the gate itself, run with that environment, lists the commits of A', () => {
      const r = spawnSync('/bin/sh', [gate, '--mode', 'words', '--all'], { cwd: work, encoding: 'utf8', env: sb.env({ ...words(), ...inner() }) });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok((r.stdout + r.stderr).includes('(mode words, 3 commit(s))'), r.stdout + r.stderr);
    });

    it('a GIT_DIR that names no repository stops the gate and the hook; the enclosing repository is not scanned instead', () => {
      const bogus = { GIT_DIR: path.join(sb.dir, 'no-such-dir'), GIT_WORK_TREE: work };
      const g = spawnSync('/bin/sh', [gate, '--mode', 'words', '--all'], { cwd: work, encoding: 'utf8', env: sb.env({ ...words(), ...bogus }) });
      assert.equal(g.status, 2, g.stdout + g.stderr);
      assert.ok((g.stdout + g.stderr).includes('push-gate: not inside a git repository'), g.stdout + g.stderr);
      const h = hookIn(bogus, [pushLine(tip)]);
      assert.notEqual(h.status, 0, h.out);
      assert.deepEqual(sb.calls(), []);
    });

    it('--head: the gate stops when HEAD is not the commit it was told is being pushed', () => {
      const ok = spawnSync('/bin/sh', [gate, '--mode', 'words', '--all', '--head', tip], { cwd: work, encoding: 'utf8', env: sb.env({ ...words(), ...inner() }) });
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      const bad = spawnSync('/bin/sh', [gate, '--mode', 'words', '--all', '--head', head], { cwd: work, encoding: 'utf8', env: sb.env({ ...words(), ...inner() }) });
      assert.equal(bad.status, 2, bad.stdout + bad.stderr);
      assert.ok((bad.stdout + bad.stderr).includes('push-gate: HEAD is not the commit being pushed'), bad.stdout + bad.stderr);
      const junk = spawnSync('/bin/sh', [gate, '--mode', 'words', '--all', '--head', 'main'], { cwd: work, encoding: 'utf8', env: sb.env({ ...words(), ...inner() }) });
      assert.equal(junk.status, 2, junk.stdout + junk.stderr);
      assert.ok((junk.stdout + junk.stderr).includes('push-gate: --head needs a full commit id'), junk.stdout + junk.stderr);
    });
  });

  it('the destination is asked where the push really goes: a url.<x>.insteadOf pair cannot make another repository\'s answer count', () => {
    const origin = path.join(sb.dir, 'origin.git');
    const mirror = path.join(sb.dir, 'mirror.git');
    git({ ...sb, cwd: sb.dir }, 'init', '-q', '--bare', mirror);
    const bad = commit(sb, { 'notes.txt': `${WORD}\n` });
    git(sb, 'push', '-q', '--no-verify', mirror, 'main'); // only the mirror has the commit with the word
    const tip = removeFile(sb, 'notes.txt');
    record(tip);
    git(sb, 'config', `url.${mirror}.insteadOf`, origin);
    git(sb, 'config', `url.${origin}.pushInsteadOf`, origin);
    const r = realPush({}, 'origin', 'main');
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: step scan-public: FAILED'), `the commit is scanned: ${r.out}`);
    assert.deepEqual(remoteRefs(origin), [], 'nothing reached the destination');
    assert.ok(bad);
  });

  it('SCAN_PUBLIC_CLEAN set from outside does not skip the clean environment of scan-public.sh', () => {
    commit(sb, { 'm.txt': 'x\n' }, `message with ${WORD}`);
    // a git setting that would make `git log` print in an encoding the word list cannot match, if it got in
    const hostile = { SCAN_PUBLIC_CLEAN: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'i18n.logOutputEncoding', GIT_CONFIG_VALUE_0: 'UTF-16' };
    const r = spawnSync('/bin/sh', [scanPublic, 'HEAD~1'], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ ...words(), ...hostile }) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('word list: commit message or author of'), r.stdout + r.stderr);
  });
});

describe('pre-push hook: the ways a push can send something else than what the hook was shown (real git push)', () => {
  // The hook is given one line for every ref that is really being pushed, after push.default, remote.<n>.push, --all,
  // --mirror and --follow-tags have been applied, and it is run once for every push URL of the remote.
  it('--follow-tags and push.followTags: the tag that goes along is a line of the hook, and it is refused', () => {
    git(sb, 'tag', '-a', 'v1', '-m', 'note');
    record(head);
    const origin = path.join(sb.dir, 'origin.git');
    let r = realPush({}, '--follow-tags', 'origin', 'main');
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: refusing to push a tag'), r.out);
    git(sb, 'config', 'push.followTags', 'true');
    r = realPush({}, 'origin', 'main');
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: refusing to push a tag'), r.out);
    assert.deepEqual(remoteRefs(origin), []);
  });

  it('--all pushes every branch, each a line of the hook: a branch that is not the checked-out commit refuses the push', () => {
    record(head);
    const origin = path.join(sb.dir, 'origin.git');
    git(sb, 'branch', 'same');
    assert.equal(realPush({}, '--all', 'origin').status, 0);
    assert.deepEqual(remoteRefs(origin).sort(), ['refs/heads/main', 'refs/heads/same']);
    const side = commit(sb, { 's.txt': 's\n' });
    git(sb, 'branch', 'side', side);
    git(sb, 'reset', '-q', '--hard', head);
    const r = realPush({}, '--all', 'origin');
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('not the checked-out commit'), r.out);
  });

  it('--mirror: remote-tracking refs, tags and the like are lines of the hook, and are refused', () => {
    record(head);
    git(sb, 'update-ref', 'refs/remotes/origin/main', head);
    const origin = path.join(sb.dir, 'origin.git');
    const r = realPush({}, '--mirror', 'origin');
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: refusing to push to refs/remotes/origin/main'), r.out);
    assert.deepEqual(remoteRefs(origin), []);
  });

  it('remote.<n>.push and push.default cannot send to a non-branch ref: the refspec\'s target is what the hook sees', () => {
    record(head);
    const origin = path.join(sb.dir, 'origin.git');
    git(sb, 'config', 'remote.origin.push', 'refs/heads/main:refs/notes/z');
    const r = realPush({}, 'origin');
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: refusing to push to refs/notes/z'), r.out);
    git(sb, 'config', 'remote.origin.push', 'refs/heads/main:refs/tags/x');
    const t = realPush({}, 'origin');
    assert.notEqual(t.status, 0, t.out);
    assert.ok(t.out.includes('pre-push: refusing to push a tag'), t.out);
    assert.deepEqual(remoteRefs(origin), []);
    git(sb, 'config', '--unset-all', 'remote.origin.push');
    git(sb, 'config', 'push.default', 'current');
    assert.equal(realPush({}, 'origin').status, 0);
    assert.deepEqual(remoteRefs(origin), ['refs/heads/main']);
  });

  it('several push URLs on one remote: the hook runs once per URL, and the record is for one destination only', () => {
    const origin = path.join(sb.dir, 'origin.git');
    const second = path.join(sb.dir, 'second.git');
    git({ ...sb, cwd: sb.dir }, 'init', '-q', '--bare', second);
    const bad = commit(sb, { 'notes.txt': `${WORD}\n` });
    git(sb, 'push', '-q', '--no-verify', origin, 'main');
    const tip = removeFile(sb, 'notes.txt');
    record(tip, origin);
    git(sb, 'config', 'remote.origin.pushurl', origin);
    git(sb, 'config', '--add', 'remote.origin.pushurl', second);
    const r = realPush({}, 'origin', 'main');
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: the push range changed since the review'), `the second URL is another destination: ${r.out}`);
    assert.deepEqual(remoteRefs(second), [], 'nothing reached the second destination');
    assert.ok(bad);
  });
});

describe('pre-push hook: the review is bound to the destination, the head and the exact commits (review round 8)', () => {
  const origin = () => path.join(sb.dir, 'origin.git');

  it('a record made for the push as it stands passes', () => {
    record(head);
    const r = runHook(sb, { lines: [pushLine(head)], env: words() });
    assert.equal(r.status, 0, r.out);
  });

  it('push-range prints the record value to write, and the id is a sha256 of the documented inputs only', () => {
    const r = spawnSync('/bin/sh', [rangeScript, origin()], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
    assert.equal(r.status, 0, r.stderr);
    const { id } = rangeFor();
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.ok(r.stderr.includes(`git config kaninabe.contentReviewed "${head} ${id}"`), r.stderr);
  });

  it('a record made for remote state A is refused when the remote changed: the branch was pushed, then deleted', () => {
    record(head); // the destination has nothing: the range is the whole history
    git(sb, 'push', '-q', 'origin', 'main'); // now it has the commit: the range is empty
    let r = runHook(sb, { lines: [pushLine(head)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: the push range changed since the review'), r.out);
    assert.ok(r.out.includes('0 commit(s) now'), r.out);
    assert.ok(r.out.includes('review must be redone on the new range'), r.out);
    assert.deepEqual(sb.calls(), []);
    record(head); // reviewed for state B (empty range)
    spawnSync('git', ['update-ref', '-d', 'refs/heads/main'], { cwd: origin(), env: sb.env() }); // the branch is deleted
    r = runHook(sb, { lines: [pushLine(head)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('1 commit(s) now'), r.out);
    assert.ok(!r.out.includes(WORD));
  });

  it('a record made for remote state A is refused when the remote branch was moved back', () => {
    git(sb, 'push', '-q', 'origin', 'main');
    const c2 = commit(sb, { 'b.txt': 'two\n' });
    const c3 = commit(sb, { 'c.txt': 'three\n' });
    git(sb, 'push', '-q', 'origin', 'main'); // the destination has c3
    commit(sb, { 'd.txt': 'four\n' });
    const tip = git(sb, 'rev-parse', 'HEAD');
    record(tip); // reviewed: only the tip is new
    assert.equal(runHook(sb, { lines: [pushLine(tip, c3)], env: words() }).status, 0);
    spawnSync('git', ['update-ref', 'refs/heads/main', c2], { cwd: origin(), env: sb.env() }); // moved back to c2
    const r = runHook(sb, { lines: [pushLine(tip, c3)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: the push range changed since the review'), r.out);
    assert.ok(r.out.includes('2 commit(s) now'), r.out);
  });

  it('a record made for one destination is refused for another URL', () => {
    record(head);
    const other = path.join(sb.dir, 'other.git');
    git({ ...sb, cwd: sb.dir }, 'init', '-q', '--bare', other);
    const r = runHook(sb, { lines: [pushLine(head)], env: words(), url: other });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('pre-push: the push range changed since the review'), r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('a record in the old form (the commit id alone) is refused, with the instruction', () => {
    git(sb, 'config', 'kaninabe.contentReviewed', head);
    const r = runHook(sb, { lines: [pushLine(head)], env: words() });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('the review record has the old form (a commit id only)'), r.out);
    assert.ok(r.out.includes('sh scripts/push-range.sh'), r.out);
    assert.deepEqual(sb.calls(), []);
  });

  it('the gate is told which commit list the id was computed from and stops if it scans another', () => {
    const { args, id } = rangeFor();
    assert.ok(id);
    const listId = /--list-id ([0-9a-f]{64})/.exec(args)?.[1];
    assert.ok(listId, `no list id in the gate arguments: ${args}`);
    const base = ['--mode', 'words', ...args.replace(/ --list-id \S+/, '').split(' ')];
    const ok = runGate(sb, [...base, '--list-id', listId], words());
    assert.equal(ok.status, 0, ok.out);
    const bad = runGate(sb, [...base, '--list-id', '0'.repeat(64)], words());
    assert.equal(bad.status, 2, bad.out);
    assert.ok(bad.out.includes('push-gate: the commits to scan are not the list the range id was computed from'), bad.out);
    commit(sb, { 'later.txt': 'x\n' }); // the list now has another commit: the id of the earlier list no longer fits
    const stale = runGate(sb, [...base, '--list-id', listId], words());
    assert.equal(stale.status, 2, stale.out);
  });
});

describe('push-gate.sh: a result that cannot be read is not "zero findings", and public output carries counts only (review rounds 8 and 10)', () => {
  const env = (extra) => ({ ...words(), CI: 'true', ...extra });

  it('a gitleaks exit for findings with no report, an empty report or a report that does not parse is "could not read the result" (2), not findings', () => {
    for (const report of [undefined, '\n', 'not a finding line\n']) {
      const e = { SHIM_GITLEAKS_EXIT: '99' };
      if (report !== undefined) e.SHIM_REPORT_gitleaks = report;
      const r = runGate(sb, ['--mode', 'words', '--all'], env(e));
      assert.equal(r.status, 2, `${JSON.stringify(report)}: ${r.out}`);
      assert.ok(r.out.includes('push-gate: step gitleaks could not read the result'), r.out);
      assert.ok(!r.out.includes('FAILED (0 finding'), r.out);
    }
  });

  it('an actionlint exit for problems with no readable output is "could not read the result" (2)', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    const r = runGate(sb, ['--mode', 'words', '--all'], env({ SHIM_ACTIONLINT_EXIT: '1' }));
    assert.equal(r.status, 2, r.out);
    assert.ok(r.out.includes('push-gate: step workflows could not read the result'), r.out);
  });

  it('nothing derived from the output of a tool is printed in CI: no rule or kind names, only counts', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    const r = runGate(sb, ['--mode', 'words', '--all'], env({
      SHIM_GITLEAKS_EXIT: '99',
      SHIM_REPORT_gitleaks: 'x\nx\n',
      SHIM_ACTIONLINT_EXIT: '1',
      SHIM_OUT_actionlint: '.github/workflows/ci.yml:3: [Evil Kind!]|.github/workflows/ci.yml:4: [syntax-check]|',
    }));
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('(4 finding(s) in patches, 2 in commit messages, 2 in the tree of HEAD)'), r.out);
    assert.ok(r.out.includes('push-gate: step workflows: FAILED (2 problem(s))'), r.out);
    for (const leak of ['Evil', 'syntax-check', 'rule ', 'ci.yml']) assert.ok(!r.out.includes(leak), `"${leak}" reached the public output: ${r.out}`);
  });
});

describe('gitleaks-public.sh (the old CI steps): counts only, and an unreadable result is not "ok" (review rounds 8 and 10)', () => {
  const wrapper = path.join(scripts, 'gitleaks-public.sh');
  const fake = (exitCode, report) => {
    const f = path.join(sb.dir, 'fake-gitleaks');
    writeFileSync(f, `#!/bin/sh\nprev=\nfor a in "$@"; do [ "$prev" != --report-path ] || ${report === undefined ? ':' : `printf '%s' ${shq(report)} > "$a"`}; prev=$a; done\nexit ${exitCode}\n`);
    chmodSync(f, 0o755);
    return f;
  };
  const wrap = (mode, bin, target = sb.repo) => {
    const r = spawnSync('/bin/sh', [wrapper, mode, target], { cwd: target, encoding: 'utf8', env: sb.env({ GL_BIN: bin }) });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  it('prints a count and nothing derived from the output of the tool', () => {
    const r = wrap('dir', fake(99, 'x\nx\nx\n'));
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('gitleaks dir: FAILED (3 finding(s))'), r.out);
    assert.ok(!/rule /.test(r.out), r.out);
    const bad = wrap('dir', fake(99, 'github-pat\nEvil Text; rm -rf\n'));
    assert.equal(bad.status, 2, `a report that is not what the template writes is unreadable: ${bad.out}`);
    assert.ok(bad.out.includes('could not read the result'), bad.out);
    for (const leak of ['github-pat', 'Evil', 'rm -rf']) assert.ok(!bad.out.includes(leak), bad.out);
  });

  it('findings with no report or an empty report are "could not read the result" (2), never zero findings', () => {
    for (const mode of ['dir', 'git']) {
      for (const report of [undefined, '\n']) {
        const r = wrap(mode, fake(99, report));
        assert.equal(r.status, 2, `${mode} ${JSON.stringify(report)}: ${r.out}`);
        assert.ok(r.out.includes(`gitleaks ${mode}: could not read the result`), r.out);
        assert.ok(!r.out.includes('0 finding'), r.out);
      }
    }
  });

  it('runs the tool with the fixed config and the neutralising flags, on a copy without .gitleaksignore (dir) or on the neutral repository (git)', () => {
    writeFileSync(path.join(sb.repo, '.gitleaksignore'), 'x:y:z:1\n');
    const logfile = path.join(sb.dir, 'args.log');
    const f = path.join(sb.dir, 'logging-gitleaks');
    writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${shq(logfile)}\n[ "$1" != git ] || echo "6:02PM INF 1 commits scanned." >&2\nfor a in "$@"; do case $a in .*|/*) [ ! -e "$a/.gitleaksignore" ] || echo "IGNOREFILE $a" >> ${shq(logfile)} ;; esac; done\nexit 0\n`);
    chmodSync(f, 0o755);
    for (const mode of ['dir', 'git']) assert.equal(wrap(mode, f).status, 0);
    const log = readFileSync(logfile, 'utf8');
    assert.ok(!log.includes('IGNOREFILE'), `an ignore file was in the scanned source: ${log}`);
    for (const line of log.split('\n').filter(Boolean)) {
      assert.ok(line.includes('gitleaks-public.toml') && !line.includes('push-gate.gitleaks.toml') && line.includes('--ignore-gitleaks-allow') && line.includes('--gitleaks-ignore-path'), line);
    }
    const gits = log.split('\n').filter((l) => l.startsWith('git '));
    assert.equal(gits.length, git(sb, 'rev-list', 'HEAD').split('\n').length, `one history run per commit: ${log}`);
    for (const l of gits) assert.ok(/--log-opts=-1 -m [0-9a-f]{40} /.test(l), `a run is not for one commit id: ${l}`);
  });
});

describe('gitleaks-public.sh git: a history that cannot be read is exit 2, never ok (review round 9, L1)', () => {
  const wrapper = path.join(scripts, 'gitleaks-public.sh');
  const okTool = () => {
    const f = path.join(sb.dir, 'ok-gitleaks');
    writeFileSync(f, '#!/bin/sh\n[ "$1" != git ] || echo "6:02PM INF 1 commits scanned." >&2\nexit 0\n');
    chmodSync(f, 0o755);
    return f;
  };
  const wrapIn = (target) => {
    const r = spawnSync('/bin/sh', [wrapper, 'git', target], { cwd: target, encoding: 'utf8', env: sb.env({ GL_BIN: okTool() }) });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const gitIn = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', ...args], { cwd, encoding: 'utf8', env: sb.env() });

  it('prints the wall time in whole seconds, as numbers only, in git and dir mode (review round 12, C1a)', () => {
    for (const mode of ['git', 'dir']) {
      const f = path.join(sb.dir, 'time-gitleaks');
      writeFileSync(f, '#!/bin/sh\n[ "$1" != git ] || echo "6:02PM INF 1 commits scanned." >&2\nexit 0\n');
      chmodSync(f, 0o755);
      const r = spawnSync('/bin/sh', [wrapper, mode, sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: f }) });
      assert.ok(new RegExp(`^gitleaks ${mode}: ok in \\d+ s$`, 'm').test(r.stdout + r.stderr), `${mode}: ${r.stdout + r.stderr}`);
      const bad = path.join(sb.dir, 'time-bad-gitleaks');
      writeFileSync(bad, `#!/bin/sh\n[ "$1" != git ] || echo "6:02PM INF 1 commits scanned." >&2\nprev=; for a in "$@"; do [ "$prev" != --report-path ] || echo x > "$a"; prev=$a; done\nexit 99\n`);
      chmodSync(bad, 0o755);
      const b = spawnSync('/bin/sh', [wrapper, mode, sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: bad }) });
      assert.ok(new RegExp(`^gitleaks ${mode}: FAILED \\(\\d+ finding\\(s\\)\\) in \\d+ s$`, 'm').test(b.stdout + b.stderr), `${mode}: ${b.stdout + b.stderr}`);
    }
  });

  it('a date that fails or prints text that is not a number stops the wrapper (2) with a fixed reason (review round 13, Q3)', () => {
    for (const body of ['exit 1', 'echo "Mon Jan  1 SECRETTEXT"']) {
      rmSync(path.join(sb.bin, 'date'), { force: true });
      writeFileSync(path.join(sb.bin, 'date'), `#!/bin/sh\n${body}\n`);
      chmodSync(path.join(sb.bin, 'date'), 0o755);
      for (const mode of ['git', 'dir']) {
        const f = path.join(sb.dir, 'clock-gitleaks');
        writeFileSync(f, '#!/bin/sh\n[ "$1" != git ] || echo "6:02PM INF 1 commits scanned." >&2\nexit 0\n');
        chmodSync(f, 0o755);
        const r = spawnSync('/bin/sh', [wrapper, mode, sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: f }) });
        assert.equal(r.status, 2, `${mode}: ${r.stdout + r.stderr}`);
        assert.ok((r.stdout + r.stderr).includes(`gitleaks ${mode}: could not run (could not read the clock)`), r.stdout + r.stderr);
        assert.ok(!(r.stdout + r.stderr).includes('SECRETTEXT'), r.stdout + r.stderr);
      }
    }
  });

  it('what the tool says it scanned must fit each commit: a commit with text that is not 1 scanned (0, 2, no number) is exit 2', () => {
    for (const line of ['6:02PM INF 0 commits scanned.', '6:02PM INF 2 commits scanned.', '6:02PM INF done']) {
      const f = path.join(sb.dir, 'count-gitleaks');
      writeFileSync(f, `#!/bin/sh\n[ "$1" != git ] || echo ${shq(line)} >&2\nexit 0\n`);
      chmodSync(f, 0o755);
      const r = spawnSync('/bin/sh', [wrapper, 'git', sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: f }) });
      assert.equal(r.status, 2, `${line}: ${r.stdout + r.stderr}`);
      assert.ok((r.stdout + r.stderr).includes('gitleaks git: could not confirm what it scanned'), r.stdout + r.stderr);
      assert.ok(!(r.stdout + r.stderr).includes('gitleaks git: ok'), r.stdout + r.stderr);
    }
  });

  it('a SHA-256 repository stops (exit 2)', () => {
    const d = path.join(sb.dir, 'sha256-for-wrapper');
    mkdirSync(d);
    gitIn(d, 'init', '-q', '--object-format=sha256', '-b', 'main');
    writeFileSync(path.join(d, 'a.txt'), 'x\n');
    gitIn(d, 'add', 'a.txt');
    gitIn(d, 'commit', '-q', '-m', 'x');
    const r = wrapIn(d);
    assert.equal(r.status, 2, r.out);
    said(r, 'gitleaks git: could not run (exit 2)'); // (the wrapper does not print the reason of the shared setup check: the same line for a shallow clone)
    assert.ok(!r.out.includes('gitleaks git: ok'), r.out);
  });

  it('a shallow clone stops (exit 2)', () => {
    commit(sb, { 'b.txt': 'two\n' });
    commit(sb, { 'c.txt': 'three\n' });
    const d = path.join(sb.dir, 'shallow-for-wrapper');
    git({ ...sb, cwd: sb.dir }, 'clone', '-q', '--depth', '1', `file://${sb.repo}`, d);
    const r = wrapIn(d);
    assert.equal(r.status, 2, r.out);
    said(r, 'gitleaks git: could not run (exit 2)');
    assert.ok(!r.out.includes('gitleaks git: ok'), r.out);
  });

  it('commits that cannot be listed (a missing parent object) stop it (exit 2)', () => {
    const first = git(sb, 'rev-list', '--max-parents=0', 'HEAD');
    commit(sb, { 'b.txt': 'two\n' });
    rmSync(path.join(sb.repo, '.git/objects', first.slice(0, 2), first.slice(2)), { force: true });
    const r = wrapIn(sb.repo);
    assert.equal(r.status, 2, r.out);
    said(r, 'gitleaks git: could not run (exit 2)');
    assert.ok(!r.out.includes('gitleaks git: ok'), r.out);
  });

  it('a repository that truly has no commits is ok', () => {
    const d = path.join(sb.dir, 'empty-for-wrapper');
    mkdirSync(d);
    gitIn(d, 'init', '-q', '-b', 'main');
    const r = wrapIn(d);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('gitleaks git: ok'), r.out);
  });
});

describe('the review record and the range id are checked with one shape (review round 9, L3)', () => {
  const idShape = '0'.repeat(64);
  /** A copy of the hook and the scripts whose push-range prints what the test wants. */
  const hookWithRange = (printed) => {
    const root = path.join(sb.dir, 'copy');
    mkdirSync(path.join(root, '.githooks'), { recursive: true });
    cpSync(hook, path.join(root, '.githooks', 'pre-push'));
    cpSync(scripts, path.join(root, 'scripts'), { recursive: true });
    writeFileSync(path.join(root, 'scripts', 'push-range.sh'), `#!/bin/sh\nprintf '%s\\n' '--all' ${shq(printed)} 'commits=1'\n`);
    return path.join(root, '.githooks', 'pre-push');
  };
  const runCopy = (copy, lines) => {
    const r = spawnSync('/bin/sh', [copy, 'origin', path.join(sb.dir, 'origin.git')], { cwd: sb.repo, encoding: 'utf8', env: sb.env(words()), input: lines.map((l) => `${l}\n`).join('') });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  it('a range id that push-range printed empty or malformed stops the push (not equal to anything)', () => {
    for (const printed of ['range-id=', 'range-id=ABC', `range-id=${'A'.repeat(64)}`, `range-id=${idShape}0`]) {
      git(sb, 'config', 'kaninabe.contentReviewed', `${head} ${printed.replace('range-id=', '')}`);
      const r = runCopy(hookWithRange(printed), [pushLine(head)]);
      assert.notEqual(r.status, 0, `${printed}: ${r.out}`);
      assert.ok(r.out.includes('push-range did not print a valid range id'), `${printed}: ${r.out}`);
      assert.deepEqual(sb.calls(), []);
    }
  });

  it('a recorded value that is not a lowercase 64-hex id is refused as malformed, whatever the push-range id is', () => {
    const real = rangeFor().id;
    for (const bad of ['', 'xyz', real.toUpperCase(), real.slice(0, 63), `${real}0`, `${real} extra`]) {
      git(sb, 'config', 'kaninabe.contentReviewed', `${head} ${bad}`);
      const r = runHook(sb, { lines: [pushLine(head)], env: words() });
      assert.notEqual(r.status, 0, `"${bad}": ${r.out}`);
      assert.ok(r.out.includes('the review record is malformed') || r.out.includes('the review record has the old form'), `"${bad}": ${r.out}`);
      assert.deepEqual(sb.calls(), []);
    }
  });
});

describe('gitleaks-public.sh dir: a failing archive step is exit 2 (review round 9, L4)', () => {
  it('a tar that fails while writing the archive stops the scan instead of scanning an empty copy', () => {
    const real = which('tar');
    rmSync(path.join(sb.bin, 'tar'));
    writeFileSync(path.join(sb.bin, 'tar'), `#!/bin/sh\nfor a in "$@"; do case $a in -cf) ${real} -cf - -T /dev/null; echo "tar: failed" >&2; exit 2 ;; esac; done\nexec ${real} "$@"\n`);
    chmodSync(path.join(sb.bin, 'tar'), 0o755);
    const f = path.join(sb.dir, 'ok-gitleaks2');
    writeFileSync(f, '#!/bin/sh\nexit 0\n');
    chmodSync(f, 0o755);
    const r = spawnSync('/bin/sh', [path.join(scripts, 'gitleaks-public.sh'), 'dir', sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: f }) });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    said(r, 'gitleaks dir: could not run (exit 2)');
    assert.ok(!(r.stdout + r.stderr).includes('gitleaks dir: ok'), r.stdout + r.stderr);
  });
});

describe('an error in the gitleaks log is "could not run", even when it exits 0 or reports findings (review round 10, M3)', () => {
  const wrapper = path.join(scripts, 'gitleaks-public.sh');
  for (const [label, line] of [['plain', '6:02PM ERR [stdin] boom error="x"'], ['coloured', '\\033[90m6:02PM\\033[0m \\033[31mERR\\033[0m boom'], ['fatal', '6:02PM FTL something']]) {
    it(`the gate stops (2) on a ${label} ERR/FTL line, with exit 0 and with findings`, () => {
      for (const extra of [{}, { SHIM_GITLEAKS_EXIT: '99', SHIM_REPORT_gitleaks: HIT }]) {
        const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), ...extra, SHIM_STDERR_gitleaks: line });
        assert.equal(r.status, 2, r.out);
        assert.ok(r.out.includes('push-gate: step gitleaks could not run (it logged an error)'), r.out);
        assert.ok(!r.out.includes('boom'), 'the log is not printed');
      }
    });
    it(`the old-step wrapper stops (2) on a ${label} ERR/FTL line (git and dir)`, () => {
      const f = path.join(sb.dir, 'err-gitleaks');
      writeFileSync(f, `#!/bin/sh\nprintf '%b\\n' ${shq(line)} >&2\nexit 0\n`);
      chmodSync(f, 0o755);
      for (const mode of ['git', 'dir']) {
        const r = spawnSync('/bin/sh', [wrapper, mode, sb.repo], { cwd: sb.repo, encoding: 'utf8', env: sb.env({ GL_BIN: f }) });
        assert.equal(r.status, 2, `${mode}: ${r.stdout + r.stderr}`);
        assert.ok((r.stdout + r.stderr).includes(`gitleaks ${mode}: could not run (it logged an error)`), r.stdout + r.stderr);
        assert.ok(!(r.stdout + r.stderr).includes('boom'), 'the log is not printed');
      }
    });
  }
  it('INF and WRN lines are not errors', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_STDERR_gitleaks: '6:02PM WRN leaks found: 0\\n6:02PM INF done' });
    assert.equal(r.status, 0, r.out);
  });
});

describe('the scans stop for a repository they cannot read, instead of scanning less (review round 8)', () => {
  it('a sha256 repository stops the gate and push-range (the neutral repository is sha1)', () => {
    const dirSha256 = path.join(sb.dir, 'sha256');
    mkdirSync(dirSha256);
    const run = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', ...args], { cwd, encoding: 'utf8', env: sb.env() });
    run(dirSha256, 'init', '-q', '--object-format=sha256', '-b', 'main');
    writeFileSync(path.join(dirSha256, 'a.txt'), 'x\n');
    run(dirSha256, 'add', 'a.txt');
    run(dirSha256, 'commit', '-q', '-m', 'x');
    const g = spawnSync('/bin/sh', [gate, '--mode', 'words', '--all'], { cwd: dirSha256, encoding: 'utf8', env: sb.env(words()) });
    assert.equal(g.status, 2, g.stdout + g.stderr);
    said(g, 'push-gate: this repository does not use SHA-1 object names');
    assert.ok(!(g.stdout + g.stderr).includes('push-gate: passed'));
    const rg = spawnSync('/bin/sh', [rangeScript, path.join(sb.dir, 'origin.git')], { cwd: dirSha256, encoding: 'utf8', env: sb.env() });
    assert.equal(rg.status, 2, rg.stdout + rg.stderr);
    said(rg, 'push-range: this repository does not use SHA-1 object names');
  });
});
}

// ---- the setup script ----

{
const supported = process.platform === 'linux' && process.arch === 'x64';
let sb;
let mirror;
let target;
beforeEach(() => {
  sb = sandbox();
  commit(sb, { 'a.txt': 'one\n' });
  mirror = path.join(sb.dir, 'mirror');
  target = path.join(sb.dir, 'tools');
  mkdirSync(mirror);
});
afterEach(() => sb.cleanup());

const setup = (args, env = {}) => {
  const r = spawnSync('/bin/sh', [setupScript, ...args], { cwd: sb.repo, encoding: 'utf8', env: sb.env(env) });
  return { status: r.status, out: r.stdout + r.stderr };
};

describe('setup-dev-env.sh', { skip: !supported && 'the pinned tools are for linux x64' }, () => {
  it('refuses a download whose checksum is not the pinned one, installs nothing and sets no hook', () => {
    writeFileSync(path.join(mirror, 'gitleaks_8.30.0_linux_x64.tar.gz'), 'not the real archive');
    writeFileSync(path.join(mirror, 'actionlint_1.7.7_linux_amd64.tar.gz'), 'not the real archive');
    const r = setup(['--bin-dir', target], { SETUP_DEV_ENV_MIRROR: `file://${mirror}` });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('setup-dev-env: checksum mismatch for gitleaks'), r.out);
    assert.ok(!existsSync(target) || readdirSync(target).length === 0, 'nothing is installed');
    const hooks = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: sb.repo, encoding: 'utf8', env: sb.env() });
    assert.notEqual(hooks.stdout.trim(), '.githooks', 'the hook path is set only after the tools are in');
  });

  it('exits non-zero with a reason when a download cannot be fetched', () => {
    const r = setup(['--bin-dir', target], { SETUP_DEV_ENV_MIRROR: `file://${path.join(sb.dir, 'absent')}` });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('setup-dev-env: could not download gitleaks'), r.out);
  });

  it('accepts --no-hooks and --no-path-check (for a CI job that only needs the tools) and still refuses a bad download', () => {
    writeFileSync(path.join(mirror, 'gitleaks_8.30.0_linux_x64.tar.gz'), 'not the real archive');
    const r = setup(['--bin-dir', target, '--no-hooks', '--no-path-check'], { SETUP_DEV_ENV_MIRROR: `file://${mirror}` });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('setup-dev-env: checksum mismatch for gitleaks'), r.out);
  });

  it('rejects an unknown option', () => {
    const r = setup(['--nonsense']);
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.out.includes('setup-dev-env: unknown argument'), r.out);
  });
});
}

// ---- the CI definition and the scripts directory after the scanner change (E1) ----

describe('ci.yml keeps the old key-scan wrapper as a named exception, and no longer scans the pull request text (E1)', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
  /** The lines of a workflow that are not comments. */
  const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l));
  const ci = code(read('.github/workflows/ci.yml'));

  // The named exception (old check, removed in the follow-up after the first green run on dev; development-flow.md "検査を入れ替えるとき",
  // known-gaps 15): the one step "Scan the whole tree and the history" calls scripts/gitleaks-public.sh, in the two modes and nowhere else.
  it('calls scripts/gitleaks-public.sh only in the step "Scan the whole tree and the history", in the modes dir and git (old check, removed in the follow-up after the first green run on dev)', () => {
    assert.deepEqual(ci.filter((l) => l.includes('gitleaks-public.sh')).map((l) => l.trim()), [
      'GL_BIN=./gitleaks sh scripts/gitleaks-public.sh dir .',
      'GL_BIN=./gitleaks sh scripts/gitleaks-public.sh git .',
    ]);
    const i = ci.findIndex((l) => l.includes('- name: Scan the whole tree and the history'));
    assert.ok(i >= 0, 'the step is there');
    assert.ok(ci.slice(i + 1, i + 8).filter((l) => l.includes('gitleaks-public.sh')).length === 2, 'both calls are in that step');
  });
  it('does not call scripts/scan-pr-text.sh (pr-gate.yml scans the title and body)', () => {
    assert.deepEqual(ci.filter((l) => l.includes('scan-pr-text.sh')), []);
    assert.ok(code(read('.github/workflows/pr-gate.yml')).some((l) => l.includes('scan-pr-text.sh')), 'pr-gate.yml must keep scanning the title and body');
  });
  it('the pull_request trigger has no `edited` type', () => {
    const start = ci.findIndex((l) => /^ {2}pull_request:\s*$/.test(l));
    assert.ok(start >= 0, 'ci.yml has a pull_request trigger');
    const block = [];
    for (let i = start + 1; i < ci.length && /^ {4}/.test(ci[i]); i += 1) block.push(ci[i]);
    assert.deepEqual(block.filter((l) => /\bedited\b/.test(l)), []);
  });
  it('scripts/gitleaks-public.sh exists (the old check kept on purpose, removed in the follow-up after the first green run on dev)', () => {
    assert.equal(existsSync(path.join(scripts, 'gitleaks-public.sh')), true);
  });
  it('(guard) the word-scan step with scripts/scan-public.sh stays', () => {
    assert.ok(ci.some((l) => l.includes('scripts/scan-public.sh')), 'the old word step must stay');
  });
});
