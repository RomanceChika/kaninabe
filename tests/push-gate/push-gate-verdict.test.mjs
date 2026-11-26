/**
 * VERDICT tests of the push-before gate: scripts/push-gate.sh and scripts/gitleaks-public.sh with the REAL gitleaks and
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

describe('scripts/gitleaks-public.sh: what the old CI steps print, with the real gitleaks', () => {
  const run = (args, cwd = repo) => {
    const r = spawnSync('/bin/sh', [path.join(path.dirname(gate), 'gitleaks-public.sh'), ...args], { cwd, encoding: 'utf8', env: env() });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const secretRepo = (key) => {
    mkdirSync(path.join(repo, 'secret-dir'));
    git('config', 'user.name', 'Some Author');
    commit({ 'secret-dir/conf.txt': `note token = ${key} trailing words\n` }, 'a message');
  };

  it('a finding prints a count, and no rule name, path, commit id, author, line or key', () => {
    const key = fakeKey();
    secretRepo(key);
    for (const mode of ['dir', 'git']) {
      const r = run([mode, '.']);
      assert.equal(r.status, 1, r.out);
      assert.ok(r.out.includes(`gitleaks ${mode}: FAILED (1 finding(s))`), r.out);
      assert.ok(!/rule /.test(r.out) && !r.out.includes('github-pat'), r.out);
      for (const leak of ['secret-dir', 'conf.txt', 'Some Author', 'trailing words', key.slice(4, 20), git('rev-parse', 'HEAD').slice(0, 8)]) {
        assert.ok(!r.out.includes(leak), `"${leak}" reached the output: ${r.out}`);
      }
    }
  });

  it('a clean tree prints ok; an error prints the exit code and no path', () => {
    commit({ 'a.txt': 'one\n' });
    assert.ok(run(['dir', '.']).out.includes('gitleaks dir: ok'));
    const r = run(['dir', path.join(dir, 'secret-missing-dir')]);
    assert.equal(r.status, 2, r.out);
    assert.ok(/gitleaks dir: could not run \(exit \d+\)/.test(r.out), r.out);
    assert.ok(!r.out.includes('secret-missing-dir'), r.out);
    assert.equal(run(['nonsense']).status, 2);
  });
});

describe('scripts/gitleaks-public.sh with the real gitleaks: nothing in the scanned tree can change what it reads or prints (review round 8)', () => {
  const run = (args) => {
    const r = spawnSync('/bin/sh', [path.join(path.dirname(gate), 'gitleaks-public.sh'), ...args], { cwd: repo, encoding: 'utf8', env: env() });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  it('an in-tree config that names its own rule does not get its rule id into the output (the config is not read)', () => {
    const marker = 'attackerchosenword';
    commit({
      '.gitleaks.toml': `[[rules]]\nid = "zz-attacker-chosen-text"\ndescription = "x"\nregex = '''${marker}'''\n`,
      'x.txt': `${marker}\n`,
    });
    for (const mode of ['dir', 'git']) {
      const r = run([mode, '.']);
      assert.equal(r.status, 0, `${mode}: ${r.out}`);
      assert.ok(!r.out.includes('zz-attacker'), r.out);
      assert.ok(r.out.includes(`gitleaks ${mode}: ok`), r.out);
    }
  });

  it('an in-tree .gitleaksignore and an inline gitleaks:allow do not silence a key', () => {
    const key = fakeKey();
    commit({ 'conf.txt': `token = ${key}\n`, '.gitleaksignore': 'conf.txt:github-pat:1\n' });
    let r = run(['dir', '.']);
    assert.equal(r.status, 1, `.gitleaksignore: ${r.out}`);
    assert.ok(r.out.includes('FAILED (1 finding(s))'), r.out);
    commit({ 'conf.txt': `token = ${key} # gitleaks:allow\n` });
    for (const mode of ['dir', 'git']) {
      r = run([mode, '.']);
      assert.equal(r.status, 1, `${mode} with inline allow: ${r.out}`);
    }
  });

  it('state inside the repository (local config, info/attributes, a replace ref) does not silence the git scan either', () => {
    const key = fakeKey();
    commit({ 'a.txt': 'one\n' });
    const c2 = commit({ 'conf.txt': `token = ${key}\n` });
    git('rm', '-q', 'conf.txt');
    git('commit', '-q', '-m', 'remove');
    mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'info', 'attributes'), '* -diff\n');
    git('config', 'color.diff', 'always');
    git('replace', c2, git('rev-parse', 'HEAD~2'));
    const r = run(['git', '.']);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('FAILED (1 finding(s))'), r.out);
  });
});

describe('real gitleaks: the old-step wrapper reads a history with a merge and a root commit (review round 12, P1)', () => {
  // (The gate's own run over merges, roots and every other kind of commit is the commit-kinds matrix below; a key in a merge
  // resolution and in an octopus merge are the tests after it. What only this test holds is the wrapper's `git` mode on them.)
  it('passes, and says ok', () => {
    commit({ 'a.txt': 'one\n' });
    git('checkout', '-q', '-b', 'side');
    commit({ 'b.txt': 'two\n' });
    git('checkout', '-q', 'main');
    commit({ 'c.txt': 'three\n' });
    git('merge', '-q', '--no-ff', 'side', '-m', 'merge');
    commit({ 'd.txt': 'four\n' });
    const w = spawnSync('/bin/sh', [path.join(path.dirname(gate), 'gitleaks-public.sh'), 'git', '.'], { cwd: repo, encoding: 'utf8', env: env() });
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.ok((w.stdout + w.stderr).includes('gitleaks git: ok'), w.stdout + w.stderr);
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

  it('KNOWN GAP (scanner change): a key in a file on gitleaks\' default path allowlist (node_modules, a .svg) is not found in history (known-gaps 16(a))', () => {
    commit({ 'a.txt': 'one\n' });
    commit({ 'node_modules/pkg/cfg.txt': `token = ${fakeKey()}\n`, 'logo.svg': `<!-- token = ${fakeKey()} -->\n` });
    const r = general();
    assert.equal(r.status, 0, r.out);
  });

  it('KNOWN GAP (scanner change): a key in a file that git treats as binary is not in the patch, so it is not found (as before)', () => {
    commit({ 'a.txt': 'one\n' });
    commit({ 'blob.bin': Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`token = ${fakeKey()}\n`)]).toString('latin1') });
    const r = general();
    assert.equal(r.status, 0, r.out);
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
    commit({ 'bin.dat': '\u0000\u0001\u0002' }, 'binary add');
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
    const r = general();
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
