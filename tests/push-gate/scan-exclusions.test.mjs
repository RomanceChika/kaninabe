/**
 * The one exclusion list of the scans (scripts/scan-exclusions.tsv) and the rule that there is no other way to skip a file.
 *
 * The grammar: one entry per line, four fields separated by a tab, `kind<TAB>path<TAB>value<TAB>reason`.
 *   - path: literal. No `*`, `?`, `[` or `]`, no leading `/`, no `..` segment, no trailing `/`, no control character.
 *   - kind `binary`: value is the blob id (40 lowercase hex digits); content that changed is red again.
 *   - kind `mail`: value is `sha256:<64 lowercase hex digits>` of the exact string (the list holds no address).
 *   - kind `keys`: value is `-`; the key scan skips exactly that path.
 *   - reason: not empty.
 * A line that does not fit, or an unknown kind, stops the gate with exit 2. The list is read from the gate's own scripts
 * directory (next to push-gate.sh), never from the scanned tree and never from the environment: a test that needs a list runs
 * a copy of the scripts directory with the list written into the copy.
 *
 * "No other mechanism" is checked two ways: the gitleaks configuration holds no global allowlist (the tool's built-in one comes
 * with `useDefault = true`), and no script contains a pathspec, an `--exclude` or a glob that skips files.
 *
 * Fake keys are assembled at run time and written only into throwaway repositories.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scriptsDir = path.join(root, 'scripts');
const LIST = path.join(scriptsDir, 'scan-exclusions.tsv');

// ---- the grammar ----

/** The problems of one line of the list (an empty array = a valid line). */
export function problems(line) {
  const f = line.split('\t');
  if (f.length !== 4) return [`${f.length} fields, not 4`];
  const [kind, p, value, reason] = f;
  const out = [];
  if (!['binary', 'mail', 'keys'].includes(kind)) out.push('unknown kind');
  if (p === '') out.push('empty path');
  if (/[*?[\]]/.test(p)) out.push('glob character in the path');
  if (p.startsWith('/')) out.push('leading slash');
  if (p.endsWith('/')) out.push('trailing slash');
  if (p.split('/').includes('..')) out.push('.. in the path');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) out.push('control character in the path');
  if (kind === 'binary' && !/^[0-9a-f]{40}$/.test(value)) out.push('binary value is not a blob id');
  if (kind === 'mail' && !/^sha256:[0-9a-f]{64}$/.test(value)) out.push('mail value is not sha256:<hex>');
  if (kind === 'keys' && value !== '-') out.push('keys value is not -');
  if (reason.trim() === '') out.push('empty reason');
  return out;
}

const H40 = 'a'.repeat(40);
const H64 = 'b'.repeat(64);
const VALID = [
  `binary\tassets/blob.bin\t${H40}\ta made-up binary fixture`,
  `mail\tdocs/contact.txt\tsha256:${H64}\ta made-up address in a made-up fixture`,
  'keys\tfixtures/sample.txt\t-\ta made-up key in a made-up fixture',
];
const MALFORMED = {
  'too few fields': 'keys\tfixtures/sample.txt\t-',
  'too many fields': 'keys\tfixtures/sample.txt\t-\treason\textra',
  'unknown kind': 'other\tfixtures/sample.txt\t-\treason',
  'a glob (*)': 'keys\tfixtures/*.txt\t-\treason',
  'a glob (?)': 'keys\tfixtures/sample?.txt\t-\treason',
  'a glob ([)': 'keys\tfixtures/sample[1].txt\t-\treason',
  'a leading slash': 'keys\t/fixtures/sample.txt\t-\treason',
  'a .. segment': 'keys\tfixtures/../sample.txt\t-\treason',
  'a trailing slash': 'keys\tfixtures/\t-\treason',
  'an empty path': 'keys\t\t-\treason',
  'a binary value that is not a blob id': 'binary\tassets/blob.bin\tnot-a-blob-id\treason',
  'a mail value without the sha256: prefix': `mail\tdocs/contact.txt\t${H64}\treason`,
  'a mail value of the wrong length': 'mail\tdocs/contact.txt\tsha256:abc\treason',
  'a keys value that is not -': 'keys\tfixtures/sample.txt\tfixtures\treason',
  'an empty reason': 'keys\tfixtures/sample.txt\t-\t',
};

describe('the grammar of scripts/scan-exclusions.tsv', () => {
  it('(guard) the checker accepts the valid forms and names every malformed one', () => {
    for (const l of VALID) assert.deepEqual(problems(l), [], l);
    for (const [label, l] of Object.entries(MALFORMED)) assert.ok(problems(l).length > 0, `not refused: ${label}`);
  });

  it('every line of the list is a valid entry', () => {
    assert.ok(existsSync(LIST), 'scripts/scan-exclusions.tsv does not exist: the gate reads its one exclusion list from there');
    const text = readFileSync(LIST, 'utf8');
    const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
    const bad = lines.map((l, i) => [i + 1, problems(l)]).filter(([, p]) => p.length);
    assert.deepEqual(bad, [], `invalid line(s) of the list (number, problems): ${JSON.stringify(bad)}`);
    const seen = new Set();
    for (const l of lines) {
      const key = l.split('\t').slice(0, 2).join('\t');
      assert.ok(!seen.has(key), `the same kind and path twice: ${key.split('\t')[1]}`);
      seen.add(key);
    }
  });
});

// ---- the gate with a list (a small harness, real tools) ----

const CORE = [
  'sh', 'git', 'grep', 'sed', 'cut', 'wc', 'tr', 'head', 'tail', 'mktemp', 'rm', 'cat', 'dirname', 'basename', 'tar',
  'awk', 'sort', 'uniq', 'mkdir', 'ls', 'find', 'env', 'true', 'false', 'cp', 'mv', 'date', 'less',
];
const find = (name, searchPath) => {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: { PATH: searchPath } });
  const p = r.stdout.trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
};
const real = { gitleaks: find('gitleaks', process.env.PATH ?? ''), actionlint: find('actionlint', process.env.PATH ?? '') };
const missing = Object.entries(real).filter(([, p]) => !p).map(([n]) => n);
const fakeKey = () => ['gh', 'p_'].join('') + randomBytes(60).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 36).padEnd(36, 'x');

describe('the gate and the list', () => {
  let dir;
  let repo;
  let bin;
  const env = () => ({ PATH: bin, HOME: path.join(dir, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' });
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
      git('add', '--', name);
    }
    git('commit', '-q', '-m', message);
  };
  /** The gate from a copy of the scripts directory with `list` as its scan-exclusions.tsv (no list written when `list` is null). */
  const gateWith = (list) => {
    const copy = path.join(dir, 'gate-scripts');
    rmSync(copy, { recursive: true, force: true });
    cpSync(scriptsDir, copy, { recursive: true });
    if (list !== null) writeFileSync(path.join(copy, 'scan-exclusions.tsv'), list);
    const r = spawnSync('/bin/sh', [path.join(copy, 'push-gate.sh'), '--mode', 'general', '--all'], { cwd: repo, encoding: 'utf8', env: env() });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const gateReal = () => {
    const r = spawnSync('/bin/sh', [path.join(scriptsDir, 'push-gate.sh'), '--mode', 'general', '--all'], { cwd: repo, encoding: 'utf8', env: env() });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  beforeEach(() => {
    if (missing.length) throw new Error(`${missing.join(' and ')} not installed: run "sh scripts/setup-dev-env.sh --bin-dir <dir on PATH>" first`);
    dir = mkdtempSync(path.join(tmpdir(), 'scan-exclusions-'));
    bin = path.join(dir, 'bin');
    mkdirSync(bin);
    for (const n of CORE) { const p = find(n, '/usr/bin:/bin:/usr/local/bin'); if (p) symlinkSync(p, path.join(bin, n)); }
    for (const [n, p] of Object.entries(real)) symlinkSync(p, path.join(bin, n));
    repo = path.join(dir, 'repo');
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    commit({ 'a.txt': 'one\n' });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('(guard) a list with one valid entry of each kind is accepted', () => {
    const r = gateWith(`${VALID.join('\n')}\n`);
    assert.equal(r.status, 0, r.out);
  });

  for (const [label, line] of Object.entries(MALFORMED)) {
    it(`a list with ${label} stops the gate with exit 2 and names the list`, () => {
      const r = gateWith(`${VALID[2]}\n${line}\n`);
      assert.equal(r.status, 2, r.out);
      assert.ok(r.out.includes('scan-exclusions'), `the reason does not name the list: ${r.out}`);
      assert.ok(!r.out.includes('push-gate: passed'), r.out);
    });
  }

  it('(guard) a list inside the scanned tree is not the list: a malformed one there changes nothing', () => {
    commit({ 'scripts/scan-exclusions.tsv': 'this line is not an entry\n' });
    const r = gateReal();
    assert.equal(r.status, 0, r.out);
  });

  it('(guard) a `keys` entry written into the scanned tree does not silence a key', () => {
    commit({ 'scripts/scan-exclusions.tsv': 'keys\tconf.txt\t-\ta made-up reason\n', 'conf.txt': `token = ${fakeKey()}\n` });
    const r = gateReal();
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step gitleaks: FAILED'), r.out);
  });
});

// ---- no other mechanism ----

/** The lines of a file without the ones that are only a comment. */
const codeLines = (file) => readFileSync(file, 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*#/.test(l));

describe('there is no way to skip a file except the list', () => {
  it('the gitleaks configuration of the gate holds no global allowlist and does not bring in the tool\'s own', () => {
    const lines = codeLines(path.join(scriptsDir, 'push-gate.gitleaks.toml'));
    const hits = lines.filter(([, l]) => /useDefault\s*=\s*true/.test(l) || /allowlist/i.test(l) || /^\s*paths\s*=/.test(l));
    assert.deepEqual(hits, [], 'useDefault = true brings in the default global allowlist (paths and file kinds skipped by name)');
  });

  const SKIPPERS = [
    ['a `:!` pathspec', /:!/, "gg -l x -- . ':!lock.json'"],
    ['a `:(exclude)` pathspec', /:\(exclude/, "git grep x -- ':(exclude)a'"],
    ['a `:^` pathspec', /:\^/, "git grep x -- ':^b'"],
    ['--exclude', /--exclude/, 'tar --exclude=.git'],
    ['find -not/! -path or -name', /(-not|!)\s+-(i?path|i?name|i?regex)\b/, 'find . ! -name x'],
    ['a path allowlist for gitleaks', /^\s*(paths|regexes)\s*=/, 'paths = ["x"]'],
  ];
  it('(guard) the detector names each kind of skipper', () => {
    for (const [label, re, sample] of SKIPPERS) assert.ok(re.test(sample), `not seen: ${label}`);
    assert.ok(!SKIPPERS.some(([, re]) => re.test('echo "${x:-default}" && find . -name x')), 'a plain find -name is not a skipper');
  });

  const files = [
    ...readdirSync(scriptsDir).filter((n) => /\.(sh|mjs|toml)$/.test(n)).map((n) => path.join(scriptsDir, n)),
    ...readdirSync(path.join(root, '.githooks')).map((n) => path.join(root, '.githooks', n)),
  ];
  it('no script, hook or scanner configuration has a pathspec, an --exclude or a glob that skips files', () => {
    const offences = [];
    for (const f of files) {
      for (const [n, l] of codeLines(f)) {
        for (const [label, re] of SKIPPERS) if (re.test(l)) offences.push(`${path.relative(root, f)}:${n} ${label}`);
      }
    }
    assert.deepEqual(offences, [], `${offences.length} way(s) to skip a file outside the list:\n${offences.join('\n')}`);
  });
});
