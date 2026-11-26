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
const run = (args, cwd = repo, extra = {}) => {
  const r = spawnSync('/bin/sh', [range, ...args], { cwd, encoding: 'utf8', env: { ...env(), ...extra } });
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

describe('push-range.sh: the place it asks is the place the push sends to', () => {
  // The hook is given the URL AFTER pushInsteadOf; git push sends there as it is. But `git ls-remote <url>` applies
  // url.<x>.insteadOf once more, so it can end up asking another repository. Nothing is subtracted on such an answer.
  const rewrite = (mirror) => {
    git(repo, 'config', `url.${mirror}.insteadOf`, bare);
    git(repo, 'config', `url.${bare}.pushInsteadOf`, bare);
  };

  it('does not subtract what a rewritten URL\'s repository has: the commit is listed (by URL and by name alike)', () => {
    const mirror = path.join(dir, 'mirror.git');
    git(dir, 'init', '-q', '--bare', mirror);
    const a = commit(repo, 'a.txt');
    git(repo, 'push', '-q', mirror, 'main'); // the mirror has it; the real destination does not
    const b = commit(repo, 'b.txt');
    rewrite(mirror);
    assert.equal(git(repo, 'remote', 'get-url', '--push', 'origin'), bare, 'the push goes to the destination itself');
    const byUrl = run([bare]);
    const byName = run(['origin']);
    assert.equal(byUrl.status, 0, byUrl.all);
    assert.deepEqual(lines(byUrl).sort(), [a, b].sort(), 'what only the mirror has is not subtracted');
    assert.deepEqual(lines(byName).sort(), lines(byUrl).sort(), 'by name and by URL give the same commits');
    assert.equal(run(['--gate-args', bare]).out.trim(), '--all');
    assert.equal(run(['--gate-args', 'origin']).out.trim(), '--all');
  });

  it('a rewrite that is only the same URL again changes nothing: the destination is asked and subtracted', () => {
    const a = commit(repo, 'a.txt');
    git(repo, 'push', '-q', 'origin', 'main');
    const b = commit(repo, 'b.txt');
    git(repo, 'config', `url.${bare}.pushInsteadOf`, bare);
    assert.deepEqual(lines(run([bare])), [b]);
    assert.deepEqual(lines(run(['origin'])), [b]);
    assert.ok(a);
  });
});

describe('push-range.sh: the repository is the caller\'s, not whatever encloses the work tree', () => {
  // `git --git-dir=A --work-tree=B push` runs the hook with cwd B and GIT_DIR=A. B sits inside another repository.
  let outer;
  let inner;
  let work;
  const innerEnv = () => ({ GIT_DIR: inner, GIT_WORK_TREE: work });
  const igit = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...args], { cwd: work, encoding: 'utf8', env: { ...env(), ...innerEnv() } });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  beforeEach(() => {
    outer = path.join(dir, 'outer');
    work = path.join(outer, 'sub');
    inner = path.join(dir, 'innerrepo', '.git');
    mkdirSync(work, { recursive: true });
    git(outer, 'init', '-q', '-b', 'main');
    commit(outer, 'o.txt');
    git(dir, 'init', '-q', '-b', 'main', path.join(dir, 'innerrepo'));
    for (const n of ['1', '2', '3']) {
      writeFileSync(path.join(work, `i${n}.txt`), n);
      igit('add', `i${n}.txt`);
      igit('commit', '-q', '-m', `inner ${n}`);
    }
  });

  it('lists the commits of the repository git was told to use (3), never the enclosing one (1)', () => {
    const r = run([bare], work, innerEnv());
    assert.equal(r.status, 0, r.all);
    assert.equal(lines(r).length, 3, r.all);
    assert.deepEqual(lines(r).sort(), igit('rev-list', 'HEAD').split('\n').sort());
  });

  it('stops, and says so, when GIT_DIR names no repository: the enclosing repository is not used instead', () => {
    const r = run([bare], work, { GIT_DIR: path.join(dir, 'no-such-dir'), GIT_WORK_TREE: work });
    assert.equal(r.status, 2, r.all);
    assert.ok(r.all.includes('push-range: not inside a git repository'), r.all);
    assert.equal(r.out, '');
  });

  it('--head must be the commit HEAD is: a mismatch stops', () => {
    const head = igit('rev-parse', 'HEAD');
    const ok = run(['--head', head, bare], work, innerEnv());
    assert.equal(ok.status, 0, ok.all);
    const other = git(outer, 'rev-parse', 'HEAD');
    const bad = run(['--head', other, bare], work, innerEnv());
    assert.equal(bad.status, 2, bad.all);
    assert.ok(bad.all.includes('push-range: HEAD is not the commit being pushed'), bad.all);
    assert.equal(bad.out, '');
  });

  it('stops for an object directory set from outside (it cannot be handed on to the clean environment)', () => {
    const r = run([bare], work, { ...innerEnv(), GIT_OBJECT_DIRECTORY: path.join(inner, 'objects') });
    assert.equal(r.status, 2, r.all);
    assert.ok(r.all.includes('push-range: GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES are not supported'), r.all);
  });
});

describe('push-range.sh: refs/replace and info/grafts of the repository do not change the range', () => {
  it('a replace ref that hides commits lists them all, as the objects are', () => {
    const a = commit(repo, 'a.txt');
    const b = commit(repo, 'b.txt');
    const c = commit(repo, 'c.txt');
    const swap = git(repo, 'commit-tree', '-p', a, '-m', 'replacement', `${c}^{tree}`);
    git(repo, 'replace', c, swap);
    const r = run([bare]);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(lines(r).sort(), [a, b, c].sort());
  });

  it('a graft that cuts the history does not shorten the range, and a replace of the destination\'s commit cannot subtract more', () => {
    const a = commit(repo, 'a.txt');
    git(repo, 'push', '-q', 'origin', 'main');
    const b = commit(repo, 'b.txt');
    const c = commit(repo, 'c.txt');
    mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'info', 'grafts'), `${c} ${a}\n`);
    assert.deepEqual(lines(run([bare])).sort(), [b, c].sort());
    // the destination's commit replaced by the tip: with replace refs honoured, everything would be subtracted
    git(repo, 'replace', a, c);
    assert.deepEqual(lines(run([bare])).sort(), [b, c].sort());
    assert.deepEqual(lines(run(['--head', c, bare])).sort(), [b, c].sort());
  });
});

