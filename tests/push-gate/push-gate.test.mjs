/**
 * Tests of the push-before gate: scripts/push-gate.sh, .githooks/pre-push and scripts/setup-dev-env.sh.
 *
 * The gate stops for the stated reason (the tests read the reason line, not just the exit code); a scan that cannot
 * run is never a pass; every commit of the range is scanned, the intermediate ones too; the output never repeats a
 * matched word. The hook refuses anything but the checked-out commit, wants the content review record to name it,
 * and always runs the gate in words mode. The setup script refuses a download whose checksum is not the pinned one.
 *
 * Each test builds a throwaway git repository under a temp dir, with a PATH that holds a short list of ordinary tools
 * and fake `gitleaks` / `actionlint` whose behaviour the test controls, so the gate's own logic is what is tested
 * (exit 1 = the gate found something; exit 2 = it could not run a step). The only word used in word lists is invented
 * and harmless. (One file: the import fence lets tests import only node: built-ins and scripts/ or bin/.)
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

const SHIM_BODY = (name, exitVar) => `#!/bin/sh
printf '%s\\n' "${name} $* #env:\${GITLEAKS_CONFIG-unset}:\${GITLEAKS_CONFIG_TOML-unset}" >> "$SHIM_LOG"
[ -z "\${SHIM_OUT_${name}:-}" ] || printf '%s' "\${SHIM_OUT_${name}}"
exit "\${${exitVar}:-0}"
`;

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
    env: (extra = {}) => ({
      PATH: bin,
      HOME: path.join(dir, 'home'),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      LC_ALL: 'C',
      SHIM_LOG: sb.log,
      ...extra,
    }),
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
function runHook(sb, { remote = 'origin', lines = [], env = {}, url } = {}) {
  const input = lines.map((l) => `${l}\n`).join('');
  // Git passes the URL it pushes to; by default, the remote's own URL when there is one.
  const own = spawnSync('git', ['remote', 'get-url', remote], { cwd: sb.repo, encoding: 'utf8' });
  const r = spawnSync('/bin/sh', [hook, remote, url ?? (own.status === 0 ? own.stdout.trim() : 'unused-url')], { cwd: sb.repo, encoding: 'utf8', env: sb.env(env), input });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** One stdin line of the hook for pushing `sha` to `refs/heads/main`. */
const pushLine = (sha, remoteSha = ZERO) => `refs/heads/main ${sha} refs/heads/main ${remoteSha}`;


// ---- the gate ----

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
    const reason = 'push-gate: exactly one of --base, --not-on-remote, --all is required';
    stops(runGate(sb, ['--mode', 'general']), 2, reason);
    stops(runGate(sb, ['--mode', 'general', '--all', '--base', 'HEAD']), 2, reason);
    stops(runGate(sb, ['--mode', 'general', '--base']), 2, 'push-gate: --base needs a value');
    stops(runGate(sb, ['--mode', 'general', '--nonsense']), 2, 'push-gate: unknown argument');
    assert.deepEqual(sb.calls(), []);
  });

  it('refuses a base that is not a commit and a remote name that is not a name', () => {
    stops(runGate(sb, ['--mode', 'general', '--base', 'no-such-ref']), 2, 'push-gate: --base is not a commit of this repository');
    stops(runGate(sb, ['--mode', 'general', '--not-on-remote', '--all']), 2, 'push-gate: not a valid remote name');
    stops(runGate(sb, ['--mode', 'general', '--not-on-remote', 'a b']), 2, 'push-gate: not a valid remote name');
    stops(runGate(sb, ['--mode', 'general', '--not-on-remote', '-x']), 2, 'push-gate: not a valid remote name');
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
    let r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99' });
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
    assert.ok(call.includes('--no-banner') && call.includes('--redact') && call.includes('--log-opts='), call);
  });

  it('actionlint reporting a problem fails the gate; actionlint erroring stops it', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    let r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_ACTIONLINT_EXIT: '1' });
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
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99' });
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

  it('--not-on-remote leaves out commits that the remote already has', () => {
    commit(sb, { 'notes.txt': `${WORD}\n` });
    addRemote(sb);
    git(sb, 'push', '-q', 'origin', 'main');
    removeFile(sb, 'notes.txt');
    commit(sb, { 'b.txt': 'two\n' });
    const r = runGate(sb, ['--mode', 'words', '--not-on-remote', 'origin'], words());
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('(mode words, 2 commit(s))'), r.out);
  });

  it('--not-on-remote takes every commit when the remote has no tracking refs (the fail-safe)', () => {
    commit(sb, { 'notes.txt': `${WORD}\n` });
    removeFile(sb, 'notes.txt');
    addRemote(sb);
    const r = runGate(sb, ['--mode', 'words', '--not-on-remote', 'origin'], words());
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('2 commit(s)'), r.out);
    const unknown = runGate(sb, ['--mode', 'words', '--not-on-remote', 'nowhere'], words());
    assert.equal(unknown.status, 1, 'a remote that does not exist knows no commit: all are scanned');
  });

  it('--not-on-remote does not count commits that only another remote has', () => {
    const first = commit(sb, { 'notes.txt': `${WORD}\n` });
    addRemote(sb, 'origin');
    addRemote(sb, 'other');
    git(sb, 'update-ref', 'refs/remotes/other/main', first);
    commit(sb, { 'b.txt': 'two\n' });
    const r = runGate(sb, ['--mode', 'words', '--not-on-remote', 'origin'], words());
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('2 commit(s)'), r.out);
  });

  it('an empty range passes the scans, but the workflow check still runs', () => {
    commit(sb, { '.github/workflows/ci.yml': 'name: x\n' });
    const r = runGate(sb, ['--mode', 'words', '--base', 'HEAD'], words());
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('(mode words, 0 commit(s))'), r.out);
    const calls = sb.calls();
    assert.ok(!calls.some((l) => l.startsWith('gitleaks')), 'nothing to scan for secrets');
    assert.ok(calls.some((l) => l.startsWith('actionlint')), 'the workflows are still checked');
    const bad = runGate(sb, ['--mode', 'words', '--base', 'HEAD'], { ...words(), SHIM_ACTIONLINT_EXIT: '1' });
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

  it('asks gitleaks for the history with merges diffed, each commit message, and the tree of HEAD', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 0, r.out);
    const calls = sb.calls();
    assert.ok(calls.some((l) => l.startsWith('gitleaks git') && l.includes('--log-opts=-m HEAD')), calls.join('\n'));
    assert.equal(calls.filter((l) => l.startsWith('gitleaks stdin')).length, 2, 'one per commit message');
    assert.ok(calls.some((l) => l.startsWith('gitleaks dir')), calls.join('\n'));
  });

  it('closes every way a file in the tree could change what gitleaks reads: fixed config, no ignore file, no inline allow', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), GITLEAKS_CONFIG: '/nonexistent/allow.toml', GITLEAKS_CONFIG_TOML: 'x' });
    assert.equal(r.status, 0, r.out);
    const calls = sb.calls().filter((l) => l.startsWith('gitleaks '));
    assert.equal(calls.length, 4, 'git, stdin x2, dir');
    for (const call of calls) {
      assert.ok(call.includes('--config') && call.includes('gitleaks-gate.toml'), `no fixed config: ${call}`);
      assert.ok(call.includes('--gitleaks-ignore-path'), `no ignore path: ${call}`);
      assert.ok(call.includes('--ignore-gitleaks-allow'), `inline allow honoured: ${call}`);
      assert.ok(call.endsWith('#env:unset:unset'), `the config environment variables reach gitleaks: ${call}`);
    }
  });

  it('names where gitleaks found something without printing it: messages and the tree are reported by place', () => {
    const r = runGate(sb, ['--mode', 'words', '--all'], { ...words(), SHIM_GITLEAKS_EXIT: '99' });
    assert.equal(r.status, 1, r.out);
    assert.equal((r.out.match(/commit message of [0-9a-f]{8}/g) ?? []).length, 2, r.out);
    assert.ok(r.out.includes('tree of HEAD'), r.out);
    assert.ok(r.out.includes('push-gate: step gitleaks: FAILED'), r.out);
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

  it('in CI the public output is rule names and counts only; locally it names places', () => {
    commit(sb, { 'notes.txt': `${WORD}\n`, '.github/workflows/ci.yml': 'name: x\n' });
    const env = { ...words(), SHIM_ACTIONLINT_EXIT: '1', SHIM_OUT_actionlint: '.github/workflows/ci.yml:3: [syntax-check]|' };
    const ci = runGate(sb, ['--mode', 'words', '--all'], { ...env, CI: 'true' });
    assert.equal(ci.status, 1, ci.out);
    assert.ok(ci.out.includes('word list: 1 file(s)'), ci.out);
    assert.ok(ci.out.includes('rule syntax-check: 1'), ci.out);
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

const record = (sha) => git(sb, 'config', 'kaninabe.contentReviewed', sha);
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
    assert.ok(r.out.includes(`git config kaninabe.contentReviewed ${head}`), r.out);
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

  it('uses --not-on-remote only when the pushed URL is both the fetch URL and the push URL', () => {
    git(sb, 'update-ref', 'refs/remotes/origin/main', head);
    const next = commit(sb, { 'b.txt': 'two\n' });
    record(next);
    const fetchUrl = git(sb, 'remote', 'get-url', 'origin');
    let r = runHook(sb, { lines: [pushLine(next, head)], env: words(), url: fetchUrl });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('(mode words, 1 commit(s))'), `commits the remote has are left out: ${r.out}`);
    const other = path.join(sb.dir, 'elsewhere.git');
    git({ ...sb, cwd: sb.dir }, 'init', '-q', '--bare', other);
    git(sb, 'config', 'remote.origin.pushurl', other);
    r = runHook(sb, { lines: [pushLine(next, head)], env: words(), url: other });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('(mode words, 2 commit(s))'), `a push URL that differs from the fetch URL scans everything: ${r.out}`);
    r = runHook(sb, { lines: [pushLine(next, head)], env: words(), url: 'https://example.invalid/x.git' });
    assert.ok(r.out.includes('(mode words, 2 commit(s))'), `a URL that is neither scans everything: ${r.out}`);
  });

  it('refuses a tag push with the reason, and lets a tag deletion through', () => {
    git(sb, 'tag', '-a', 'v1', '-m', 'note');
    const tagObject = git(sb, 'rev-parse', 'v1');
    record(head);
    for (const sha of [tagObject, head]) {
      const r = runHook(sb, { lines: [`refs/tags/v1 ${sha} refs/tags/v1 ${ZERO}`], env: words() });
      assert.notEqual(r.status, 0, r.out);
      assert.ok(r.out.includes('pre-push: refusing to push a tag'), r.out);
      assert.ok(r.out.includes('tags are created only by the tag workflow'), r.out);
    }
    assert.deepEqual(sb.calls(), []);
    const del = runHook(sb, { lines: [`(delete) ${ZERO} refs/tags/v1 ${tagObject}`] });
    assert.equal(del.status, 0, del.out);
  });

  it('with nothing to push, does nothing', () => {
    const r = runHook(sb, { lines: [] });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(sb.calls(), []);
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
