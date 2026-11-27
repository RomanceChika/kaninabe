/**
 * VERDICT tests of the push-before gate: scripts/push-gate.sh (and the scans it runs) with the REAL gitleaks and
 * actionlint. The wiring tests (push-gate-wiring.test.mjs) use fakes, which cannot show that the gate's questions get
 * the right answers from a real scanner; these can. They do not skip: without the two tools on PATH they fail with one
 * line saying how to install them (scripts/setup-dev-env.sh).
 *
 * Fake keys are assembled at run time from pieces and written only into throwaway repositories, so no key-shaped text
 * is committed here (push protection and the secret scan of this repository stay quiet on this file).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const realGate = fileURLToPath(new URL('../../scripts/push-gate.sh', import.meta.url));
// The tests never run the gate with the repository's own exclusion list: every test runs a COPY of the scripts directory whose
// scan-exclusions.tsv is empty (setList writes another one into the copy). Only scan-exclusions.test.mjs reads the real list.
const realScripts = path.dirname(realGate);
let gate = realGate;
let gscripts = realScripts;
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
  gscripts = path.join(dir, 'gate-scripts');
  cpSync(realScripts, gscripts, { recursive: true });
  writeFileSync(path.join(gscripts, 'scan-exclusions.tsv'), '');
  gate = path.join(gscripts, 'push-gate.sh');
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
    assert.ok(/, 1 in commit messages,/.test(r.out), r.out);
  });

  describe('the names and emails of author and committer are scanned too (review round 13, Q1)', () => {
    const commitAs = (envVars) => {
      commit({ 'a.txt': 'one\n' });
      const r = spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'plain'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env(), PATH: process.env.PATH, GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@users.noreply.github.com', GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@users.noreply.github.com', ...envVars } });
      assert.equal(r.status, 0, r.stderr);
    };
    for (const [label, vars] of [
      ['author name', (k) => ({ GIT_AUTHOR_NAME: k })],
      ['committer name', (k) => ({ GIT_COMMITTER_NAME: k })],
      ['author email local part', (k) => ({ GIT_AUTHOR_EMAIL: `${k}@users.noreply.github.com` })],
      ['committer email local part', (k) => ({ GIT_COMMITTER_EMAIL: `${k}@users.noreply.github.com` })],
    ]) {
      it(`a key in the ${label} stops the gate`, () => {
        const key = fakeKey();
        commitAs(vars(key));
        stoppedOnKey(general('--base', git('rev-parse', 'HEAD~1')), key);
      });
    }
  });

  describe('the text of a commit is the whole raw object, with NUL as a line break (review round 14, R1)', () => {
    const rawCommit = ({ extra = '', message = 'plain\n' } = {}) => {
      const tree = git('rev-parse', 'HEAD^{tree}');
      const parent = git('rev-parse', 'HEAD');
      const who = 'Tester <tester@users.noreply.github.com> 1700000000 +0000';
      const body = Buffer.concat([Buffer.from(`tree ${tree}\nparent ${parent}\nauthor ${who}\ncommitter ${who}\n${extra}\n`), Buffer.isBuffer(message) ? message : Buffer.from(message)]);
      const r = spawnSync('git', ['hash-object', '-t', 'commit', '-w', '--literally', '--stdin'], { cwd: repo, input: body, env: { ...process.env, ...env(), PATH: process.env.PATH } });
      assert.equal(r.status, 0, String(r.stderr));
      git('update-ref', 'refs/heads/main', String(r.stdout).trim());
    };
    const base = () => { commit({ 'a.txt': 'one\n' }); return git('rev-parse', 'HEAD'); };
    const cases = {
      'a mergetag header': (k) => ({ extra: `mergetag object ${'0'.repeat(40)}\n type commit\n tag t1\n tagger T <t@users.noreply.github.com> 1 +0000\n \n token = ${k}\n` }),
      'an arbitrary extra header': (k) => ({ extra: `x-extra: token = ${k}\n` }),
      'a gpgsig-shaped continuation line': (k) => ({ extra: `gpgsig -----BEGIN PGP SIGNATURE-----\n \n token = ${k}\n -----END PGP SIGNATURE-----\n` }),
      'the message after a NUL': (k) => ({ message: Buffer.concat([Buffer.from('subject\n'), Buffer.from([0]), Buffer.from(`hidden token = ${k}\n`)]) }),
    };
    for (const [label, build] of Object.entries(cases)) {
      it(`a key in ${label} stops the gate`, () => {
        const key = fakeKey();
        const first = base();
        rawCommit(build(key));
        stoppedOnKey(general('--base', first), key);
      });
    }
    it('a key as the last bytes of a text without a trailing newline is found, whatever follows (review round 17, V1)', () => {
      // an AWS access key id ends at a word boundary: joined to the next record's "tree ..." it would not be found
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const key = `AKIA${Array.from(randomBytes(16), (b) => alphabet[b % 32]).join('')}`;
      const first = base();
      rawCommit({ message: `note ${key}` });
      rawCommit({ message: 'next\n' });
      const r = general('--base', first);
      assert.equal(r.status, 1, r.out);
      assert.ok(!r.out.includes(key), r.out);
    });
    it('no false positive from the usual lines: tree, parent, and gpgsig blocks of random base64, in general and in words mode', () => {
      const first = base();
      for (let i = 0; i < 5; i += 1) {
        const sig = randomBytes(300).toString('base64').match(/.{1,64}/g).map((l) => ` ${l}`).join('\n');
        rawCommit({ extra: `gpgsig -----BEGIN PGP SIGNATURE-----\n \n${sig}\n -----END PGP SIGNATURE-----\n` });
      }
      const g = general('--base', first);
      assert.equal(g.status, 0, g.out);
      const wordsFile = path.join(dir, 'words.txt');
      writeFileSync(wordsFile, 'zzgatewordzz\n');
      const w = gateRun(['--mode', 'words', '--base', first], { SCAN_WORDS_FILE: wordsFile });
      assert.equal(w.status, 0, w.out);
    });
  });

  describe('texts are scanned in batches: no key is lost between batches (review round 13, B1)', () => {
    const body = (lines) => `${'lorem ipsum dolor sit amet\n'.repeat(lines)}`;
    it('K keys in K messages across several batches give exactly K findings, a key at the end of one message and at the start of the next', () => {
      const k = 12;
      commit({ 'a.txt': 'one\n' });
      const first = git('rev-parse', 'HEAD');
      for (let i = 0; i < k; i += 1) {
        const key = fakeKey();
        const text = i % 2 === 0 ? `${body(780)}note ${key}` : `note ${key}\n${body(780)}`;
        git('commit', '-q', '--allow-empty', '-m', text);
      }
      const r = general('--base', first);
      assert.equal(r.status, 1, r.out);
      assert.equal(Number(/, (\d+) in commit messages,/.exec(r.out)?.[1]), k, r.out);
    });
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

  it('--not-on leaves out the commits it names, and takes everything with --all', () => {
    const key = fakeKey();
    const pushed = commit({ 'conf.txt': `token = ${key}\n` });
    git('rm', '-q', 'conf.txt');
    git('commit', '-q', '-m', 'remove');
    commit({ 'b.txt': 'two\n' });
    stoppedOnKey(general(), key);
    const r = general('--not-on', pushed);
    assert.equal(r.status, 0, `the commit that the destination has is not scanned: ${r.out}`);
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

describe('push-gate.sh with the real tools: what is scanned does not depend on the tree or on local git settings', () => {
  const WORD = 'zzgatewordzz';
  const words = () => {
    const f = path.join(dir, 'words.txt');
    writeFileSync(f, `${WORD}\n`);
    return { SCAN_WORDS_FILE: f };
  };
  // Assembled here so that this file holds no mail address and no local path of its own.
  const mail = () => ['someone', '@', 'corp-mail.invalid'].join('');
  const homePath = () => ['/ho', 'me/', 'alice/notes'].join('');
  const stops = (r, rule) => {
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(rule), `expected "${rule}": ${r.out}`);
  };

  it('a .gitattributes that marks text as binary or -diff does not hide a word, a mail address or a local path', () => {
    commit({ '.gitattributes': '*.txt binary\n* -diff\n', 'notes.txt': `${WORD}\n`, 'mail.txt': `${mail()}\n`, 'path.txt': `${homePath()}\n` });
    const r = gateRun(['--mode', 'words', '--all'], words());
    stops(r, 'push-gate: step scan-public: FAILED');
    assert.ok(r.out.includes('word list: 1 file(s)'), r.out);
    assert.ok(r.out.includes('email-like string: 1 hit(s)'), r.out);
    assert.ok(r.out.includes('local path or key shape: 1 hit(s)'), r.out);
    const general_ = general();
    stops(general_, 'push-gate: step scan-public: FAILED');
    assert.ok(general_.out.includes('email-like string: 1 hit(s)'), general_.out);
  });

  it('a .git/info/attributes of the clone and a core.attributesFile do not hide them either', () => {
    commit({ 'notes.txt': `${WORD}\n` });
    writeFileSync(path.join(repo, '.git/info/attributes'), '* -diff\n');
    writeFileSync(path.join(dir, 'global-attributes'), '* binary\n');
    git('config', 'core.attributesFile', path.join(dir, 'global-attributes'));
    git('config', 'grep.patternType', 'fixed');
    stops(gateRun(['--mode', 'words', '--all'], words()), 'word list: 1 file(s)');
  });

  it('an export-ignore attribute does not hide a key from the scan of the tree of HEAD', () => {
    const key = fakeKey();
    commit({ '.gitattributes': 'conf.dat export-ignore\n', 'conf.dat': `token = ${key}\n` });
    const pushed = git('rev-parse', 'HEAD');
    commit({ 'b.txt': 'two\n' });
    // The history scan leaves the commit out (the destination has it); only the tree of HEAD can see the key.
    stoppedOnKey(general('--not-on', pushed), key);
  });

  it('an export-ignore attribute does not hide a workflow from actionlint', () => {
    commit({
      '.gitattributes': '.github export-ignore\n.github/** export-ignore\n',
      '.github/workflows/bad.yml': 'name: bad\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - name: x\n        run: echo "bad: x $(date)"\n',
    });
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step workflows: FAILED'), r.out);
  });

  it('works when the clone and the scripts are in directories whose names contain a space', () => {
    const key = fakeKey();
    repo = path.join(dir, 'my repo');
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    const scripts = path.join(dir, 'my scripts');
    cpSync(path.dirname(gate), scripts, { recursive: true });
    const run = () => {
      const r = spawnSync('/bin/sh', [path.join(scripts, 'push-gate.sh'), '--mode', 'general', '--all'], { cwd: repo, encoding: 'utf8', env: env() });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    commit({ 'a.txt': 'one\n' });
    const clean = run();
    assert.equal(clean.status, 0, clean.out);
    commit({ 'conf.txt': `token = ${key}\n` });
    stoppedOnKey(run(), key);
  });
});

describe('push-gate.sh with the real tools: filter=lfs in the tree does not make gitleaks skip a file', () => {
  // A key committed raw in a file that an attribute calls LFS-managed: the commit holds the key itself (this repository
  // has no LFS filter configured, as in the tests' environment), and the gate must find it in the patch and in the tree.
  it('an attribute in the same commit as the key', () => {
    const key = fakeKey();
    commit({ '.gitattributes': '*.cfg filter=lfs diff=lfs merge=lfs -text\n', 'x.cfg': `token = ${key}\n` });
    stoppedOnKey(general(), key);
  });

  it('an attribute added by a later commit (the tree scan alone sees the key: the remote has the earlier commit)', () => {
    const key = fakeKey();
    commit({ 'x.cfg': `token = ${key}\n` });
    const earlier = git('rev-parse', 'HEAD');
    commit({ '.gitattributes': '* filter=lfs\n' });
    stoppedOnKey(general('--not-on', earlier), key);
  });

  it('a nested .gitattributes', () => {
    const key = fakeKey();
    commit({ 'sub/dir/.gitattributes': '* filter=lfs\n', 'sub/dir/x.cfg': `token = ${key}\n` });
    const pushed = git('rev-parse', 'HEAD');
    commit({ 'b.txt': 'two\n' });
    stoppedOnKey(general('--not-on', pushed), key);
    stoppedOnKey(general(), key);
  });

  it('with an LFS-style smudge filter in the user\'s git configuration, the export of HEAD still holds the committed bytes', () => {
    const key = fakeKey();
    commit({ '.gitattributes': '*.cfg filter=lfs\n', 'x.cfg': `token = ${key}\n` });
    const pushedLfs = git('rev-parse', 'HEAD');
    commit({ 'b.txt': 'two\n' });
    const cfg = path.join(dir, 'lfs-gitconfig');
    writeFileSync(cfg, '[filter "lfs"]\n\tclean = cat\n\tsmudge = sh -c \'cat >/dev/null; echo pointer\'\n\trequired = true\n');
    const r = gateRun(['--mode', 'general', '--not-on', pushedLfs], { GIT_CONFIG_GLOBAL: cfg });
    stoppedOnKey(r, key);
  });
});

describe('push-gate.sh with the real tools: the same commit gets the same verdict in a hostile setting and a clean one', () => {
  const WORD = 'zzgatewordzz';
  const ALLOW_ALL = '[extend]\nuseDefault = true\n[allowlist]\npaths = [".*"]\n';
  const nonexistent = path.join(tmpdir(), 'push-gate-no-such-path');
  /** In-tree files that try to change what is scanned. */
  const inTree = () => ({
    '.gitattributes': '* binary -diff export-ignore filter=lfs\n',
    '.gitleaks.toml': ALLOW_ALL,
    '.gitleaksignore': 'x:y:z:1\n',
  });
  /** Settings outside the tree: environment variables and configuration files, each a table row. */
  const hostile = () => {
    const lfs = path.join(dir, 'lfs-config');
    writeFileSync(lfs, '[filter "lfs"]\n\tclean = cat\n\tsmudge = sh -c \'cat >/dev/null; echo pointer\'\n\trequired = true\n[diff]\n\tnoprefix = true\n\tmnemonicPrefix = true\n[grep]\n\tpatternType = fixed\n');
    const allow = path.join(dir, 'allow.toml');
    writeFileSync(allow, ALLOW_ALL);
    const xdg = path.join(dir, 'xdg');
    mkdirSync(path.join(xdg, 'git'), { recursive: true });
    writeFileSync(path.join(xdg, 'git', 'attributes'), '* binary\n');
    writeFileSync(path.join(xdg, 'git', 'config'), '[core]\n\tattributesFile = ' + path.join(xdg, 'git', 'attributes') + '\n');
    return {
      'GITLEAKS_CONFIG': { GITLEAKS_CONFIG: allow },
      'GITLEAKS_CONFIG_TOML': { GITLEAKS_CONFIG_TOML: ALLOW_ALL },
      'GITLEAKS_BASELINE_PATH': { GITLEAKS_BASELINE_PATH: nonexistent },
      'GIT_INDEX_FILE': { GIT_INDEX_FILE: nonexistent },
      'GIT_ATTR_SOURCE': { GIT_ATTR_SOURCE: 'no-such-tree' },
      'GIT_CONFIG_COUNT injection': { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.attributesFile', GIT_CONFIG_VALUE_0: nonexistent, GIT_CONFIG_KEY_1: 'diff.external', GIT_CONFIG_VALUE_1: 'false' },
      'GIT_CONFIG_GLOBAL with LFS filters and diff settings': { GIT_CONFIG_GLOBAL: lfs },
      'XDG_CONFIG_HOME / HOME git config': { XDG_CONFIG_HOME: xdg, HOME: xdg },
      'GREP_OPTIONS': { GREP_OPTIONS: '-v' },
      'GIT_EXTERNAL_DIFF / PAGER': { GIT_EXTERNAL_DIFF: 'false', GIT_PAGER: 'false', PAGER: 'false' },
      'TMPDIR': { TMPDIR: nonexistent },
    };
  };
  const verdict = (r) => ({
    status: r.status,
    gitleaks: /push-gate: step gitleaks: FAILED \(\d+ finding\(s\) in patches, \d+ in commit messages, \d+ in the tree of HEAD\)/.exec(r.out)?.[0],
    wordList: r.out.includes('word list: 1 file(s)'),
    tail: /push-gate: FAILED \([^)]*\)/.exec(r.out)?.[0],
  });
  const words = () => {
    const f = path.join(dir, 'words.txt');
    writeFileSync(f, `${WORD}\n`);
    return { SCAN_WORDS_FILE: f };
  };

  const setupRepo = (withTreeTricks) => {
    repo = path.join(dir, withTreeTricks ? 'hostile-repo' : 'clean-repo');
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    const key = fakeKey();
    commit({ ...(withTreeTricks ? inTree() : {}), 'conf.txt': `token = ${key}\n`, 'notes.txt': `${WORD}\n` });
    return key;
  };

  it('one table: every hostile row, and all of them at once, give the verdict of the clean setting', () => {
    const cleanKey = setupRepo(false);
    const fakeKeyOf = () => cleanKey;
    const cleanVerdict = verdict(gateRun(['--mode', 'words', '--all'], words()));
    assert.equal(cleanVerdict.status, 1);
    assert.ok(cleanVerdict.gitleaks && cleanVerdict.wordList && cleanVerdict.tail, JSON.stringify(cleanVerdict));
    const rows = hostile();
    const all = Object.assign({}, ...Object.values(rows));
    delete all.GIT_ATTR_SOURCE; // the combined row keeps one value per variable; the single rows above cover each
    const table = { ...rows, 'ALL OF THEM AT ONCE': all };
    for (const withTreeTricks of [false, true]) {
      const key = withTreeTricks ? setupRepo(true) : fakeKeyOf(repo);
      for (const [name, extra] of Object.entries(table)) {
        const r = gateRun(['--mode', 'words', '--all'], { ...words(), ...extra });
        assert.deepEqual(verdict(r), cleanVerdict, `${name}${withTreeTricks ? ' (with hostile files in the tree)' : ''} changed the verdict: ${r.out}`);
        assert.ok(!r.out.includes(key.slice(4, 20)), 'the key leaked into the output');
      }
    }
  });
});

describe('push-gate.sh with the real tools: state INSIDE the repository cannot change the verdict', () => {
  // .git/config, .git/info/attributes, refs/replace/* and info/grafts are read by every git that points at the real git
  // directory, even in a clean environment; push sends the real objects. Each row prepares the same history in a fresh
  // repository (a key and a word added in commit 2, removed in commit 3, an unrelated commit 4, so only the history has
  // them), applies one local setting, and must give the verdict of the untouched baseline: FAILED, in patches and in the
  // word scan.
  const WORD = 'zzgatewordzz';
  let n = 0;
  const history = () => {
    n += 1;
    repo = path.join(dir, `inside-${n}`);
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    const key = fakeKey();
    const c1 = commit({ 'a.txt': 'one\n' });
    const c2 = commit({ 'conf.txt': `token = ${key}\n`, 'notes.txt': `${WORD}\n` });
    git('rm', '-q', 'conf.txt', 'notes.txt');
    git('commit', '-q', '-m', 'remove');
    const c3 = git('rev-parse', 'HEAD');
    const c4 = commit({ 'b.txt': 'two\n' });
    return { key, c1, c2, c3, c4 };
  };
  const words = () => {
    const f = path.join(dir, 'words.txt');
    writeFileSync(f, `${WORD}\n`);
    return { SCAN_WORDS_FILE: f };
  };
  const verdict = (r) => ({
    status: r.status,
    gitleaks: /push-gate: step gitleaks: FAILED \(\d+ finding\(s\) in patches, \d+ in commit messages, \d+ in the tree of HEAD\)/.exec(r.out)?.[0],
    wordList: r.out.includes('word list: 1 file(s)'),
    commits: /\((\d+) commit\(s\)\)|ok \((\d+) commit/.exec(r.out)?.[0],
    tail: /push-gate: FAILED \([^)]*\)/.exec(r.out)?.[0],
  });
  const info = (name, text) => { mkdirSync(path.join(repo, '.git', 'info'), { recursive: true }); writeFileSync(path.join(repo, '.git', 'info', name), text); };
  const replacement = (commitSha, parent) => git('commit-tree', '-p', parent, '-m', 'replacement', `${commitSha}^{tree}`);
  const rows = {
    'info/attributes: * -diff': () => info('attributes', '* -diff\n'),
    'info/attributes: * binary': () => info('attributes', '* binary\n'),
    'info/attributes: a diff driver whose textconv prints nothing': () => { info('attributes', '* diff=x\n'); git('config', 'diff.x.textconv', 'true'); },
    'local core.attributesFile with * -diff': () => { const f = path.join(repo, '..', `attrs-${n}`); writeFileSync(f, '* -diff\n'); git('config', 'core.attributesFile', f); },
    'local color.diff=always': () => git('config', 'color.diff', 'always'),
    'local diff.external and diff.noprefix': () => { git('config', 'diff.noprefix', 'true'); git('config', 'diff.algorithm', 'minimal'); },
    'a replace ref that swaps the key commit for a clean one': (h) => git('replace', h.c2, replacement(h.c1, h.c1)),
    'a replace ref that hides a commit from the range (tip replaced by a commit whose parent skips it)': (h) => git('replace', h.c4, replacement(h.c4, h.c1)),
    'info/grafts that skips the commit': (h) => info('grafts', `${h.c4} ${h.c1}\n`),
  };

  it('the baseline is FAILED in patches and in the word scan (the history is the only place the key and the word are)', () => {
    const h = history();
    const r = gateRun(['--mode', 'words', '--all'], words());
    const v = verdict(r);
    assert.equal(v.status, 1, r.out);
    assert.ok(v.gitleaks && v.wordList && v.tail, r.out);
    assert.ok(!r.out.includes(h.key.slice(4, 20)));
  });

  for (const [name, apply] of Object.entries(rows)) {
    it(`${name}: the same verdict as the baseline, FAILED`, () => {
      const base = history();
      const baseline = gateRun(['--mode', 'words', '--all'], words());
      assert.equal(baseline.status, 1, baseline.out);
      const h = history();
      apply(h);
      const r = gateRun(['--mode', 'words', '--all'], words());
      assert.equal(r.status, 1, `${name} silenced the gate: ${r.out}`);
      assert.deepEqual(verdict(r), verdict(baseline), `${name} changed the verdict: ${r.out}`);
      assert.ok(!r.out.includes(h.key.slice(4, 20)), 'the key leaked into the output');
      assert.ok(base);
    });
  }

  it('a replace ref that hides a commit from the range does not hide it from the word scan alone either', () => {
    const h = history();
    git('replace', h.c4, replacement(h.c4, h.c1));
    const r = spawnSync('/bin/sh', [path.join(path.dirname(gate), 'scan-public.sh'), h.c1], { cwd: repo, encoding: 'utf8', env: env(words()) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('word list: 1 file(s)'), r.stdout + r.stderr);
  });
});

describe('push-gate.sh with the real tools: nothing in the scanned tree can change what the gate reads or prints (review round 8)', () => {
  it('a finding prints counts, and no rule name, path, commit id, author, line or key', () => {
    const key = fakeKey();
    mkdirSync(path.join(repo, 'secret-dir'));
    git('config', 'user.name', 'Some Author');
    commit({ 'secret-dir/conf.txt': `note token = ${key} trailing words\n` }, 'a message');
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.ok(/\(1 finding\(s\) in patches, 0 in commit messages, 1 in the tree of HEAD\)/.test(r.out), r.out);
    assert.ok(!/rule /.test(r.out) && !r.out.includes('github-pat'), r.out);
    for (const leak of ['secret-dir', 'conf.txt', 'Some Author', 'trailing words', key.slice(4, 20), git('rev-parse', 'HEAD').slice(0, 8)]) {
      assert.ok(!r.out.includes(leak), `"${leak}" reached the output: ${r.out}`);
    }
  });

  it('an in-tree config that names its own rule is not read: its rule id does not reach the output', () => {
    const marker = 'attackerchosenword';
    commit({
      '.gitleaks.toml': `[[rules]]\nid = "zz-attacker-chosen-text"\ndescription = "x"\nregex = '''${marker}'''\n`,
      'x.txt': `${marker}\n`,
    });
    const r = general();
    assert.equal(r.status, 0, r.out);
    assert.ok(!r.out.includes('zz-attacker'), r.out);
  });

  it('an in-tree .gitleaksignore and an inline gitleaks:allow do not silence a key', () => {
    const key = fakeKey();
    commit({ 'conf.txt': `token = ${key}\n`, '.gitleaksignore': 'conf.txt:github-pat:1\n' });
    let r = general();
    assert.equal(r.status, 1, `.gitleaksignore: ${r.out}`);
    assert.equal(patchesOf(r), 1, r.out);
    assert.equal(treeOf(r), 1, r.out);
    commit({ 'conf.txt': `token = ${key} # gitleaks:allow\n` });
    r = general();
    assert.equal(r.status, 1, `inline allow: ${r.out}`);
    assert.equal(patchesOf(r), 2, r.out);
    assert.equal(treeOf(r), 1, r.out);
  });

  it('state inside the repository (local config, info/attributes, a replace ref) does not silence the scan', () => {
    const key = fakeKey();
    commit({ 'a.txt': 'one\n' });
    const c2 = commit({ 'conf.txt': `token = ${key}\n` });
    git('rm', '-q', 'conf.txt');
    git('commit', '-q', '-m', 'remove');
    mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'info', 'attributes'), '* -diff\n');
    git('config', 'color.diff', 'always');
    git('replace', c2, git('rev-parse', 'HEAD~2'));
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), 1, r.out);
  });
});

describe('push-gate.sh with the real tools: history is read by gitleaks git, one commit at a time, with each commit checked (review rounds 10 and 11)', () => {
  const patches = (r) => Number(/\((\d+) finding\(s\) in patches/.exec(r.out)?.[1] ?? NaN);
  const pem = () => {
    const body = randomBytes(420).toString('base64').match(/.{1,64}/g).join('\n');
    return `${['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ')}\n${body}\n${['-----END', 'RSA PRIVATE', 'KEY-----'].join(' ')}\n`;
  };
  /** About `bytes` of ordinary short lines with `k` distinct keys spread through them, one per line like `qqqqq = <key>`. */
  const manyKeys = (bytes, k) => {
    const line = `${'lorem ipsum dolor sit amet '.repeat(10).slice(0, 99)}\n`;
    const every = Math.floor(bytes / line.length / k);
    let out = '';
    for (let i = 0; i < k; i += 1) out += `${line.repeat(every)}qqqqq = ${fakeKey()}\n`;
    return out;
  };

  it('a multi-line private key added across lines is found', () => {
    commit({ 'a.txt': 'one\n' });
    commit({ 'id.pem': pem() });
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.ok(patches(r) >= 1, r.out);
  });

  it('CRLF line endings and a path with spaces do not hide a key', () => {
    commit({ 'a.txt': 'one\n' });
    commit({ 'my dir/a b.txt': `token = ${fakeKey()}\r\nsecond\r\n` });
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.ok(patches(r) >= 1, r.out);
  });

  it('a key on a removed line, and a key in a file the commit removes, do not block a commit that only removes them', () => {
    const key = fakeKey();
    commit({ 'a.txt': 'one\n' });
    const added = commit({ 'conf.txt': `keep\ntoken = ${key}\n`, 'gone.txt': `token = ${fakeKey()}\n` });
    git('rm', '-q', 'gone.txt');
    commit({ 'conf.txt': 'keep\n' }, 'remove the line');
    const r = gateRun(['--mode', 'general', '--base', added]);
    assert.equal(r.status, 0, r.out);
    stoppedOnKey(general(), key); // the commits that added them are still found when they are in the range
  });

  it('REGRESSION (round 11): several MB of ordinary lines with K distinct keys spread through them: exactly K findings in patches', () => {
    const k = 3000;
    commit({ 'a.txt': 'one\n' });
    commit({ 'big.txt': manyKeys(4.8 * 1024 * 1024, k) });
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.equal(patches(r), k, `a key that straddles a chunk was lost: ${r.out}`);
  });

  it('REGRESSION (round 11): one 3 MB line with K keys in it: exactly K findings in patches', () => {
    const k = 3000;
    const piece = 'lorem ipsum '.repeat(Math.floor((3 * 1024 * 1024) / k / 12));
    let line = '';
    for (let i = 0; i < k; i += 1) line += `${piece}qqqqq = ${fakeKey()} `;
    commit({ 'a.txt': 'one\n' });
    commit({ 'long.txt': `${line}\n` });
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.equal(patches(r), k, `a key in the long line was lost: ${r.out}`);
  });

  it('REGRESSION (round 11): the same big file added in one commit and deleted in the next is still found in the commit that added it', () => {
    const k = 3000;
    commit({ 'a.txt': 'one\n' });
    commit({ 'big.txt': manyKeys(4.8 * 1024 * 1024, k) });
    git('rm', '-q', 'big.txt');
    git('commit', '-q', '-m', 'delete it');
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.equal(patches(r), k, r.out);
  });

  it('a key in a path that gitleaks\' own default allowlist skips (node_modules, a .svg) is found in history (known-gaps 16(a))', () => {
    commit({ 'a.txt': 'one\n' });
    commit({ 'node_modules/pkg/cfg.txt': `token = ${fakeKey()}\n`, 'logo.svg': `<!-- token = ${fakeKey()} -->\n` });
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.equal(patches(r), 2, `a key under node_modules/ or in a .svg was not found: ${r.out}`);
  });

  it('a file that git treats as binary is not readable by the scans, so it is red, with the count of such files (known-gaps 16(e))', () => {
    commit({ 'a.txt': 'one\n' });
    commit({ 'blob.bin': Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`token = ${fakeKey()}\n`)]).toString('latin1') });
    const words = path.join(dir, 'words.txt');
    writeFileSync(words, 'zzgatewordzz\n');
    for (const [mode, extra] of [['general', {}], ['words', { SCAN_WORDS_FILE: words }]]) {
      const r = gateRun(['--mode', mode, '--all'], extra);
      assert.equal(r.status, 1, `${mode}: ${r.out}`);
      assert.equal(rangeUnr(r), 1, `${mode}: ${r.out}`);
      assert.equal(treeUnr(r), 1, `${mode}: ${r.out}`);
    }
  });

  it('every kind of commit passes the per-commit check "text added is 1 scanned, otherwise 0 or 1" (a mismatch is exit 2)', () => {
    const sub = path.join(dir, 'submodule-source');
    mkdirSync(sub);
    const inSub = (...a) => spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...a], { cwd: sub, encoding: 'utf8', env: { ...process.env, ...env(), PATH: process.env.PATH } });
    inSub('init', '-q', '-b', 'main');
    writeFileSync(path.join(sub, 'f'), 'x\n');
    inSub('add', 'f');
    inSub('commit', '-q', '-m', 'i');
    const c = (message, ...a) => git('commit', '-q', '-m', message, ...a);
    commit({ 'a.txt': 'a\n' }, 'text add');
    commit({ 'a.txt': 'b\n' }, 'line replace');
    commit({ 'l.txt': 'x\ny\nz\n' }, 'pre-l'); commit({ 'l.txt': 'x\n' }, 'lines removed from an existing file');
    git('rm', '-q', 'a.txt'); c('file deleted');
    symlinkSync('target', path.join(repo, 'link')); git('add', 'link'); c('symlink add');
    commit({ 'blank.txt': '\n' }, 'blank line add');
    c('empty', '--allow-empty');
    commit({ 'd.txt': 'x\ny\n' }, 'pre'); git('rm', '-q', 'd.txt'); c('deletion only');
    commit({ 'm.sh': 'x\n' }, 'pre2'); spawnSync('chmod', ['+x', path.join(repo, 'm.sh')]); git('add', 'm.sh'); c('mode only');
    commitRaw({ 'bin.dat': Buffer.from([0, 1, 2]) }, 'binary add');
    commit({ 'zero.txt': '' }, '0-byte file');
    commit({ 'r1.txt': Array.from({ length: 50 }, (_, i) => i).join('\n') + '\n' }, 'pre3'); git('mv', 'r1.txt', 'r2.txt'); c('rename only');
    commit({ 'r3.txt': Array.from({ length: 50 }, (_, i) => i).join('\n') + '\n' }, 'pre4'); git('mv', 'r3.txt', 'r4.txt');
    writeFileSync(path.join(repo, 'r4.txt'), `${Array.from({ length: 50 }, (_, i) => i).join('\n')}\nmore\n`); git('add', 'r4.txt'); c('rename with edit');
    git('checkout', '-q', '-b', 'side'); commit({ 's.txt': 's\n' }, 'side'); git('checkout', '-q', 'main'); commit({ 'mm.txt': 'm\n' }, 'main change');
    git('merge', '-q', '--no-ff', 'side', '-m', 'clean merge');
    git('checkout', '-q', '-b', 's2'); commit({ 'conf.txt': 'one\n' }, 's2'); git('checkout', '-q', 'main'); commit({ 'conf.txt': 'two\n' }, 'm2');
    spawnSync('git', ['merge', 's2'], { cwd: repo, env: { ...process.env, ...env(), PATH: process.env.PATH } });
    writeFileSync(path.join(repo, 'conf.txt'), 'resolved\n'); git('add', 'conf.txt'); c('merge with a resolution');
    for (const b of ['o1', 'o2', 'o3']) { git('checkout', '-q', '-b', b, 'main'); commit({ [`${b}.txt`]: `${b}\n` }, b); }
    git('checkout', '-q', 'main');
    spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', 'merge', 'o1', 'o2', 'o3', '-m', 'octopus'], { cwd: repo, env: { ...process.env, ...env(), PATH: process.env.PATH } });
    git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'subm'); c('submodule add');
    git('checkout', '-q', '--orphan', 'rootb'); git('rm', '-rqf', '.'); commit({ 'r.txt': 'r\n' }, 'a second root commit');
    git('checkout', '-q', 'main');
    // (the one binary file of the matrix is named in the list: a binary file is otherwise red)
    const r = gateWith(tab('binary', 'bin.dat', blobId(Buffer.from([0, 1, 2])), 'a made-up binary file of the commit-kinds matrix'));
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('push-gate: passed'), r.out);
  });

  it('a key only in the resolution of a merge is found', () => {
    commit({ 'a.txt': 'one\n' });
    git('checkout', '-q', '-b', 's1'); commit({ 'conf.txt': 'one\n' }, 's1'); git('checkout', '-q', 'main'); commit({ 'conf.txt': 'two\n' }, 'm1');
    spawnSync('git', ['merge', 's1'], { cwd: repo, env: { ...process.env, ...env(), PATH: process.env.PATH } });
    writeFileSync(path.join(repo, 'conf.txt'), `token = ${fakeKey()}\n`); git('add', 'conf.txt'); git('commit', '-q', '-m', 'resolve');
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.ok(patches(r) >= 1, r.out);
  });

  it('a key carried only by an octopus merge is found, even when the next commit removes it', () => {
    commit({ 'a.txt': 'one\n' });
    for (const b of ['o1', 'o2', 'o3']) { git('checkout', '-q', '-b', b, 'main'); commit({ [`${b}.txt`]: `${b}\n` }, b); }
    git('checkout', '-q', 'main');
    const merged = spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', 'merge', '--no-commit', 'o1', 'o2', 'o3'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env(), PATH: process.env.PATH } });
    assert.equal(merged.status, 0, merged.stdout + merged.stderr);
    writeFileSync(path.join(repo, 'carried.txt'), `token = ${fakeKey()}\n`); git('add', 'carried.txt'); git('commit', '-q', '-m', 'octopus');
    assert.equal(git('rev-list', '--parents', '-1', 'HEAD').split(' ').length, 4, 'the commit has three parents and its own id');
    git('rm', '-q', 'carried.txt'); git('commit', '-q', '-m', 'remove it');
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.ok(patches(r) >= 1, r.out);
  });
});

/**
 * The scanner change (docs/known-gaps.md 15 to 17): one exclusion list (scripts/scan-exclusions.tsv, lines
 * `kind<TAB>path<TAB>value<TAB>reason`), unreadable content is red unless it is named, mail addresses are matched whole,
 * and the tree of HEAD is read the way a commit is.
 *
 * WHERE THE LIST COMES FROM: the gate reads `scan-exclusions.tsv` from its own scripts directory (next to push-gate.sh),
 * never from the scanned tree and never from the environment. Every test here runs a COPY of the scripts directory (see the
 * beforeEach above) whose list is empty; setList writes the list a test needs into the copy. No switch points the gate at
 * another file.
 *
 * THE COUNT LINES (the same shape as the key counts, one for the commits of the range and one for the tree of HEAD):
 *   `unreadable file(s): N`                     the files that the commits of the range add or change
 *   `unreadable file(s) in the tree of HEAD: N` the files of the tree of HEAD
 * A line with N = 0 may be left out. Every count assertion is exact.
 *
 * Keys and addresses are assembled at run time; the only literal addresses are on reserved domains.
 */
const tab = (...f) => `${f.join('\t')}\n`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const blobId = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
const patchesOf = (r) => Number(/\((\d+) finding\(s\) in patches/.exec(r.out)?.[1] ?? NaN);
const treeOf = (r) => Number(/(\d+) in the tree of HEAD\)/.exec(r.out)?.[1] ?? NaN);
const rangeUnr = (r) => Number(/unreadable file\(s\): (\d+)/.exec(r.out)?.[1] ?? 0);
const treeUnr = (r) => Number(/unreadable file\(s\) in the tree of HEAD: (\d+)/.exec(r.out)?.[1] ?? 0);
const setList = (list) => {
  const f = path.join(gscripts, 'scan-exclusions.tsv');
  if (list === null) rmSync(f, { force: true });
  else writeFileSync(f, list);
};
/** The gate (from the copy of the scripts) with `list` as its exclusion list. */
const gateWith = (list, args = ['--mode', 'general', '--all'], extra = {}) => { setList(list); return gateRun(args, extra); };
/** scan-public.sh of the copy, over every commit (or the given arguments). Faster than the gate: no gitleaks. */
const scanPublic = (args = [], list = '') => {
  setList(list);
  const r = spawnSync('/bin/sh', [path.join(gscripts, 'scan-public.sh'), ...args], { cwd: repo, encoding: 'utf8', env: env(), timeout: 30000 });
  assert.ok(r.error === undefined, `did not finish within 30 s: ${r.error?.message}`);
  return { status: r.status, out: r.stdout + r.stderr };
};
/** Like commit(), but the content is bytes (a Buffer) or text. */
const commitRaw = (files, message = 'change') => {
  for (const [name, data] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), data);
    git('add', '--', name);
  }
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
/** Commits files whose names are given as Buffers (bytes that a string cannot carry). */
const commitNamed = (named, message = 'change') => {
  for (const [name, data] of named) writeFileSync(Buffer.concat([Buffer.from(`${repo}/`), Buffer.isBuffer(name) ? name : Buffer.from(name)]), data);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
const scanPrText = (text, extra = {}) => {
  const f = path.join(dir, 'pr-text');
  writeFileSync(f, text);
  const r = spawnSync('/bin/sh', [path.join(gscripts, 'scan-pr-text.sh'), f], { cwd: repo, encoding: 'utf8', env: env(extra) });
  return { status: r.status, out: r.stdout + r.stderr };
};
const MAILMSG = 'email-like string: pull request title or body';
const WORDS = () => { const f = path.join(dir, 'words.txt'); writeFileSync(f, 'zzgatewordzz\n'); return f; };

describe('the scanner change: keys are found everywhere, and a `keys` entry silences one content at one path (known-gaps 16(a))', () => {
  it('A2: keys under node_modules/ and in a .svg, added BEFORE the range, are counted in the tree of HEAD', () => {
    commit({ 'a.txt': 'one\n' });
    const base = commit({ 'node_modules/pkg/cfg.txt': `token = ${fakeKey()}\n`, 'logo.svg': `<!-- token = ${fakeKey()} -->\n` });
    commit({ 'b.txt': 'two\n' });
    const r = general('--base', base);
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), 0, r.out);
    assert.equal(treeOf(r), 2, `the tree scan skipped a path of gitleaks' default allowlist: ${r.out}`);
  });

  const TOMLS = ['gitleaks.toml', '.gitleaks.toml', 'sub/dir/gitleaks.toml', 'sub/.gitleaks.toml'];
  it('A3: a key in gitleaks.toml or .gitleaks.toml, at the top and in a subdirectory, is found in history and in the tree', () => {
    commit(Object.fromEntries(TOMLS.map((n) => [n, `# note\ntoken = ${fakeKey()}\n`])));
    const r = general();
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), TOMLS.length, r.out);
    assert.equal(treeOf(r), TOMLS.length, r.out);
  });
  it('A3: the same files, added before the range, are found in the tree of HEAD', () => {
    const base = commit(Object.fromEntries(TOMLS.map((n) => [n, `# note\ntoken = ${fakeKey()}\n`])));
    commit({ 'b.txt': 'two\n' });
    const r = general('--base', base);
    assert.equal(r.status, 1, r.out);
    assert.equal(treeOf(r), TOMLS.length, r.out);
  });

  const P = 'fixtures/sample.txt';
  const keyText = () => `token = ${fakeKey()}\n`;
  const keysFor = (p, text) => tab('keys', p, blobId(Buffer.from(text)), 'a made-up key in a made-up fixture');
  it('A4: a `keys` entry (path and blob id) lets that content at that path pass, in history and in the tree', () => {
    const t = keyText();
    commit({ [P]: t });
    const r = gateWith(keysFor(P, t));
    assert.equal(r.status, 0, `the entry did not silence its own path and content: ${r.out}`);
  });
  it('A4: a sibling, a name that only looks alike (.bak, sampleXtxt: the dot is not a wildcard) and x/P are all still found', () => {
    const t = keyText();
    commit({ [P]: t, [`${P}.bak`]: keyText(), 'fixtures/sampleXtxt': keyText(), 'fixtures/other.txt': keyText(), [`x/${P}`]: keyText() });
    const r = gateWith(keysFor(P, t));
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), 4, `exactly the four other files must be found: ${r.out}`);
    assert.equal(treeOf(r), 4, r.out);
  });
  it('A4: a file below the listed path (P/inner) is found', () => {
    commit({ [`${P}/inner`]: keyText() });
    const r = gateWith(keysFor(P, keyText()));
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), 1, r.out);
    assert.equal(treeOf(r), 1, r.out);
  });
  it('A4: an entry for the directory (fixtures) does not silence a file in it', () => {
    const t = keyText();
    commit({ [P]: t });
    const r = gateWith(keysFor('fixtures', t));
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), 1, r.out);
    assert.equal(treeOf(r), 1, r.out);
  });
  it('A4: the same key at the listed path with other content is found (the entry is bound to the blob id)', () => {
    const t = keyText();
    commit({ [P]: `${t}# edited\n` });
    const r = gateWith(keysFor(P, t));
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), 1, r.out);
    assert.equal(treeOf(r), 1, r.out);
  });
  it('A4: a `keys` entry does not silence a mail string or a word of the list at that path', () => {
    const t = `token = ${fakeKey()}\ncontact ${['someone', 'corp-mail.test'].join('@')} zzgatewordzz\n`;
    commit({ [P]: t });
    const r = gateWith(keysFor(P, t), ['--mode', 'words', '--all'], { SCAN_WORDS_FILE: WORDS() });
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step gitleaks: ok'), `the key must be silenced: ${r.out}`);
    assert.ok(r.out.includes('word list: 1 file(s) in'), r.out);
    assert.ok(/email-like string: 1 hit\(s\) in/.test(r.out), r.out);
  });
  it('A4: a `keys` entry does not silence an unreadable file at that path', () => {
    const bin = Buffer.from([0, 1, 2, 3]);
    commitRaw({ [P]: bin });
    const r = gateWith(tab('keys', P, blobId(bin), 'a made-up reason'));
    assert.equal(r.status, 1, r.out);
    assert.equal(rangeUnr(r), 1, r.out);
    assert.equal(treeUnr(r), 1, r.out);
  });
});

describe('the scanner change: what the scans cannot read is red unless it is named (known-gaps 16(e))', () => {
  const NUL = Buffer.from([0, 1, 2, 3, 0, 255]);
  const words = () => ({ SCAN_WORDS_FILE: WORDS() });
  const both = (fn) => { for (const [mode, extra] of [['general', {}], ['words', words()]]) fn(mode, (list) => gateWith(list, ['--mode', mode, '--all'], extra)); };
  const entry = (p, buf, list = '') => `${list}${tab('binary', p, blobId(buf), 'a made-up binary fixture')}`;

  it('B2: a `binary` entry (path and blob id) lets exactly that blob pass', () => {
    commitRaw({ 'assets/blob.bin': NUL });
    const r = gateWith(entry('assets/blob.bin', NUL));
    assert.equal(r.status, 0, r.out);
  });
  it('B2: changed content at that path is red again (the entry is bound to the blob id)', () => {
    commitRaw({ 'assets/blob.bin': Buffer.from([9, 0, 9, 0]) });
    const r = gateWith(entry('assets/blob.bin', NUL));
    assert.equal(r.status, 1, r.out);
    assert.equal(rangeUnr(r), 1, r.out);
    assert.equal(treeUnr(r), 1, r.out);
  });
  it('B2: the same content at another path is red (the entry is bound to the path)', () => {
    commitRaw({ 'assets/blob.bin': NUL, 'elsewhere/copy.bin': NUL });
    const r = gateWith(entry('assets/blob.bin', NUL));
    assert.equal(r.status, 1, r.out);
    assert.equal(rangeUnr(r), 1, r.out);
    assert.equal(treeUnr(r), 1, r.out);
  });
  it('B2: a listed binary renamed in a later commit is red at the new path', () => {
    commitRaw({ 'assets/a.bin': NUL });
    git('mv', 'assets/a.bin', 'assets/b.bin');
    git('commit', '-q', '-m', 'rename');
    const r = gateWith(entry('assets/a.bin', NUL));
    assert.equal(r.status, 1, r.out);
    assert.equal(rangeUnr(r), 1, r.out);
    assert.equal(treeUnr(r), 1, r.out);
  });

  const KINDS = {
    'a UTF-16 file with a byte order mark (ASCII text, so NUL bytes)': Buffer.from('﻿plain words here\n', 'utf16le'),
    'a UTF-16 file with a byte order mark (CJK text, no NUL byte)': Buffer.from('﻿漢字漢字\n', 'utf16le'),
    'a UTF-16 file without a byte order mark (CJK text, not valid UTF-8)': Buffer.from('龟誊龟誊龟\n', 'utf16le'),
    'a latin-1 file (not valid UTF-8, no NUL byte)': Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from(' plain words\n')]),
    'a file whose first NUL byte is after the 8000 bytes git looks at': Buffer.concat([Buffer.from('a'.repeat(8050)), Buffer.from([0]), Buffer.from('b\n')]),
  };
  for (const [label, buf] of Object.entries(KINDS)) {
    it(`B3: ${label} is red (range 1, tree 1)`, () => {
      commitRaw({ 'notes.txt': buf });
      const r = general();
      assert.equal(r.status, 1, r.out);
      assert.equal(rangeUnr(r), 1, r.out);
      assert.equal(treeUnr(r), 1, r.out);
    });
  }

  it('B3: a binary file added in commit 2 and deleted in commit 3 is red through the range (1), not through the tree, in both modes', () => {
    commit({ 'a.txt': 'one\n' });
    commitRaw({ 'blob.bin': NUL });
    git('rm', '-q', 'blob.bin');
    git('commit', '-q', '-m', 'delete');
    both((mode, run) => {
      const r = run('');
      assert.equal(r.status, 1, `${mode}: ${r.out}`);
      assert.equal(rangeUnr(r), 1, `${mode}: ${r.out}`);
      assert.equal(treeUnr(r), 0, `${mode}: ${r.out}`);
    });
  });
  it('B3: the same for a key-free latin-1 file', () => {
    commit({ 'a.txt': 'one\n' });
    commitRaw({ 'notes1.txt': KINDS['a latin-1 file (not valid UTF-8, no NUL byte)'] });
    git('rm', '-q', 'notes1.txt');
    git('commit', '-q', '-m', 'delete');
    both((mode, run) => {
      const r = run('');
      assert.equal(r.status, 1, `${mode}: ${r.out}`);
      assert.equal(rangeUnr(r), 1, `${mode}: ${r.out}`);
      assert.equal(treeUnr(r), 0, `${mode}: ${r.out}`);
    });
  });

  it('B4: a binary file added before the range is red through the tree of HEAD only', () => {
    commit({ 'a.txt': 'one\n' });
    const base = commitRaw({ 'assets/blob.bin': NUL });
    commit({ 'b.txt': 'two\n' });
    const r = general('--base', base);
    assert.equal(r.status, 1, r.out);
    assert.equal(rangeUnr(r), 0, r.out);
    assert.equal(treeUnr(r), 1, r.out);
  });

  it('B-neg: valid UTF-8 Japanese text, a 0-byte file, a symlink and a submodule gitlink are not red, in history and in the tree', () => {
    const sub = path.join(dir, 'submodule-source');
    mkdirSync(sub);
    const inSub = (...a) => spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...a], { cwd: sub, encoding: 'utf8', env: { ...process.env, ...env(), PATH: process.env.PATH } });
    inSub('init', '-q', '-b', 'main');
    writeFileSync(path.join(sub, 'f'), 'x\n');
    inSub('add', 'f');
    inSub('commit', '-q', '-m', 'i');
    commit({ 'jp.txt': '日本語のテキスト\n' });
    commit({ 'empty.txt': '' });
    symlinkSync('target', path.join(repo, 'link'));
    git('add', 'link');
    git('commit', '-q', '-m', 'symlink');
    git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'subm');
    git('commit', '-q', '-m', 'submodule');
    const r = general();
    assert.equal(r.status, 0, r.out);
    assert.ok(!r.out.includes('unreadable'), r.out);
  });

  // File names: the list is a text file with one entry per line, so a name that cannot be written in it cannot be named.
  const BAD_NAMES = {
    'a line feed': Buffer.from('a\nb.txt'),
    'a control character': Buffer.from('a\u0001b.txt'),
    'a tab': Buffer.from('a\tb.txt'),
    'a byte that is not UTF-8': Buffer.concat([Buffer.from('a'), Buffer.from([0xff]), Buffer.from('b.txt')]),
  };
  for (const [label, name] of Object.entries(BAD_NAMES)) {
    it(`B5: a file name with ${label} is exit 2 (it cannot be named in the list)`, () => {
      commitNamed([[name, 'text\n']]);
      const r = general();
      assert.equal(r.status, 2, r.out);
      assert.ok(!r.out.includes('push-gate: passed'), r.out);
    });
  }
  it('B5: a file name with a line feed, added before the range, is exit 2 through the tree of HEAD', () => {
    commit({ 'a.txt': 'one\n' });
    const base = commitNamed([[BAD_NAMES['a line feed'], 'text\n']]);
    commit({ 'b.txt': 'two\n' });
    const r = general('--base', base);
    assert.equal(r.status, 2, r.out);
    assert.ok(!r.out.includes('push-gate: passed'), r.out);
  });

  const ODD = ['with space.bin', 'q"uote.bin', 'back\\slash.bin', '-dash.bin', 'ユニ.bin'];
  it('B-names: a space, a quote, a backslash, a leading dash and a UTF-8 name are scanned like any other (red) and each matchable by an entry', () => {
    ODD.forEach((n, i) => commitNamed([[n, Buffer.from([i + 1, 0, i + 1])]]));
    let r = general();
    assert.equal(r.status, 1, r.out);
    assert.equal(rangeUnr(r), ODD.length, r.out);
    assert.equal(treeUnr(r), ODD.length, r.out);
    r = gateWith(ODD.map((n, i) => tab('binary', n, blobId(Buffer.from([i + 1, 0, i + 1])), 'a made-up binary fixture')).join(''));
    assert.equal(r.status, 0, r.out);
  });
});

describe('the scanner change: a mail address is matched whole (known-gaps 16(b))', () => {
  const at = (user, host) => `${user}@${host}`;
  // The old prefix-style entries of scan-rules.sh, each with a tail (or an ending that is only file-like).
  const WITH_TAIL = {
    '@types.<tld>': at('a', 'types.test'),
    '@kaninabe.<tld>': at('a', 'kaninabe.test'),
    '@supabase.<tld>': at('a', 'supabase.test'),
    '@vitest.<tld>': at('a', 'vitest.test'),
    '@next.<tld>': at('a', 'next.test'),
    '@axiomhq.<tld>': at('a', 'axiomhq.test'),
    '@<digit>corp.<tld>': at('a', '1corp.test'),
    'evil... at the start': at('evil.person', 'corp-mail.test'),
    'git@github.com.<x>': at('git', 'github.com.test'),
    '@registry.npmjs.org.<x>': at('a', 'registry.npmjs.org.test'),
    '@api.axiom.co.<x>': at('a', 'api.axiom.co.test'),
    '@auth.external.<x>': at('a', 'auth.external.test'),
    '@127.0.0.1.<x>': at('a', '127.0.0.1.test'),
    '@users.noreply.github.com.<x>': at('a', 'users.noreply.github.com.test'),
    ...Object.fromEntries(['md', 'ts', 'tsx', 'js', 'mjs', 'json', 'png', 'svg'].map((e) => [`ends like a file name (.${e})`, at('readme', `host.${e}`)])),
  };

  for (const [label, addr] of Object.entries(WITH_TAIL)) {
    it(`C1: ${label} is red in the text of a pull request`, () => {
      const r = scanPrText(`note ${addr} end\n`);
      assert.equal(r.status, 1, `${r.out}`);
      assert.ok(r.out.includes(MAILMSG), r.out);
    });
  }
  it('C1: one of them in a file of a commit is red, with an exact count', () => {
    commit({ 'notes.txt': `contact ${WITH_TAIL['evil... at the start']}\n` });
    const r = scanPublic();
    assert.equal(r.status, 1, r.out);
    assert.ok(/email-like string: 1 hit\(s\) in/.test(r.out), r.out);
  });
  it('C1: one of them in a commit message is red', () => {
    commit({ 'a.txt': 'one\n' }, `contact ${WITH_TAIL['@<digit>corp.<tld>']}`);
    const r = scanPublic();
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('email-like string in the message of'), r.out);
  });

  it('C2 (guard): the allowed set passes in text: any host ending .example, example.com/.org/.net, the noreply forms, git@github.com, a digits-only last label', () => {
    const ok = [
      at('a', 'host.example'), at('a', 'sub.host.example'), at('a', 'example.com'), at('a', 'example.org'), at('a', 'example.net'),
      at('a', 'users.noreply.github.com'), at('12345+a-b_c', 'users.noreply.github.com'),
      at('git', 'github.com'),
      at('pkg', '1.2.3'), at('pkg', '10.0.0'), at('user', '127.0.0.1'),
    ];
    for (const addr of ok) {
      const r = scanPrText(`note ${addr} end\n`);
      assert.equal(r.status, 0, `${addr}: ${r.out}`);
    }
  });
  it('C2 (guard): .test, .invalid and .localhost are NOT in the allowed set, nor is a subdomain of example.com, nor the web-flow noreply address as text', () => {
    for (const addr of [at('a', 'host.test'), at('a', 'host.invalid'), at('a', 'host.localhost'), at('a', 'sub.example.com'), at('a', 'example.com.test'), at('noreply', 'github.com')]) {
      const r = scanPrText(`note ${addr} end\n`);
      assert.equal(r.status, 1, `${addr}: ${r.out}`);
      assert.ok(r.out.includes(MAILMSG), `${addr}: ${r.out}`);
    }
  });
  it('C2 (guard): GitHub\'s web-flow address still passes as the committer of a commit (it is an identity, not text)', () => {
    commit({ 'a.txt': 'one\n' });
    writeFileSync(path.join(repo, 'b.txt'), 'two\n');
    git('add', 'b.txt');
    const r0 = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'web'], {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, ...env(), PATH: process.env.PATH, GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: at('tester', 'users.noreply.github.com'), GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: at('noreply', 'github.com') },
    });
    assert.equal(r0.status, 0, r0.stderr);
    const r = scanPublic();
    assert.equal(r.status, 0, r.out);
  });

  for (const [label, sign] of [['full-width (U+FF20)', '＠'], ['small (U+FE6B)', '﹫']]) {
    for (const loc of ['C', 'C.UTF-8']) {
      it(`C3: an address with the ${label} at sign is red in the text of a pull request (locale ${loc})`, () => {
        const r = scanPrText(`note ${at('user', 'corp-mail.test').replace('@', sign)} end\n`, { LC_ALL: loc });
        assert.equal(r.status, 1, r.out);
        assert.ok(r.out.includes(MAILMSG), r.out);
      });
    }
    it(`C3: an address with the ${label} at sign in a file of a commit is red, with an exact count`, () => {
      commit({ 'notes.txt': `contact ${at('user', 'corp-mail.test').replace('@', sign)}\n` });
      const r = scanPublic();
      assert.equal(r.status, 1, r.out);
      assert.ok(/email-like string: 1 hit\(s\) in/.test(r.out), r.out);
    });
  }

  describe('C4: a `mail` entry allows that exact string in its path only; several entries may name one path', () => {
    const owner = at('owner', 'corp-mail.test');
    const second = at('second', 'corp-mail.test');
    const entry = (s, p = 'docs/contact.txt') => tab('mail', p, `sha256:${sha256(s)}`, 'a made-up contact of a made-up fixture');
    it('the string in its path passes', () => {
      commit({ 'docs/contact.txt': `contact ${owner}\n` });
      assert.equal(scanPublic([], entry(owner)).status, 0);
    });
    it('two entries for one path: both strings pass, a third is red', () => {
      commit({ 'docs/contact.txt': `contact ${owner} and ${second}\n` });
      assert.equal(scanPublic([], entry(owner) + entry(second)).status, 0);
      commit({ 'docs/contact.txt': `contact ${owner} and ${second} and ${at('third', 'corp-mail.test')}\n` });
      const r = scanPublic([], entry(owner) + entry(second));
      assert.equal(r.status, 1, r.out);
      assert.ok(/email-like string: 1 hit\(s\) in/.test(r.out), r.out);
    });
    it('the same string in another path is red', () => {
      commit({ 'docs/contact.txt': `contact ${owner}\n`, 'docs/other.txt': `contact ${owner}\n` });
      const r = scanPublic([], entry(owner));
      assert.equal(r.status, 1, r.out);
      assert.ok(/email-like string: 1 hit\(s\) in/.test(r.out), r.out);
    });
    it('the same string in a commit message is red', () => {
      commit({ 'docs/contact.txt': `contact ${owner}\n` }, `note ${owner}`);
      const r = scanPublic([], entry(owner));
      assert.equal(r.status, 1, r.out);
      assert.ok(r.out.includes('email-like string in the message of'), r.out);
    });
    it('another address in the listed path is red', () => {
      commit({ 'docs/contact.txt': `contact ${owner} and ${second}\n` });
      const r = scanPublic([], entry(owner));
      assert.equal(r.status, 1, r.out);
      assert.ok(/email-like string: 1 hit\(s\) in/.test(r.out), r.out);
    });
    it('an address that only starts with the listed string is red', () => {
      commit({ 'docs/contact.txt': `contact ${owner}.more\n` });
      assert.equal(scanPublic([], entry(owner)).status, 1);
    });
  });

  describe('C5: a 3 MB single line is scanned in time, with an exact count (green before the change, except the full-width case)', () => {
    const count = (r) => Number(/email-like string: (\d+) hit\(s\)/.exec(r.out)?.[1] ?? NaN);
    it('with K addresses in it: exactly K hits', () => {
      const k = 3000;
      const piece = 'lorem ipsum '.repeat(Math.floor((3 * 1024 * 1024) / k / 12));
      let line = '';
      for (let i = 0; i < k; i += 1) line += `${piece}${at(`user${i}`, 'corp-mail.test')} `;
      commit({ 'long.txt': `${line}\n` });
      const r = scanPublic();
      assert.equal(r.status, 1, r.out);
      assert.equal(count(r), k, r.out);
    });
    it('with 180000 addresses in it (nothing but addresses): exactly 180000 hits', () => {
      commit({ 'long.txt': `${`${at('a', 'corp-mail.test')} `.repeat(180000)}\n` });
      const r = scanPublic();
      assert.equal(r.status, 1, r.out);
      assert.equal(count(r), 180000, r.out);
    });
    it('with K addresses written with the full-width at sign (U+FF20): exactly K hits', () => {
      const k = 3000;
      const piece = 'lorem ipsum '.repeat(Math.floor((3 * 1024 * 1024) / k / 12));
      let line = '';
      for (let i = 0; i < k; i += 1) line += `${piece}${at(`user${i}`, 'corp-mail.test').replace('@', '＠')} `;
      commit({ 'long.txt': `${line}\n` });
      const r = scanPublic();
      assert.equal(r.status, 1, r.out);
      assert.equal(count(r), k, r.out);
    });
    it('with no at sign in it: clean', () => {
      commit({ 'long.txt': `${'lorem ipsum '.repeat(Math.floor((3 * 1024 * 1024) / 12))}\n` });
      const r = scanPublic();
      assert.equal(r.status, 0, r.out);
      assert.ok(r.out.includes('scan-public: clean'), r.out);
    });
  });
});

describe('the scanner change: the tree of HEAD does not lose a key at a chunk boundary (known-gaps 16(h), 17)', () => {
  it('D1: one long line with K keys at multiples of 100000 bytes (give or take 20), added before the range: exactly K in the tree of HEAD', () => {
    // Measured on the code before the change (gitleaks 8.30.0, `gitleaks dir`): K = 20 (a 2 MB line) finds all 20, K = 100
    // (a 10 MB line) finds 99, every run. K = 100 is used so that the test is red until the tree is read the way a commit is.
    const k = 100;
    const starts = Array.from({ length: k }, (_, i) => (i + 1) * 100000 + [-20, -10, 0, 10, 20][i % 5]);
    let line = '';
    for (const s of starts) {
      line += 'lorem ipsum '.repeat(Math.ceil((s - line.length) / 12)).slice(0, Math.max(0, s - line.length));
      line += `qqqqq = ${fakeKey()} `;
    }
    line += 'lorem ipsum '.repeat(200);
    commit({ 'a.txt': 'one\n' });
    const base = commit({ 'long.txt': `${line}\n` });
    commit({ 'b.txt': 'two\n' });
    const r = general('--base', base);
    assert.equal(r.status, 1, r.out);
    assert.equal(patchesOf(r), 0, r.out);
    assert.equal(treeOf(r), k, `keys at chunk boundaries were lost in the tree scan: ${r.out}`);
  });
});
