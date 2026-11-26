/**
 * Tests of scripts/push-gate.sh with the REAL gitleaks and actionlint (the other file uses fakes, which cannot show
 * that the gate asks the real tools the right questions). These tests do not skip: without the two tools on PATH they
 * fail with one line saying how to install them (scripts/setup-dev-env.sh).
 *
 * Fake keys are assembled at run time from pieces and written only into throwaway repositories, so no key-shaped text
 * is committed here (push protection and the secret scan of this repository stay quiet on this file).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gate = fileURLToPath(new URL('../../scripts/push-gate.sh', import.meta.url));
const CORE = [
  'sh', 'git', 'grep', 'sed', 'cut', 'wc', 'tr', 'head', 'tail', 'mktemp', 'rm', 'cat', 'dirname', 'basename', 'tar',
  'awk', 'sort', 'uniq', 'mkdir', 'ls', 'find', 'env', 'true', 'false', 'cp', 'mv', 'date', 'less',
];

const find = (name, searchPath) => {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: { PATH: searchPath } });
  const p = r.stdout.trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
};
const SYSTEM = '/usr/bin:/bin:/usr/local/bin';
const real = {
  gitleaks: find('gitleaks', process.env.PATH ?? ''),
  actionlint: find('actionlint', process.env.PATH ?? ''),
};
const missing = Object.entries(real).filter(([, p]) => !p).map(([n]) => n);
const reason = `${missing.join(' and ')} not installed: run "sh scripts/setup-dev-env.sh --bin-dir <dir on PATH>" first`;

/** A fake key built from pieces; every call gives a new one. */
const fakeKey = () => ['gh', 'p_'].join('') + randomBytes(60).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 36).padEnd(36, 'x');

let dir;
let repo;
let bin;
const env = (extra = {}) => ({
  PATH: bin, HOME: path.join(dir, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', ...extra,
});
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env(), PATH: process.env.PATH } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (files, message = 'change') => {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), text);
    git('add', name);
  }
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
const gateRun = (args, extra = {}) => {
  const r = spawnSync('/bin/sh', [gate, ...args], { cwd: repo, encoding: 'utf8', env: env(extra) });
  return { status: r.status, out: r.stdout + r.stderr };
};
const general = (...range) => gateRun(['--mode', 'general', ...(range.length ? range : ['--all'])]);

beforeEach(() => {
  if (missing.length) throw new Error(reason);
  dir = mkdtempSync(path.join(tmpdir(), 'push-gate-real-'));
  bin = path.join(dir, 'bin');
  mkdirSync(bin);
  for (const n of CORE) { const p = find(n, SYSTEM); if (p) symlinkSync(p, path.join(bin, n)); }
  for (const [n, p] of Object.entries(real)) symlinkSync(p, path.join(bin, n));
  repo = path.join(dir, 'repo');
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The gate stopped on gitleaks (exit 1) and printed neither the key nor the text around it. */
function stoppedOnKey(r, key) {
  assert.equal(r.status, 1, r.out);
  assert.ok(r.out.includes('push-gate: step gitleaks: FAILED'), r.out);
  assert.ok(!r.out.includes(key) && !r.out.includes(key.slice(4, 20)), `the key leaked into the output: ${r.out}`);
}

describe('push-gate.sh with the real tools', () => {
  it('has both tools installed', () => {
    assert.deepEqual(missing, [], reason);
  });

  it('passes a clean range with a valid workflow', () => {
    commit({ 'a.txt': 'one\n' });
    commit({ '.github/workflows/ci.yml': 'name: x\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n' });
    const r = general();
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: passed (mode general, 2 commit(s))'), r.out);
  });

  it('stops on a key in an ordinary commit, even when a later commit removes it', () => {
    const key = fakeKey();
    commit({ 'a.txt': 'one\n' });
    commit({ 'conf.txt': `token = ${key}\n` });
    git('rm', '-q', 'conf.txt');
    git('commit', '-q', '-m', 'remove');
    stoppedOnKey(general(), key);
  });

  it('stops on a key in a commit message', () => {
    const key = fakeKey();
    commit({ 'a.txt': 'one\n' });
    commit({ 'b.txt': 'two\n' }, `note: token ${key}`);
    const r = general();
    stoppedOnKey(r, key);
    assert.ok(/commit message of [0-9a-f]{8}/.test(r.out), r.out);
  });

  it('stops on a key that only a merge commit adds (the merge is diffed against each parent)', () => {
    const key = fakeKey();
    commit({ 'a.txt': 'one\n' });
    git('checkout', '-q', '-b', 'side');
    commit({ 'side.txt': 'side\n' });
    git('checkout', '-q', 'main');
    commit({ 'main.txt': 'main\n' });
    git('merge', '--no-ff', '--no-commit', 'side');
    writeFileSync(path.join(repo, 'merged.txt'), `token = ${key}\n`);
    git('add', 'merged.txt');
    git('commit', '-q', '-m', 'merge side');
    git('rm', '-q', 'merged.txt');
    git('commit', '-q', '-m', 'remove');
    stoppedOnKey(general(), key);
  });

  it('stops on a workflow that is not YAML (a plain scalar holding ": ", the shape of the old pr-gate.yml bug)', () => {
    commit({ '.github/workflows/bad.yml': 'name: bad\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - name: x\n        run: echo "bad: x $(date)"\n' });
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step workflows: FAILED'), r.out);
    assert.ok(r.out.includes('.github/workflows/bad.yml:8: [syntax-check]'), r.out);
    assert.ok(!r.out.includes('echo'), 'no line of the file is printed');
  });

  it('--not-on-remote leaves out commits the remote has, and takes everything when it has no refs', () => {
    const key = fakeKey();
    const pushed = commit({ 'conf.txt': `token = ${key}\n` });
    git('rm', '-q', 'conf.txt');
    git('commit', '-q', '-m', 'remove');
    commit({ 'b.txt': 'two\n' });
    stoppedOnKey(general('--not-on-remote', 'origin'), key);
    git('update-ref', 'refs/remotes/origin/main', pushed);
    const r = general('--not-on-remote', 'origin');
    assert.equal(r.status, 0, `the commit that the remote has is not scanned: ${r.out}`);
    assert.ok(r.out.includes('(mode general, 2 commit(s))'), r.out);
  });
});

describe('push-gate.sh with the real tools: a file in the tree cannot silence gitleaks', () => {
  /** What plain gitleaks (no --config, as the old scans call it) says about the repository: 0 means silenced. */
  const plain = (extra = {}) =>
    spawnSync('gitleaks', ['git', '--no-banner', '--log-level', 'error', '--exit-code', '99', '.'], {
      cwd: repo, encoding: 'utf8', env: { ...env(extra), PATH: process.env.PATH },
    }).status;
  const ALLOW_ALL = '[extend]\nuseDefault = true\n[allowlist]\npaths = [".*"]\n';

  it('a .gitleaks.toml that allowlists every path', () => {
    const key = fakeKey();
    commit({ '.gitleaks.toml': ALLOW_ALL });
    commit({ 'conf.txt': `token = ${key}\n` });
    assert.equal(plain(), 0, 'sanity: the in-tree config does silence a plain scan');
    stoppedOnKey(general(), key);
  });

  it('a .gitleaksignore that lists the fingerprints of the finding', () => {
    const key = fakeKey();
    const sha = commit({ 'conf.txt': `token = ${key}\n` });
    commit({ '.gitleaksignore': `${sha}:conf.txt:github-pat:1\nconf.txt:github-pat:1\n` });
    assert.equal(plain(), 0, 'sanity: the ignore file does silence a plain scan');
    stoppedOnKey(general(), key);
  });

  it('GITLEAKS_CONFIG in the environment, pointing at an allow-everything file', () => {
    const key = fakeKey();
    commit({ 'conf.txt': `token = ${key}\n` });
    const allow = path.join(dir, 'allow.toml');
    writeFileSync(allow, ALLOW_ALL);
    assert.equal(plain({ GITLEAKS_CONFIG: allow }), 0, 'sanity: the variable does silence a plain scan');
    stoppedOnKey(gateRun(['--mode', 'general', '--all'], { GITLEAKS_CONFIG: allow }), key);
    const toml = gateRun(['--mode', 'general', '--all'], { GITLEAKS_CONFIG_TOML: ALLOW_ALL });
    stoppedOnKey(toml, key);
  });

  it('an inline gitleaks:allow comment', () => {
    const key = fakeKey();
    commit({ 'conf.txt': `token = ${key} # gitleaks:allow\n` });
    assert.equal(plain(), 0, 'sanity: the comment does silence a plain scan');
    stoppedOnKey(general(), key);
  });
});
