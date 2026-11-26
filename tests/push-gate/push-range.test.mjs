/**
 * Tests of scripts/push-range.sh: the one place that decides which commits a push puts in front of the scans (and of the
 * reviewer who reads the push for publication). Only what the DESTINATION itself says it has, asked now with
 * `git ls-remote --heads`, is subtracted, and only when the objects are here and the history can be read to the end.
 * A remote-tracking ref is local state and proves nothing. When the destination cannot be asked, or the history cannot
 * be read (a shallow clone, missing objects), the script stops with a reason: it never falls back to a smaller scan.
 * These tests use real git only (a local bare repository is the destination); no scanner is involved.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const range = fileURLToPath(new URL('../../scripts/push-range.sh', import.meta.url));
let dir;
let repo;
let bare;
const env = () => ({ PATH: process.env.PATH, HOME: path.join(dir, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' });
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: env() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (cwd, name, text = 'x\n') => {
  writeFileSync(path.join(cwd, name), text);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-q', '-m', `add ${name}`);
  return git(cwd, 'rev-parse', 'HEAD');
};
const run = (args, cwd = repo) => {
  const r = spawnSync('/bin/sh', [range, ...args], { cwd, encoding: 'utf8', env: env() });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
};
const lines = (r) => r.out.split('\n').filter(Boolean);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'push-range-'));
  repo = path.join(dir, 'repo');
  bare = path.join(dir, 'dest.git');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(dir, 'init', '-q', '--bare', bare);
  git(repo, 'remote', 'add', 'origin', bare);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('push-range.sh', () => {
  it('lists every commit when the destination has none (an empty remote)', () => {
    const a = commit(repo, 'a.txt');
    const b = commit(repo, 'b.txt');
    const r = run([bare]);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(lines(r).sort(), [a, b].sort());
    assert.equal(run(['--gate-args', bare]).out.trim(), '--all');
  });

  it('subtracts what the destination has, and prints the gate arguments that mean the same set', () => {
    const a = commit(repo, 'a.txt');
    git(repo, 'push', '-q', 'origin', 'main');
    const b = commit(repo, 'b.txt');
    const r = run([bare]);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(lines(r), [b]);
    assert.equal(run(['--gate-args', bare]).out.trim(), `--not-on ${a}`);
  });

  it('a remote name is read as its push URL', () => {
    commit(repo, 'a.txt');
    git(repo, 'push', '-q', 'origin', 'main');
    const b = commit(repo, 'b.txt');
    assert.deepEqual(lines(run(['origin'])), [b]);
  });

  it('does not trust a remote-tracking ref: the destination does not have the commit, so it is listed', () => {
    const a = commit(repo, 'a.txt');
    git(repo, 'update-ref', 'refs/remotes/origin/main', a);
    const b = commit(repo, 'b.txt');
    const r = run([bare]);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(lines(r).sort(), [a, b].sort());
  });

  it('stops when the destination cannot be asked', () => {
    commit(repo, 'a.txt');
    const r = run([path.join(dir, 'no-such.git')]);
    assert.equal(r.status, 2, r.all);
    assert.ok(r.all.includes('push-range: could not ask the destination for its branches (git ls-remote failed)'), r.all);
    assert.equal(r.out, '', 'no list is printed that could be mistaken for the answer');
  });

  it('does not subtract an advertised commit that is not here', () => {
    const a = commit(repo, 'a.txt');
    const other = path.join(dir, 'other');
    git(dir, 'clone', '-q', bare, other);
    git(other, 'checkout', '-q', '-b', 'main');
    const theirs = commit(other, 'theirs.txt');
    git(other, 'push', '-q', 'origin', 'main');
    const r = run([bare]);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(lines(r), [a], 'the destination has a commit we do not: nothing local is subtracted because of it');
    assert.ok(!lines(r).includes(theirs));
  });

  it('stops in a shallow clone: the history cannot be read to the end', () => {
    commit(repo, 'a.txt');
    commit(repo, 'b.txt');
    const shallow = path.join(dir, 'shallow');
    git(dir, 'clone', '-q', '--depth', '1', `file://${repo}`, shallow);
    git(shallow, 'remote', 'add', 'dest', bare);
    const r = run([bare], shallow);
    assert.equal(r.status, 2, r.all);
    assert.ok(r.all.includes('push-range: this is a shallow clone, so the history cannot be read to the end'), r.all);
  });

  it('stops when objects of the range are missing here', () => {
    commit(repo, 'a.txt');
    const blob = git(repo, 'rev-parse', 'HEAD:a.txt');
    rmSync(path.join(repo, '.git/objects', blob.slice(0, 2), blob.slice(2)), { force: true });
    assert.ok(readdirSync(path.join(repo, '.git/objects')).length > 0);
    const r = run([bare]);
    assert.equal(r.status, 2, r.all);
    assert.ok(r.all.includes('push-range: objects are missing here, so the history cannot be read to the end'), r.all);
  });

  it('stops when the history cannot be read (a missing parent commit)', () => {
    const a = commit(repo, 'a.txt');
    commit(repo, 'b.txt');
    rmSync(path.join(repo, '.git/objects', a.slice(0, 2), a.slice(2)), { force: true });
    const r = run([bare]);
    assert.equal(r.status, 2, r.all);
    assert.ok(r.all.includes('push-range: the history cannot be read to the end'), r.all);
  });

  it('refuses a URL that looks like an option and a missing argument', () => {
    commit(repo, 'a.txt');
    assert.equal(run(['--upload-pack=x']).status, 2);
    assert.ok(run([]).all.includes('push-range: usage'), 'usage');
  });
});
