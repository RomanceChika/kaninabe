/**
 * Tests of scripts/classify-paths.sh and of this repository's basis-paths.tsv (development-flow, "どの path が基準か").
 *
 * The script sorts paths into three classes (basis, generated, implementation) by a list of lines `class<TAB>pattern<TAB>reason`:
 * lines are tried in order, the first match decides, a path that no line matches is basis. The paths come from a NUL-separated
 * file (--paths) or from `git diff --no-renames --name-only -z` between two commits (--range). Exit 0 passes, 1 means the
 * --require rule is violated, 2 means the script could not do its work (never 1, never a class line, never the summary line).
 *
 * --range runs git in a clean environment of its own (no GIT_* from the caller, no user or system configuration, no replace refs).
 * The script is spec/test-first: this file is written before it. The sections follow the plan:
 *   1 list format        2 matching        3 ranges on a temporary git repository        4 --require
 *   5 a step that cannot run (and the cut-short sweep)        6 completeness        7 this repository's own list
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/classify-paths.sh', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const SUMMARY = /^classify-paths: (\d+) path\(s\): (\d+) basis, (\d+) generated, (\d+) implementation$/m;
const CLASS_LINE = /^(basis|generated|implementation)\t/m;

// The PATH of a run: null is the PATH of the test run; a directory is a private PATH holding only the tools the script may use
// (so a missing or failing tool can be staged, and so that nothing else, awk or sed or sort or grep, is needed).
let toolPath = null;
let tmpOverride = null;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const envOf = () => ({ ...cleanEnv, ...(toolPath ? { PATH: toolPath } : {}), ...(tmpOverride !== null ? { TMPDIR: tmpOverride } : {}) });
const SYSTEM = ['/usr/bin', '/bin', '/usr/local/bin'];
const which = (name) => SYSTEM.map((d) => path.join(d, name)).find((p) => spawnSync('/bin/sh', ['-c', `test -x ${p}`]).status === 0) ?? null;
const TOOLS = ['git', 'env', 'mktemp', 'rm', 'mv', 'tr', 'wc', 'cat', 'cmp'];
/** A directory holding only the tools the script may call. `omit` leaves tools out; `shim` maps a tool to a shell body. */
function makeBin(root, { omit = [], shim = {} } = {}) {
  const bin = path.join(root, `bin-${Math.random().toString(36).slice(2)}`);
  mkdirSync(bin);
  for (const n of TOOLS) {
    if (omit.includes(n)) continue;
    if (shim[n] !== undefined) { writeFileSync(path.join(bin, n), `#!/bin/sh\n${shim[n]}\n`); chmodSync(path.join(bin, n), 0o755); }
    else symlinkSync(which(n), path.join(bin, n));
  }
  return bin;
}

let scratch;
before(() => { scratch = mkdtempSync(path.join(tmpdir(), 'classify-paths-')); });
after(() => { rmSync(scratch, { recursive: true, force: true }); });
let seq = 0;
const fresh = (name) => { const d = path.join(scratch, `${name}-${seq++}`); mkdirSync(d); return d; };

/** Runs the script (by `/bin/sh`, as the callers do). */
function run(args, { cwd, env, shell } = {}) {
  const [cmd, ...pre] = shell ?? ['/bin/sh'];
  const r = spawnSync(cmd, [...pre, script, ...args], { encoding: 'utf8', env: { ...envOf(), ...(env ?? {}) }, cwd: cwd ?? scratch });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}
const writeList = (lines, dir = scratch) => { const f = path.join(dir, `list-${seq++}.tsv`); writeFileSync(f, lines.length ? `${lines.join('\n')}\n` : ''); return f; };
const writeRaw = (content, dir = scratch) => { const f = path.join(dir, `raw-${seq++}`); writeFileSync(f, content); return f; };
const writePaths = (paths, dir = scratch) => writeRaw(paths.map((p) => `${p}\0`).join(''), dir);
const L = (...cols) => cols.join('\t');
const rowsOf = (file) => (readFileSync(file, 'utf8') === '' ? [] : readFileSync(file, 'utf8').replace(/\n$/, '').split('\n').map((l) => l.split('\t')));

/** Classifies `paths` by the list `lines`, through --paths and --out; returns the status, the rows [class, path] and the output. */
function classify(lines, paths, extra = []) {
  const out = path.join(scratch, `out-${seq++}`);
  const r = run(['--list', writeList(lines), '--paths', writePaths(paths), '--out', out, ...extra]);
  return { ...r, rows: existsSync(out) ? rowsOf(out) : null };
}
const classOf = (lines, p) => { const r = classify(lines, [p]); assert.equal(r.status, 0, r.all); return r.rows[0][0]; };
/** Asserts exit 2 with the fixed message, and that none of `secrets` is echoed. */
function couldNotRun(r, rule, secrets = []) {
  assert.equal(r.status, 2, r.all);
  assert.ok(r.all.includes('classify-paths: could not run ('), `no fixed message: ${r.all}`);
  if (rule) assert.ok(r.all.includes(rule), `should name "${rule}": ${r.all}`);
  assert.ok(!SUMMARY.test(r.all) && !CLASS_LINE.test(r.all), `a verdict or class line was printed: ${r.all}`);
  for (const s of secrets) assert.ok(!r.all.includes(s), `echoed ${s}: ${r.all}`);
}

// ---- 1 the list format ---------------------------------------------------------------------------------------------------
const GOOD = L('implementation', 'impl/*', 'a reason');
function listCases() {
  /** [name, the bad line, the rule it breaks]: each line sits on line 3 of an otherwise good list, and is never echoed. */
  const BAD = [
    ['no tab', 'basisSECRETPAT', 'not three tab-separated fields'],
    ['one tab', L('basis', 'SECRETPAT'), 'not three tab-separated fields'],
    ['three tabs', L('basis', 'SECRETPAT', 'SECRETWHY', 'x'), 'not three tab-separated fields'],
    ['unknown class', L('SECRETCLASS', 'SECRETPAT', 'SECRETWHY'), 'unknown class'],
    ['a class in capitals', L('Basis', 'SECRETPAT', 'SECRETWHY'), 'unknown class'],
    ['empty class', L('', 'SECRETPAT', 'SECRETWHY'), 'unknown class'],
    ['empty pattern', L('basis', '', 'SECRETWHY'), 'empty pattern'],
    ['empty reason', L('basis', 'SECRETPAT', ''), 'empty reason'],
    ['leading slash', L('basis', '/SECRETPAT', 'SECRETWHY'), 'pattern starts or ends with /'],
    ['trailing slash', L('basis', 'SECRETPAT/', 'SECRETWHY'), 'pattern starts or ends with /'],
    ['only a slash', L('basis', '/', 'SECRETWHY'), 'pattern starts or ends with /'],
    ['empty segment', L('basis', 'SECRETPAT//x', 'SECRETWHY'), 'pattern has an empty, . or .. segment'],
    ['a . segment', L('basis', 'SECRETPAT/./x', 'SECRETWHY'), 'pattern has an empty, . or .. segment'],
    ['a leading . segment', L('basis', './SECRETPAT', 'SECRETWHY'), 'pattern has an empty, . or .. segment'],
    ['a .. segment', L('basis', 'SECRETPAT/../x', 'SECRETWHY'), 'pattern has an empty, . or .. segment'],
    ['only ..', L('basis', '..', 'SECRETWHY'), 'pattern has an empty, . or .. segment'],
    ['a trailing ..', L('basis', 'SECRETPAT/..', 'SECRETWHY'), 'pattern has an empty, . or .. segment'],
    ['a question mark', L('basis', 'SECRETPAT?', 'SECRETWHY'), 'pattern has a ?, [, ] or backslash'],
    ['an opening bracket', L('basis', 'SECRETPAT[a', 'SECRETWHY'), 'pattern has a ?, [, ] or backslash'],
    ['a closing bracket', L('basis', 'SECRETPAT]', 'SECRETWHY'), 'pattern has a ?, [, ] or backslash'],
    ['a backslash', L('basis', 'SECRETPAT\\x', 'SECRETWHY'), 'pattern has a ?, [, ] or backslash'],
    ['a control character in the pattern', L('basis', 'SECRETPAT\x01', 'SECRETWHY'), 'control character'],
    ['a control character in the reason', L('basis', 'SECRETPAT', 'SECRETWHY\x1b'), 'control character'],
    ['a DEL in the class', L('basis\x7f', 'SECRETPAT', 'SECRETWHY'), 'control character'],
    ['a carriage return at the end', `${L('basis', 'SECRETPAT', 'SECRETWHY')}\r`, 'carriage return'],
    ['a carriage return in the middle', L('basis', 'SECRETPAT\rx', 'SECRETWHY'), 'carriage return'],
    ['a blank line', '', 'blank line'],
    ['a blank line of spaces is a field problem, not a pass', '   ', 'not three tab-separated fields'],
    ['a comment line', '# SECRETPAT SECRETWHY', 'comment line'],
    ['a comment line that looks like a record', `#${L('basis', 'SECRETPAT', 'SECRETWHY')}`, 'comment line'],
    ['a duplicate pattern', L('generated', 'impl/*', 'SECRETWHY'), 'duplicate pattern'],
  ];
  for (const [name, bad, rule] of BAD) {
    it(`${name}: exit 2 with "list: line 3: ${rule}", and the line is not echoed`, () => {
      const r = run(['--list', writeList([GOOD, L('basis', 'docs/*', 'ok'), bad, L('basis', 'z/*', 'ok')]), '--paths', writePaths(['a'])]);
      couldNotRun(r, `list: line 3: ${rule}`, ['SECRETPAT', 'SECRETWHY', 'SECRETCLASS']);
    });
  }
  it('a duplicate is the same pattern in any class, and two different patterns are not duplicates', () => {
    couldNotRun(run(['--list', writeList([L('basis', 'x/*', 'r'), L('basis', 'x/*', 'r')]), '--paths', writePaths([])]), 'list: line 2: duplicate pattern');
    assert.equal(run(['--list', writeList([L('basis', 'x/*', 'r'), L('basis', 'x/**', 'r'), L('basis', 'x', 'r')]), '--paths', writePaths([])]).status, 0);
  });
  it('a list with no line feed at the end, with a NUL byte, or with a long valid line is judged on its content', () => {
    couldNotRun(run(['--list', writeRaw(L('basis', 'x/*', 'r')), '--paths', writePaths([])]), 'list: line 1: no line feed at the end');
    couldNotRun(run(['--list', writeRaw(`${L('basis', 'x/*', 'r')}\n${L('basis', 'y/*', 're\0ason')}\n`), '--paths', writePaths([])]), 'list: contains a NUL byte');
    assert.equal(run(['--list', writeList([L('basis', 'x/*', 'r'.repeat(5000))]), '--paths', writePaths([])]).status, 0);
  });
  it('a missing file, a directory and an unreadable path are exit 2', () => {
    couldNotRun(run(['--list', path.join(scratch, 'no-such-list'), '--paths', writePaths([])]), 'list: cannot read');
    couldNotRun(run(['--list', scratch, '--paths', writePaths([])]), 'list: cannot read');
    couldNotRun(run(['--list', '', '--paths', writePaths([])]), 'list: cannot read');
  });
  it('an empty list is valid: everything is basis', () => {
    const r = classify([], ['a', 'impl/x', 'supabase/migrations/1.sql']);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.rows.map((x) => x[0]), ['basis', 'basis', 'basis']);
    assert.match(r.out, /3 path\(s\): 3 basis, 0 generated, 0 implementation/);
  });
  it('the patterns that are allowed: * anywhere (also crossing /), a literal, dots and dashes inside a name, a leading *', () => {
    const lines = [L('basis', '*', 'r1'), L('basis', 'a*b', 'r2'), L('basis', '*/x/*', 'r3'), L('basis', '.github/*', 'r4'), L('basis', 'a.b/c-d/e_f', 'r5'),
      L('basis', '...', 'r6'), L('basis', '-x', 'r7'), L('basis', '日本語/*', 'r8'), L('basis', 'sp ace/*', 'r9'), L('basis', 'q"u\'o/*', 'r10')];
    assert.equal(run(['--list', writeList(lines), '--paths', writePaths(['a'])]).status, 0);
  });
}

// ---- 2 matching ---------------------------------------------------------------------------------------------------------
function matchCases() {
  it('a literal pattern matches only that path: a similar name does not', () => {
    const lines = [L('implementation', 'scripts/a.sh', 'r')];
    const r = classify(lines, ['scripts/a.sh', 'scripts/a.shx', 'scripts/a.sh/b', 'xscripts/a.sh', 'scripts/b.sh', 'a.sh']);
    assert.deepEqual(r.rows, [['implementation', 'scripts/a.sh'], ['basis', 'scripts/a.shx'], ['basis', 'scripts/a.sh/b'], ['basis', 'xscripts/a.sh'], ['basis', 'scripts/b.sh'], ['basis', 'a.sh']]);
  });
  it('dir/* matches the files under dir at any depth, and not dirx/a, x/dir/a or a file named dir', () => {
    const lines = [L('implementation', 'dir/*', 'r')];
    const r = classify(lines, ['dir/a', 'dir/sub/deep/b', 'dir/.hidden', 'dirx/a', 'x/dir/a', 'dir', 'dir.txt']);
    assert.deepEqual(r.rows.map((x) => x[0]), ['implementation', 'implementation', 'implementation', 'basis', 'basis', 'basis', 'basis']);
  });
  it('* may stand anywhere in a pattern and crosses /: a*b, */gen/*, *.sh, and * alone', () => {
    assert.deepEqual(['ab', 'a/x/b', 'aXb', 'abc', 'ba'].map((p) => classOf([L('generated', 'a*b', 'r')], p)), ['generated', 'generated', 'generated', 'basis', 'basis']);
    assert.deepEqual(['x/gen/y', 'a/b/gen/c', 'gen/y', 'xgen/y', 'x/gen'].map((p) => classOf([L('generated', '*/gen/*', 'r')], p)), ['generated', 'generated', 'basis', 'basis', 'basis']);
    assert.deepEqual(['a.sh', 'a/b.sh', 'a.shx', 'sh'].map((p) => classOf([L('implementation', '*.sh', 'r')], p)), ['implementation', 'implementation', 'basis', 'basis']);
    assert.deepEqual(['a', 'b/c'].map((p) => classOf([L('generated', '*', 'r')], p)), ['generated', 'generated']);
  });
  it('the first matching line wins: the same two lines in two orders give two answers', () => {
    const narrow = L('basis', 'd/x/*', 'r1');
    const wide = L('implementation', 'd/*', 'r2');
    assert.deepEqual(classify([narrow, wide], ['d/x/f', 'd/y']).rows.map((x) => x[0]), ['basis', 'implementation']);
    assert.deepEqual(classify([wide, narrow], ['d/x/f', 'd/y']).rows.map((x) => x[0]), ['implementation', 'implementation']);
  });
  it('a path that no line matches is basis, whatever the list holds', () => {
    const r = classify([L('implementation', 'a/*', 'r'), L('generated', 'b/*', 'r')], ['c/x', 'README.md', 'a', 'b']);
    assert.deepEqual(r.rows.map((x) => x[0]), ['basis', 'basis', 'basis', 'basis']);
  });
  it('glob characters, quotes, spaces, a leading - and UTF-8 in a PATH are data: nothing in a path acts as a pattern or an option', () => {
    const lines = [L('implementation', 'dir/*', 'r'), L('generated', 'x/lit', 'r')];
    const paths = ['dir/*', 'dir/?', 'dir/[a]', '[a]', '*', '-x', '--list', 'dir/a b', 'dir/q"u\'o', 'dir/日本語', 'dir/a\\b', 'x/lit', 'x/l*t', '$HOME', 'dir/$(x)'];
    const r = classify(lines, paths);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.rows.map((x) => x[1]), paths);
    assert.deepEqual(r.rows.map((x) => x[0]), ['implementation', 'implementation', 'implementation', 'basis', 'basis', 'basis', 'basis', 'implementation', 'implementation', 'implementation', 'implementation', 'generated', 'basis', 'basis', 'implementation']);
  });
  it('a path given twice is listed and counted twice, in the order given', () => {
    const r = classify([L('generated', 'g/*', 'r')], ['g/a', 'b', 'g/a']);
    assert.deepEqual(r.rows, [['generated', 'g/a'], ['basis', 'b'], ['generated', 'g/a']]);
    assert.match(r.out, /3 path\(s\): 1 basis, 2 generated, 0 implementation/);
  });
  it('the --paths file is held to its frame: NUL-terminated records, none empty, none with a control character or a line feed', () => {
    const list = writeList([GOOD]);
    for (const [name, raw, rule] of [
      ['no terminator after the last record', 'a\0b', 'paths: the last record has no NUL'],
      ['an empty record', 'a\0\0b\0', 'paths: record 2: empty path'],
      ['a line feed in a name', 'a\0b\nc\0', 'paths: a line feed in a name'],
      ['a tab in a name', 'a\0b\tc\0', 'paths: record 2: control character'],
      ['a control character in a name', 'a\0b\x01\0', 'paths: record 2: control character'],
      ['a DEL in a name', 'a\0\x7f\0', 'paths: record 2: control character'],
      ['a carriage return in a name', 'a\0b\rc\0', 'paths: record 2: control character'],
    ]) {
      const r = run(['--list', list, '--paths', writeRaw(raw)]);
      couldNotRun(r, rule);
    }
    assert.equal(run(['--list', list, '--paths', writeRaw('')]).status, 0, 'no record at all is zero paths');
    couldNotRun(run(['--list', list, '--paths', path.join(scratch, 'no-such-paths')]), 'paths: cannot read');
  });
  it('a path is never echoed in an error, and the summary and the rows keep the shapes the callers read', () => {
    const r = classify([L('implementation', 'impl/*', 'r'), L('generated', 'gen/*', 'r')], ['impl/a', 'gen/b', 'doc/c', 'impl/d']);
    assert.equal(r.status, 0, r.all);
    const m = r.out.match(SUMMARY);
    assert.deepEqual(m.slice(1).map(Number), [4, 1, 1, 2]);
    assert.equal(r.out, 'classify-paths: 4 path(s): 1 basis, 1 generated, 2 implementation\n', 'with --out, standard output is the summary only');
    assert.deepEqual(r.rows, [['implementation', 'impl/a'], ['generated', 'gen/b'], ['basis', 'doc/c'], ['implementation', 'impl/d']]);
  });
}

// ---- 4 --require and the argument shape ----------------------------------------------------------------------------------
const MIX = [L('implementation', 'impl/*', 'r'), L('generated', 'gen/*', 'r')];
function requireCases() {
  const req = (mode, paths) => { const r = classify(MIX, paths, ['--require', mode]); return r; };
  it('basis-only: an implementation path is exit 1 (counts only); basis and generated pass', () => {
    const bad = req('basis-only', ['docs/a', 'impl/x']);
    assert.equal(bad.status, 1, bad.all);
    assert.match(bad.out, SUMMARY);
    assert.ok(bad.out.includes('classify-paths: FAILED (basis-only: 1 implementation path(s))'), bad.out);
    assert.ok(!bad.out.includes('impl/x') && !bad.out.includes('docs/a'), 'no path in the output');
    assert.equal(req('basis-only', ['docs/a', 'gen/y']).status, 0);
    assert.equal(req('basis-only', ['gen/y']).status, 0, 'generated passes');
  });
  it('no-basis: a basis path is exit 1 (counts only); implementation and generated pass', () => {
    const bad = req('no-basis', ['impl/x', 'docs/a', 'docs/b']);
    assert.equal(bad.status, 1, bad.all);
    assert.ok(bad.out.includes('classify-paths: FAILED (no-basis: 2 basis path(s))'), bad.out);
    assert.ok(!bad.out.includes('docs/a') && !bad.out.includes('impl/x'));
    assert.equal(req('no-basis', ['impl/x', 'gen/y']).status, 0);
    assert.equal(req('no-basis', ['gen/y']).status, 0, 'generated passes');
  });
  it('any (the default) always passes; no path at all passes every rule', () => {
    assert.equal(req('any', ['docs/a', 'impl/x', 'gen/y']).status, 0);
    assert.equal(classify(MIX, ['docs/a', 'impl/x']).status, 0);
    for (const m of ['basis-only', 'no-basis', 'any']) assert.equal(req(m, []).status, 0, m);
  });
  it('a violated run still writes the rows to --out, and a passing run never prints FAILED', () => {
    const r = req('basis-only', ['impl/x', 'docs/a']);
    assert.equal(r.status, 1);
    assert.deepEqual(r.rows, [['implementation', 'impl/x'], ['basis', 'docs/a']]);
    assert.ok(!req('basis-only', ['docs/a']).out.includes('FAILED'));
  });
  it('--quiet prints the summary and no path; without --quiet and --out the rows come first on standard output', () => {
    const list = writeList(MIX); const paths = writePaths(['impl/secret-one', 'gen/two', 'docs/three']);
    const q = run(['--list', list, '--paths', paths, '--quiet']);
    assert.equal(q.status, 0, q.all);
    assert.equal(q.out, 'classify-paths: 3 path(s): 1 basis, 1 generated, 1 implementation\n');
    assert.equal(q.err, '');
    const qo = run(['--list', list, '--paths', paths, '--quiet', '--out', path.join(scratch, `qo-${seq++}`)]);
    assert.equal(qo.out, q.out);
    const plain = run(['--list', list, '--paths', paths]);
    assert.equal(plain.out, 'implementation\timpl/secret-one\ngenerated\tgen/two\nbasis\tdocs/three\nclassify-paths: 3 path(s): 1 basis, 1 generated, 1 implementation\n');
    const failing = run(['--list', list, '--paths', paths, '--quiet', '--require', 'no-basis']);
    assert.equal(failing.status, 1);
    assert.ok(!failing.out.includes('secret-one') && !failing.out.includes('three'), failing.out);
  });
  it('bad arguments are exit 2 with the fixed message', () => {
    const list = writeList([]); const paths = writePaths(['a']);
    for (const args of [
      [], ['--paths', paths], ['--list', list], ['--list', list, '--paths', paths, '--range', 'a', 'b'], ['--list', list, '--paths'], ['--list'],
      ['--list', list, '--paths', paths, '--require', 'bogus'], ['--list', list, '--paths', paths, '--require'], ['--list', list, '--paths', paths, '--bogus'],
      ['--list', list, '--list', list, '--paths', paths], ['--list', list, '--paths', paths, '--paths', paths], ['--list', list, '--paths', paths, 'extra'],
      ['--list', list, '--paths', paths, '--out', ''], ['--list', list, '--paths', paths, '--out', scratch], ['--list', list, '--paths', paths, '--out', path.join(scratch, 'no-dir', 'o')],
      ['--list', list, '--range', 'a'], ['--list', list, '--range'], ['--list', list, '--paths', paths, '--require', 'basis-only', '--require', 'any'],
    ]) couldNotRun(run(args), null);
  });
}

describe('classify-paths.sh: the list format (1)', listCases);
describe('classify-paths.sh: matching (2)', matchCases);
describe('classify-paths.sh: --require, --quiet and the arguments (4)', requireCases);
describe('classify-paths.sh with a private PATH holding only git, env, mktemp, rm, mv, tr, wc, cat and cmp (no awk, sed, sort or grep)', () => {
  let root;
  before(() => { root = mkdtempSync(path.join(tmpdir(), 'classify-paths-bin-')); toolPath = makeBin(root); });
  after(() => { toolPath = null; rmSync(root, { recursive: true, force: true }); });
  listCases();
  matchCases();
  requireCases();
});

// ---- 3 ranges on a temporary git repository -----------------------------------------------------------------------------
const gitEnv = { ...cleanEnv, HOME: '/nonexistent-home', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=tester', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function put(dir, rel, content = 'x\n') { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, content); }
function newRepo(files) {
  const dir = fresh('repo');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, c] of Object.entries(files)) put(dir, rel, c);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}
// `git add -A` would drop a gitlink whose directory is absent, so the gitlink tests stage by hand and commit with stage = false
function commit(dir, msg = 'next', stage = true) { if (stage) git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); }
const RANGE_LIST = [L('implementation', 'impl/*', 'r'), L('generated', 'gen/*', 'r'), L('implementation', 'vendor/sub', 'r')];
/** Classifies the paths between two commits of `dir`; returns the status, the sorted rows and the output. */
function range(dir, a, b, { extra = [], list = RANGE_LIST, cwd, env } = {}) {
  const out = path.join(scratch, `rout-${seq++}`);
  const r = run(['--list', writeList(list), '--range', a, b, '--out', out, ...extra], { cwd: cwd ?? dir, env });
  const rows = existsSync(out) ? rowsOf(out) : null;
  return { ...r, rows, sorted: rows && [...rows].sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)) };
}
const GITLINK = (n) => `${n.repeat(40)}`.slice(0, 40);

describe('classify-paths.sh: --range on a temporary git repository (3)', () => {
  it('add, modify and delete: each changed path once, unchanged paths not at all', () => {
    const d = newRepo({ 'impl/m.sh': 'a\n', 'impl/d.sh': 'a\n', 'docs/keep.md': 'a\n', 'gen/old.sql': 'a\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    put(d, 'impl/m.sh', 'b\n'); rmSync(path.join(d, 'impl/d.sh')); put(d, 'gen/new.sql'); put(d, 'docs/n.md');
    const b = commit(d);
    const r = range(d, a, b);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.sorted, [['basis', 'docs/n.md'], ['generated', 'gen/new.sql'], ['implementation', 'impl/d.sh'], ['implementation', 'impl/m.sh']]);
    assert.match(r.out, /4 path\(s\): 1 basis, 1 generated, 2 implementation/);
  });
  it('a rename is the delete of the old path and the add of the new one: both are reported, the old one is counted', () => {
    const d = newRepo({ 'impl/a.sh': 'line one\nline two\nline three\n', 'impl/b.sh': 'other\ncontent\nhere\nmore\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    mkdirSync(path.join(d, 'docs')); mkdirSync(path.join(d, 'gen')); git(d, 'mv', 'impl/a.sh', 'docs/a.sh');
    git(d, 'mv', 'impl/b.sh', 'gen/b.sh'); put(d, 'gen/b.sh', 'other\ncontent\nhere\nmore\nchanged\n');
    const b = commit(d);
    git(d, 'config', 'diff.renames', 'copies');
    const r = range(d, a, b);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.sorted, [['basis', 'docs/a.sh'], ['generated', 'gen/b.sh'], ['implementation', 'impl/a.sh'], ['implementation', 'impl/b.sh']]);
    const only = range(d, a, b, { extra: ['--require', 'basis-only'] });
    assert.equal(only.status, 1, 'the old path under implementation/ is counted, so a rename out of it is not basis-only');
  });
  it('chmod +x and a file turned into a symlink: the path is reported once', () => {
    const d = newRepo({ 'impl/x.sh': '#!/bin/sh\n', 'docs/link.md': 'text\n', 'docs/same.md': 'same\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    chmodSync(path.join(d, 'impl/x.sh'), 0o755);
    rmSync(path.join(d, 'docs/link.md')); symlinkSync('same.md', path.join(d, 'docs/link.md'));
    const b = commit(d);
    const r = range(d, a, b);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.sorted, [['basis', 'docs/link.md'], ['implementation', 'impl/x.sh']]);
  });
  it('a submodule gitlink is one path, classified by the list; adding, moving and re-pointing it are all seen', () => {
    const d = newRepo({ 'docs/a.md': 'a\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    git(d, 'update-index', '--add', '--cacheinfo', `160000,${GITLINK('1')},vendor/sub`);
    const b = commit(d, 'add the pin', false);
    const added = range(d, a, b);
    assert.deepEqual(added.sorted, [['implementation', 'vendor/sub']]);
    git(d, 'update-index', '--cacheinfo', `160000,${GITLINK('2')},vendor/sub`);
    const c = commit(d, 'move the pin to another commit', false);
    assert.deepEqual(range(d, b, c).sorted, [['implementation', 'vendor/sub']]);
    git(d, 'rm', '-q', '--cached', 'vendor/sub');
    git(d, 'update-index', '--add', '--cacheinfo', `160000,${GITLINK('2')},vendor/moved`);
    const e = commit(d, 'move the path', false);
    assert.deepEqual(range(d, c, e).sorted, [['basis', 'vendor/moved'], ['implementation', 'vendor/sub']]);
  });
  it('git configuration does not change what is classified: diff.relative, diff.ignoreSubmodules and a run from a subdirectory', () => {
    const d = newRepo({ 'docs/a.md': 'a\n', 'impl/x.sh': 'x\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    git(d, 'update-index', '--add', '--cacheinfo', `160000,${GITLINK('3')},vendor/sub`);
    put(d, 'impl/x.sh', 'y\n'); put(d, 'docs/b.md');
    git(d, 'add', 'impl', 'docs');
    const b = commit(d, 'next', false);
    git(d, 'config', 'diff.relative', 'true'); git(d, 'config', 'diff.ignoreSubmodules', 'all');
    const r = range(d, a, b, { cwd: path.join(d, 'docs') });
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.sorted, [['basis', 'docs/b.md'], ['implementation', 'impl/x.sh'], ['implementation', 'vendor/sub']]);
  });
  it('names with a space, quotes, a leading -, a semicolon, a dollar, a backslash and UTF-8 come out exactly as they are', () => {
    const names = ['impl/a b.sh', 'impl/q"u\'o.sh', '-dash.txt', '--list', 'impl/日本語/ファイル.sh', 'docs/semi;colon$x`y`.txt', 'docs/back\\slash.txt', 'docs/*star?.txt', 'docs/[b].txt'];
    const d = newRepo({ 'docs/a.md': 'a\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    for (const n of names) put(d, n);
    const b = commit(d);
    const r = range(d, a, b);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.sorted.map((x) => x[1]), [...names].sort());
    for (const [cls, p] of r.rows) assert.equal(cls, p.startsWith('impl/') ? 'implementation' : 'basis', p);
  });
  it('a line feed or a control character in a name is exit 2, and the name is not echoed', () => {
    for (const bad of ['docs/a\nSECRETNAME.txt', 'docs/b\tSECRETNAME.txt', 'docs/c\x01SECRETNAME.txt']) {
      const d = newRepo({ 'docs/a.md': 'a\n' });
      const a = git(d, 'rev-parse', 'HEAD');
      put(d, 'impl/ok.sh'); put(d, bad);
      const b = commit(d);
      couldNotRun(range(d, a, b), null, ['SECRETNAME']);
    }
  });
  it('an unknown commit, a malformed one, an option-like one and a directory that is not a repository are exit 2', () => {
    const d = newRepo({ 'docs/a.md': 'a\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    for (const [x, y] of [[a, 'f'.repeat(40)], ['f'.repeat(40), a], [a, 'no-such-branch'], ['', a], [a, ''], ['--stat', a], [a, '--name-only'], [`${a}\nHEAD`, a]]) {
      couldNotRun(range(d, x, y), null);
    }
    const plain = fresh('plain');
    const r = run(['--list', writeList([]), '--range', a, a, '--out', path.join(scratch, `o-${seq++}`)], { cwd: plain });
    couldNotRun(r, null);
  });
  it('the same commit twice is zero paths and passes every rule; the order of the arguments is a then b', () => {
    const d = newRepo({ 'impl/x.sh': 'a\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    put(d, 'docs/n.md'); const b = commit(d);
    const same = range(d, b, b, { extra: ['--require', 'no-basis'] });
    assert.equal(same.status, 0, same.all);
    assert.match(same.out, /0 path\(s\): 0 basis, 0 generated, 0 implementation/);
    assert.deepEqual(range(d, a, b).sorted, [['basis', 'docs/n.md']]);
    assert.deepEqual(range(d, b, a).sorted, [['basis', 'docs/n.md']], 'the same path set backwards');
  });
  /** A repository with a commit a, then b (changes impl and docs), then c (changes only docs). */
  function threeCommits() {
    const d = newRepo({ 'impl/x.sh': 'a\n', 'docs/a.md': 'a\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    put(d, 'impl/x.sh', 'b\n'); put(d, 'docs/b.md'); const b = commit(d, 'b');
    put(d, 'docs/c.md'); const c = commit(d, 'c');
    return { d, a, b, c };
  }
  it('a replace ref does not change the path set: git replace B C leaves --range A B on the real B', () => {
    const { d, a, b, c } = threeCommits();
    const before = range(d, a, b);
    assert.deepEqual(before.sorted, [['basis', 'docs/b.md'], ['implementation', 'impl/x.sh']]);
    git(d, 'replace', b, c);
    const after = range(d, a, b, { extra: ['--require', 'basis-only'] });
    assert.equal(after.status, 1, `the implementation path of the real B must still be counted: ${after.all}`);
    assert.deepEqual(after.sorted, before.sorted);
    const flipped = range(d, a, b, { env: { GIT_NO_REPLACE_OBJECTS: '0' } });
    assert.deepEqual(flipped.sorted, before.sorted, 'GIT_NO_REPLACE_OBJECTS=0 in the environment does not bring the replacement back');
  });
  it('git environment variables of the caller do not change the result: it is the same as without them, or exit 2', () => {
    const { d, a, b } = threeCommits();
    git(d, 'replace', b, a); // a replace ref is present while the hostile environments are tried
    const other = newRepo({ 'elsewhere/f': 'x\n' });
    const base = range(d, a, b);
    assert.deepEqual(base.sorted, [['basis', 'docs/b.md'], ['implementation', 'impl/x.sh']]);
    const objects = path.join(fresh('alt'), 'objects'); mkdirSync(objects);
    const HOSTILE = [
      ['GIT_DIR at another repository', { GIT_DIR: path.join(other, '.git') }],
      ['GIT_WORK_TREE and GIT_INDEX_FILE that do not exist', { GIT_WORK_TREE: '/nonexistent/wt', GIT_INDEX_FILE: '/nonexistent/index' }],
      ['GIT_CONFIG_COUNT setting diff options', { GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'diff.relative', GIT_CONFIG_VALUE_0: 'true', GIT_CONFIG_KEY_1: 'diff.ignoreSubmodules', GIT_CONFIG_VALUE_1: 'all', GIT_CONFIG_KEY_2: 'diff.renames', GIT_CONFIG_VALUE_2: 'copies' }],
      ['GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM files', { GIT_CONFIG_GLOBAL: path.join(fresh('cfg'), 'nope'), GIT_CONFIG_SYSTEM: '/nonexistent/sys' }],
      ['GIT_ALTERNATE_OBJECT_DIRECTORIES', { GIT_ALTERNATE_OBJECT_DIRECTORIES: objects }],
      ['GIT_OBJECT_DIRECTORY at an empty directory', { GIT_OBJECT_DIRECTORY: objects }],
      ['GIT_NO_REPLACE_OBJECTS=0 and GIT_REPLACE_REF_BASE', { GIT_NO_REPLACE_OBJECTS: '0', GIT_REPLACE_REF_BASE: 'refs/replace/' }],
      ['GIT_EXTERNAL_DIFF and GIT_DIFF_OPTS', { GIT_EXTERNAL_DIFF: '/bin/false', GIT_DIFF_OPTS: '--unified=0' }],
      ['GIT_CEILING_DIRECTORIES and GIT_DISCOVERY_ACROSS_FILESYSTEM', { GIT_CEILING_DIRECTORIES: d, GIT_DISCOVERY_ACROSS_FILESYSTEM: '0' }],
      ['GIT_COMMON_DIR and GIT_NAMESPACE', { GIT_COMMON_DIR: path.join(other, '.git'), GIT_NAMESPACE: 'x' }],
    ];
    for (const [name, env] of HOSTILE) {
      const r = range(d, a, b, { env, cwd: path.join(d, 'docs') });
      if (r.status === 2) { couldNotRun(r, null); continue; }
      assert.equal(r.status, 0, `${name}: ${r.all}`);
      assert.deepEqual(r.sorted, base.sorted, `${name} changed the result`);
    }
  });
  it('--range takes only what resolves to one commit: a commit, a branch, a tag (peeled), an abbreviated sha, HEAD~1 and refs/heads/x pass; a tree, a blob and a range are exit 2', () => {
    const { d, a, b } = threeCommits();
    git(d, 'tag', 'light', b); git(d, 'tag', '-a', '-m', 'annotated', 'noted', b); git(d, 'branch', 'side', b);
    const want = [['basis', 'docs/b.md'], ['implementation', 'impl/x.sh']];
    for (const x of [b, b.slice(0, 10), 'light', 'noted', 'side', 'refs/heads/side', 'refs/tags/noted', 'HEAD~1', `${b}^{commit}`, `${b}^0`]) {
      const r = range(d, a, x);
      assert.equal(r.status, 0, `${x}: ${r.all}`);
      assert.deepEqual(r.sorted, want, x);
    }
    git(d, 'tag', 'treetag', `${b}^{tree}`);
    const NOT_COMMIT = 'range: not a commit, or git refused the repository';
    for (const x of [`${b}:impl`, `${b}^{tree}`, `${b}:docs/b.md`, 'treetag', `${a}..${b}`, `^${a}`, `${b}:`, 'HEAD:docs', 'no-such-branch']) {
      couldNotRun(range(d, a, x), NOT_COMMIT);
      couldNotRun(range(d, x, b), NOT_COMMIT);
    }
  });
  it('a SHA-256 repository works: a full sha of 64 hex digits is accepted (skipped here when git cannot make one)', (t) => {
    const d = fresh('sha256');
    const init = spawnSync('git', ['init', '-q', '-b', 'main', '--object-format=sha256', d], { env: gitEnv, encoding: 'utf8' });
    if (init.status !== 0) { console.log('classify-paths sha256 test: this git cannot make a SHA-256 repository, skipped'); t.skip('no sha256 support'); return; }
    put(d, 'impl/x.sh'); put(d, 'docs/a.md'); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'a');
    const a = git(d, 'rev-parse', 'HEAD');
    assert.equal(a.length, 64);
    put(d, 'impl/x.sh', 'b\n'); put(d, 'docs/n.md');
    const b = commit(d);
    for (const [x, y] of [[a, b], [a.slice(0, 12), 'HEAD'], ['HEAD~1', b]]) {
      const r = range(d, x, y);
      assert.equal(r.status, 0, r.all);
      assert.deepEqual(r.sorted, [['basis', 'docs/n.md'], ['implementation', 'impl/x.sh']]);
    }
    couldNotRun(range(d, a, `${b}:impl`), 'range: not a commit, or git refused the repository');
  });
});

// ---- 5 a step that cannot run -------------------------------------------------------------------------------------------
describe('classify-paths.sh: a step that cannot run is exit 2, never 1, never a verdict, never a class line', () => {
  let root; let fx;
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'classify-paths-run-'));
    mkdirSync(path.join(root, 'tmp'));
    const repo = path.join(root, 'repo'); mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main'); put(repo, 'docs/a.md'); put(repo, 'impl/o.sh'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'a');
    const a = git(repo, 'rev-parse', 'HEAD');
    put(repo, 'impl/n.sh'); put(repo, 'gen/g.sql'); put(repo, 'docs/b.md', 'y\n'); put(repo, 'docs/a.md', 'z\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'b');
    const b = git(repo, 'rev-parse', 'HEAD');
    fx = { repo, a, b, list: writeList(RANGE_LIST, root), paths: writePaths(['docs/a', 'impl/x', 'gen/y', 'docs/b', 'impl/z', 'a b'], root) };
  });
  after(() => { toolPath = null; tmpOverride = null; rmSync(root, { recursive: true, force: true }); });
  let n = 0;
  const outFile = () => path.join(root, `o-${n++}`);
  /** The scenarios: what the script is run with, the status of the untouched run, and the tools it must call. */
  const ALL = ['mktemp', 'rm', 'tr', 'wc', 'cmp', 'cat'];
  const SCENARIOS = [
    { name: 'paths with --out', args: () => ['--list', fx.list, '--paths', fx.paths, '--out', outFile()], truth: 0, tools: [...ALL, 'mv'] },
    { name: 'a violated rule', args: () => ['--list', fx.list, '--paths', fx.paths, '--out', outFile(), '--require', 'basis-only'], truth: 1, tools: [...ALL, 'mv'] },
    { name: 'quiet', args: () => ['--list', fx.list, '--paths', fx.paths, '--quiet'], truth: 0, tools: ALL },
    { name: 'rows on standard output', args: () => ['--list', fx.list, '--paths', fx.paths], truth: 0, tools: ALL },
    { name: 'range with --out', args: () => ['--list', fx.list, '--range', fx.a, fx.b, '--out', outFile()], truth: 0, cwd: () => fx.repo, tools: [...ALL, 'git', 'env', 'mv'] },
    { name: 'a violated rule on a range', args: () => ['--list', fx.list, '--range', fx.a, fx.b, '--out', outFile(), '--require', 'no-basis'], truth: 1, cwd: () => fx.repo, tools: [...ALL, 'git', 'env', 'mv'] },
    { name: 'range with rows on standard output', args: () => ['--list', fx.list, '--range', fx.a, fx.b], truth: 0, cwd: () => fx.repo, tools: [...ALL, 'git', 'env'] },
  ];
  const go = (s) => run(s.args(), { cwd: s.cwd ? s.cwd() : undefined });
  it('(guard) the private PATH itself works: the scenarios give their own status, with the summary line', () => {
    toolPath = makeBin(root); tmpOverride = path.join(root, 'tmp');
    for (const s of SCENARIOS) { const r = go(s); assert.equal(r.status, s.truth, `${s.name}: ${r.all}`); assert.match(r.out, SUMMARY); }
  });
  for (const s of SCENARIOS) {
    for (const tool of s.tools) {
      it(`${s.name}: ${tool} missing is exit 2`, () => {
        toolPath = makeBin(root, { omit: [tool] }); tmpOverride = path.join(root, 'tmp');
        couldNotRun(go(s), null);
      });
      for (const code of [1, 2]) {
        it(`${s.name}: ${tool} failing with status ${code} is exit 2`, () => {
          toolPath = makeBin(root, { shim: { [tool]: `exit ${code}` } }); tmpOverride = path.join(root, 'tmp');
          couldNotRun(go(s), null);
        });
      }
    }
  }
  it('a tool that prints and then fails is exit 2, not what it printed', () => {
    for (const tool of ['wc', 'tr', 'cat']) {
      toolPath = makeBin(root, { shim: { [tool]: `${which(tool)} "$@" || exit $?; exit 1` } }); tmpOverride = path.join(root, 'tmp');
      couldNotRun(go(SCENARIOS[0]), null);
    }
  });
  it('a temporary directory that cannot be made is exit 2: TMPDIR missing, TMPDIR a file, and mktemp failing', () => {
    toolPath = makeBin(root);
    for (const tmp of [path.join(root, 'no-such-dir'), path.join(root, 'o-file')]) {
      writeFileSync(path.join(root, 'o-file'), 'x');
      tmpOverride = tmp;
      couldNotRun(go(SCENARIOS[0]), null);
    }
    toolPath = makeBin(root, { shim: { mktemp: 'exit 1' } }); tmpOverride = path.join(root, 'tmp');
    couldNotRun(go(SCENARIOS[0]), null);
  });
  it('an output file that cannot be written is exit 2', () => {
    toolPath = null; tmpOverride = path.join(root, 'tmp');
    couldNotRun(run(['--list', fx.list, '--paths', fx.paths, '--out', path.join(root, 'no-dir', 'o')]), null);
    couldNotRun(run(['--list', fx.list, '--paths', fx.paths, '--out', root]), null);
  });
  /** Runs a scenario into a directory of its own, with a stale result already at --out; returns the run and the directory's names. */
  const withOut = (extraArgs, { shim, stale = true } = {}) => {
    const dir = path.join(root, `od-${n++}`); mkdirSync(dir);
    const out = path.join(dir, 'result');
    if (stale) writeFileSync(out, 'STALE\n');
    toolPath = makeBin(root, shim ? { shim } : {}); tmpOverride = path.join(root, 'tmp');
    const r = run(['--paths', fx.paths, '--out', out, ...extraArgs]);
    return { r, out, names: readdirSyncOf(dir) };
  };
  it('--out holds a result only after exit 0 or 1: a stale file is gone after exit 2, and a partial file is never left', () => {
    const bad = withOut(['--list', writeRaw('basis\tx/*\n')]);
    couldNotRun(bad.r, 'list: line 1: not three tab-separated fields');
    assert.deepEqual(bad.names, [], 'a stale result must not survive an exit 2, and nothing else is left in the directory');
    const catFails = withOut(['--list', fx.list], { shim: { cat: 'echo partial-line; exit 1' } });
    couldNotRun(catFails.r, null);
    assert.deepEqual(catFails.names, [], 'a failed copy leaves no partial file and no temporary file');
    const mvFails = withOut(['--list', fx.list], { shim: { mv: 'exit 1' } });
    couldNotRun(mvFails.r, null);
    assert.deepEqual(mvFails.names, [], 'a failed move leaves no result and no temporary file');
    // with an rm that always fails nothing can be removed, so there is no stale file to begin with: the result must not appear
    const rmFails = withOut(['--list', fx.list], { shim: { rm: 'exit 1' }, stale: false });
    couldNotRun(rmFails.r, null);
    assert.ok(!existsSync(rmFails.out), 'a cleanup that fails is exit 2 and leaves no result');
    const ok = withOut(['--list', fx.list]);
    assert.equal(ok.r.status, 0, ok.r.all);
    assert.deepEqual(ok.names, ['result']);
    assert.equal(readFileSync(ok.out, 'utf8').split('\n').length, 7, 'the stale content is replaced by the 6 rows');
    const violated = withOut(['--list', fx.list, '--require', 'basis-only']);
    assert.equal(violated.r.status, 1, violated.r.all);
    assert.deepEqual(violated.names, ['result']);
    assert.ok(!readFileSync(violated.out, 'utf8').includes('STALE'));
  });
  it('a file name that starts with - (it could be read as an option by a tool) is exit 2 for --list, --paths and --out', () => {
    const list = writeList([L('basis', 'x/*', 'r')]); const paths = writePaths(['a']);
    toolPath = makeBin(root); tmpOverride = path.join(root, 'tmp');
    couldNotRun(run(['--list', '-list', '--paths', paths]), null);
    couldNotRun(run(['--list', list, '--paths', '-paths']), null);
    couldNotRun(run(['--list', list, '--paths', paths, '--out', '-out']), null);
  });
  it('--out that names the list or the paths file under another spelling (./name, a symlink, a hard link) is exit 2, and the input is untouched', () => {
    toolPath = makeBin(root); tmpOverride = path.join(root, 'tmp');
    for (const which of ['list', 'paths']) {
      for (const spelling of ['dot', 'symlink', 'hardlink']) {
        const dir = path.join(root, `id-${n++}`); mkdirSync(dir);
        const listFile = path.join(dir, 'l2.tsv'); const pathsFile = path.join(dir, 'p2.bin');
        writeFileSync(listFile, `${L('basis', 'x/*', 'r')}\n`); writeFileSync(pathsFile, 'a\0');
        const target = which === 'list' ? 'l2.tsv' : 'p2.bin';
        let out = `./${target}`;
        if (spelling === 'symlink') { symlinkSync(target, path.join(dir, 'alias')); out = 'alias'; }
        if (spelling === 'hardlink') { linkSync(path.join(dir, target), path.join(dir, 'hard')); out = 'hard'; }
        const before = readFileSync(path.join(dir, target));
        const r = run(['--list', 'l2.tsv', '--paths', 'p2.bin', '--out', out], { cwd: dir });
        couldNotRun(r, 'usage: --out is the list or the paths file');
        assert.ok(existsSync(path.join(dir, target)), `${which} via ${spelling}: the input was removed`);
        assert.deepEqual(readFileSync(path.join(dir, target)), before, `${which} via ${spelling}: the input changed`);
      }
    }
  });
  it('the --out file has mode 0600 (it is made by mktemp and moved into place): pinned', () => {
    toolPath = makeBin(root); tmpOverride = path.join(root, 'tmp');
    const dir = path.join(root, `mode-${n++}`); mkdirSync(dir);
    const out = path.join(dir, 'result');
    const r = run(['--list', fx.list, '--paths', fx.paths, '--out', out]);
    assert.equal(r.status, 0, r.all);
    assert.equal(statSync(out).mode & 0o777, 0o600);
  });
  it('--out may not be the list or the paths file (they would be removed first)', () => {
    const list = writeList([L('basis', 'x/*', 'r')]); const paths = writePaths(['a']);
    toolPath = makeBin(root); tmpOverride = path.join(root, 'tmp');
    couldNotRun(run(['--list', list, '--paths', paths, '--out', list]), null);
    couldNotRun(run(['--list', list, '--paths', paths, '--out', paths]), null);
    assert.ok(existsSync(list) && existsSync(paths));
  });
  it('an unreadable --paths or --list is exit 2, and a PATH without awk, sed, sort and grep is fine', () => {
    toolPath = makeBin(root); tmpOverride = path.join(root, 'tmp');
    couldNotRun(run(['--list', fx.list, '--paths', path.join(root, 'nope')]), 'paths: cannot read');
    assert.equal(go(SCENARIOS[0]).status, 0);
  });
  it('the temporary directory is removed before the verdict, and nothing is left behind in it', () => {
    const own = path.join(root, 'tmp-own'); mkdirSync(own);
    toolPath = makeBin(root); tmpOverride = own;
    for (const s of SCENARIOS) go(s);
    couldNotRun(run(['--list', fx.list, '--paths', writeRaw('a\0b')]), null);
    couldNotRun(run(['--list', writeRaw('x'), '--paths', fx.paths]), null);
    assert.deepEqual(readdirSyncOf(own), [], 'the private temporary directory is gone');
  });
});
function readdirSyncOf(dir) { return spawnSync('ls', ['-A', dir], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean); }

// The class: every output the script reads must be proven complete before it is used. For each tool the script calls, for each call
// number n of that tool, a shim runs the real tool and hands on its standard output without the last k lines (k = 1, 2 and all)
// with status 0. The shim records whether the cut really changed that call's output (it compares before and after). A call whose
// output changed must end in exit 2; a call that had nothing to cut must give exactly the untruncated run. Output that has no line
// feed (NUL-separated data) is one line, so any cut empties it. `rm` and `cmp` print nothing, so a cut cannot change them: their
// failures are swept above (missing, status 1, status 2).
describe('classify-paths.sh: a stage output that is cut short is exit 2, whatever the tool and whichever call', () => {
  let root; let fx;
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'classify-paths-sweep-'));
    mkdirSync(path.join(root, 'tmp'));
    const repo = path.join(root, 'repo'); mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main'); put(repo, 'docs/a.md'); put(repo, 'impl/o.sh'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'a');
    const a = git(repo, 'rev-parse', 'HEAD');
    put(repo, 'impl/n.sh'); put(repo, 'gen/g.sql'); put(repo, 'docs/b.md', 'y\n'); put(repo, 'docs/a.md', 'z\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'b');
    const b = git(repo, 'rev-parse', 'HEAD');
    fx = { repo, a, b, list: writeList([...RANGE_LIST, L('basis', 'docs/*', 'a reason')], root), paths: writePaths(['docs/a', 'impl/x', 'gen/y', 'docs/b', 'impl/z', 'a b'], root) };
  });
  after(() => { toolPath = null; tmpOverride = null; rmSync(root, { recursive: true, force: true }); });
  const SWEPT = ['git', 'env', 'tr', 'wc', 'cat', 'mktemp'];
  const BASE = ['tr', 'wc', 'mktemp', 'cat'];
  const SCENARIOS = [
    { name: 'paths with --out', args: (o) => ['--list', fx.list, '--paths', fx.paths, '--out', o], truth: 0, withOut: true, tools: BASE },
    { name: 'a violated rule', args: (o) => ['--list', fx.list, '--paths', fx.paths, '--out', o, '--require', 'basis-only'], truth: 1, withOut: true, tools: BASE },
    { name: 'quiet', args: () => ['--list', fx.list, '--paths', fx.paths, '--quiet'], truth: 0, tools: BASE },
    { name: 'rows on standard output', args: () => ['--list', fx.list, '--paths', fx.paths], truth: 0, tools: BASE },
    { name: 'a violated rule with rows on standard output', args: () => ['--list', fx.list, '--paths', fx.paths, '--require', 'no-basis'], truth: 1, tools: BASE },
    { name: 'range with --out', args: (o) => ['--list', fx.list, '--range', fx.a, fx.b, '--out', o], truth: 0, withOut: true, cwd: () => fx.repo, tools: [...BASE, 'git', 'env'] },
    { name: 'a violated rule on a range', args: (o) => ['--list', fx.list, '--range', fx.a, fx.b, '--out', o, '--require', 'basis-only'], truth: 1, withOut: true, tools: [...BASE, 'git', 'env'], cwd: () => fx.repo },
    { name: 'range with rows on standard output', args: () => ['--list', fx.list, '--range', fx.a, fx.b], truth: 0, cwd: () => fx.repo, tools: [...BASE, 'git', 'env'] },
  ];
  let counter = 0;
  /** Runs a scenario with `tool` shimmed: its call number `n` loses its last `k` lines (n = 0: no cut, only counted). */
  const runShimmed = (s, tool, n, k) => {
    const cnt = path.join(root, `cnt-${counter++}`);
    const real = which(tool);
    const cut = k === 'all' ? ': > "$U"' : `${which('head')} -n -${k} "$T" > "$U"`;
    // every command of the shim is checked: a failure of the test's own I/O goes to `.err` and fails the test (it is never counted as
    // "the script noticed the cut"); the mark that the output changed is written last, after everything else succeeded
    const shim = `bad() { echo "$1" >> ${cnt}.err; exit 3; }\nc=0\nif [ -f ${cnt} ]; then read c < ${cnt} || bad count-read; fi\nc=$((c+1))\necho $c > ${cnt} || bad count-write\n`
      + `if [ "$c" = ${n} ]; then\n  T=$(${which('mktemp')}) || bad mktemp\n  U=$(${which('mktemp')}) || bad mktemp\n  ${real} "$@" > "$T" || bad real-tool\n  ${cut} || bad cut\n  rc=0; ${which('cmp')} -s "$T" "$U" || rc=$?\n  case $rc in 0 | 1) ;; *) bad cmp ;; esac\n  ${which('cat')} "$U" || bad hand-on\n  ${which('rm')} -f "$T" "$U" || bad rm\n  if [ "$rc" = 1 ]; then echo changed > ${cnt}.chg || bad mark; fi\n  exit 0\nfi\nexec ${real} "$@"`;
    toolPath = makeBin(root, { shim: { [tool]: shim } }); tmpOverride = path.join(root, 'tmp');
    const o = path.join(root, `sweep-out-${counter}`);
    writeFileSync(o, 'STALE\n'); // a stale result is in place: after an exit 2 it must be gone
    const r = run(s.args(o), { cwd: s.cwd ? s.cwd() : undefined });
    let calls = 0;
    try { calls = Number(readFileSync(cnt, 'utf8').trim()); } catch { /* the tool was not called */ }
    assert.ok(!existsSync(`${cnt}.err`), `the shim's own command failed (${tool} call ${n}, k=${k}): ${existsSync(`${cnt}.err`) ? readFileSync(`${cnt}.err`, 'utf8') : ''}`);
    return { ...r, calls, changed: existsSync(`${cnt}.chg`), outExists: existsSync(o) };
  };
  let runs = 0;
  const cutCalls = Object.fromEntries(SWEPT.map((t) => [t, new Set()]));
  const allCalls = Object.fromEntries(SWEPT.map((t) => [t, new Set()]));
  const started = Date.now();
  for (const s of SCENARIOS) {
    for (const tool of SWEPT) {
      if (!s.tools.includes(tool)) continue;
      it(`${s.name}: ${tool}: every call cut by 1, 2 or all lines is exit 2 or unchanged`, () => {
        const base = runShimmed(s, tool, 0, 1);
        assert.equal(base.status, s.truth, `the untruncated run: ${base.all}`);
        assert.ok(base.calls >= 1, `${tool} is not called for ${s.name}`);
        const baseOut = base.out;
        for (let n = 1; n <= base.calls; n += 1) {
          for (const k of [1, 2, 'all']) {
            runs += 1;
            const r = runShimmed(s, tool, n, k);
            const label = `${tool} call ${n} of ${base.calls}, last ${k} line(s) dropped`;
            allCalls[tool].add(`${s.name}#${n}`);
            if (r.changed) {
              cutCalls[tool].add(`${s.name}#${n}`);
              assert.equal(r.status, 2, `${label}: the output of the call was cut, and the result is not exit 2: ${r.all}`);
              assert.ok(r.all.includes('classify-paths: could not run ('), `${label}: ${r.all}`);
              assert.ok(!SUMMARY.test(r.all) && !CLASS_LINE.test(r.all) && !r.all.includes('FAILED'), `${label}: a verdict was printed: ${r.all}`);
              if (s.withOut) assert.equal(r.outExists, false, `${label}: --out holds a stale or partial result after exit 2`);
            } else {
              assert.equal(r.status, s.truth, `${label}: nothing was cut, and the verdict changed: ${r.all}`);
              assert.equal(r.out, baseOut, `${label}: nothing was cut, and the output changed`);
              if (s.withOut) assert.equal(r.outExists, true, `${label}: nothing was cut, and --out is missing`);
            }
          }
        }
      });
    }
  }
  it('(guard) the sweep ran, and every call of every tool had its output really cut at least once (a shim that cuts nothing would pass everything)', () => {
    assert.ok(runs > 100, `only ${runs} shimmed runs`);
    for (const tool of SWEPT) {
      const never = [...allCalls[tool]].filter((c) => !cutCalls[tool].has(c));
      assert.deepEqual(never, [], `${tool}: these calls were never really cut (the call prints nothing, or the shim does not cut)`);
      assert.ok(cutCalls[tool].size >= 1, `${tool}: no call was cut`);
    }
    console.log(`sweep: ${runs} shimmed runs in ${Date.now() - started} ms, calls cut ${JSON.stringify(Object.fromEntries(SWEPT.map((t) => [t, cutCalls[t].size])))}`);
  });
});

// ---- what is judged is what is used, what is delivered is what was computed, what is diffed is a commit -------------------------
describe('classify-paths.sh: inputs are taken once, the delivered file is compared byte for byte, a resolved commit is checked twice', () => {
  let root; let fx;
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'classify-paths-once-'));
    mkdirSync(path.join(root, 'tmp'));
    const repo = path.join(root, 'repo'); mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main'); put(repo, 'docs/a.md'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'a');
    const a = git(repo, 'rev-parse', 'HEAD');
    put(repo, 'impl/n.sh'); put(repo, 'gen/g.sql'); put(repo, 'docs/b.md', 'y\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'b');
    fx = { repo, a, b: git(repo, 'rev-parse', 'HEAD') };
  });
  after(() => { toolPath = null; tmpOverride = null; rmSync(root, { recursive: true, force: true }); });
  let n = 0;
  const ORIGINAL_LIST = [L('basis', 'src/keep/*', 'r'), L('implementation', 'src/*', 'r'), L('generated', 'gen/*', 'r')];
  const REWRITTEN_LIST = 'basis\\t*\\trewritten\\n'; // a printf format
  const ORIGINAL_PATHS = ['src/a', 'gen/b', 'doc/c', 'src/keep/d'];
  const REWRITTEN_PATHS = ['zzz/1', 'zzz/2', 'zzz/3', 'zzz/4'];
  /** A fresh set of inputs; returns the files. */
  const inputs = () => {
    const dir = path.join(root, `in-${n++}`); mkdirSync(dir);
    const list = writeList(ORIGINAL_LIST, dir); const paths = writePaths(ORIGINAL_PATHS, dir);
    return { dir, list, paths };
  };
  /** A shim of `tool` that, from its call number `from` on, rewrites `file` with `content` (a printf format; then runs the real tool). */
  const rewriter = (tool, from, file, content, mark) => {
    const cnt = `${mark}.cnt`;
    return `c=0\nif [ -f ${cnt} ]; then read c < ${cnt}; fi\nc=$((c+1))\necho $c > ${cnt}\nif [ "$c" -ge ${from} ]; then printf '${content}' > ${file} && echo fired > ${mark}.fired; fi\nexec ${which(tool)} "$@"`;
  };
  const shimmed = (shim, args, opts) => { toolPath = makeBin(root, { shim }); tmpOverride = path.join(root, 'tmp'); const r = run(args, opts); return r; };
  const plain = (args, opts) => shimmed({}, args, opts);
  /** The calls the script makes of `tool` for these arguments. */
  const callsOf = (tool, args, opts) => {
    const cnt = path.join(root, `calls-${n++}`);
    shimmed({ [tool]: `c=0\nif [ -f ${cnt} ]; then read c < ${cnt}; fi\necho $((c+1)) > ${cnt}\nexec ${which(tool)} "$@"` }, args, opts);
    return existsSync(cnt) ? Number(readFileSync(cnt, 'utf8')) : 0;
  };
  const ok = (r, base, label) => {
    if (r.status === 2) { couldNotRun(r, null); return; }
    assert.equal(r.status, base.status, `${label}: ${r.all}`);
    assert.equal(r.out, base.out, `${label}: the result is not the one for the original input`);
  };

  it('the list is judged and used as one copy: a list rewritten while the script runs gives the result for the original list, or exit 2', () => {
    const f = inputs();
    const args = ['--list', f.list, '--paths', f.paths];
    const base = plain(args);
    assert.equal(base.status, 0, base.all);
    assert.ok(base.out.includes('implementation\tsrc/a\n') && base.out.includes('generated\tgen/b\n') && base.out.includes('basis\tsrc/keep/d\n'), base.out);
    for (const tool of ['tr', 'wc', 'cmp']) {
      const calls = callsOf(tool, args);
      assert.ok(calls >= 1, `${tool} is not called`);
      for (let from = 1; from <= calls; from += 1) {
        const g = inputs();
        const mark = path.join(g.dir, `m-${tool}-${from}`);
        const r = shimmed({ [tool]: rewriter(tool, from, g.list, REWRITTEN_LIST, mark) }, ['--list', g.list, '--paths', g.paths]);
        assert.ok(existsSync(`${mark}.fired`), `the shim of ${tool} (from call ${from}) never rewrote the list`);
        ok(r, base, `${tool} from call ${from}`);
      }
    }
  });
  it('--paths is taken once as well: a paths file rewritten while the script runs gives the result for the original, or exit 2', () => {
    const f = inputs();
    const base = plain(['--list', f.list, '--paths', f.paths]);
    for (const tool of ['tr', 'wc', 'cmp']) {
      const calls = callsOf(tool, ['--list', f.list, '--paths', f.paths]);
      for (let from = 1; from <= calls; from += 1) {
        const g = inputs();
        const mark = path.join(g.dir, `p-${tool}-${from}`);
        const rewritten = REWRITTEN_PATHS.map((x) => `${x}\\0`).join('');
        const r = shimmed({ [tool]: rewriter(tool, from, g.paths, rewritten, mark) }, ['--list', g.list, '--paths', g.paths]);
        assert.ok(existsSync(`${mark}.fired`), `the shim of ${tool} (from call ${from}) never rewrote the paths`);
        ok(r, base, `${tool} from call ${from}`);
      }
    }
  });
  it('an input that is a different file by the time it is compared is exit 2: a list that no longer equals its copy is never used', () => {
    const f = inputs();
    // cmp is the proof that the copy equals the source: a cmp that reports a difference (status 1) or cannot compare (status 2) stops the run
    for (const body of ['exit 1', 'exit 2']) {
      couldNotRun(shimmed({ cmp: body }, ['--list', f.list, '--paths', f.paths]), null);
    }
  });

  /** A shim of `cat` that corrupts what it writes when it is given the result file (a path ending in /res): same lines, other bytes. */
  const corruptRes = `real=${which('cat')}\nfor a in "$@"; do case $a in */res) T=$(${which('mktemp')}) || exit 3; $real "$@" > "$T" || exit 3; ${which('tr')} 'a-z' 'A-Z' < "$T"; ${which('rm')} -f "$T"; exit 0 ;; esac; done\nexec $real "$@"`;
  const outCase = (shim, extra = []) => {
    const f = inputs();
    const dir = path.join(root, `out-${n++}`); mkdirSync(dir);
    const out = path.join(dir, 'result');
    const r = shimmed(shim, ['--list', f.list, '--paths', f.paths, '--out', out, ...extra]);
    return { r, out, names: readdirSyncOf(dir) };
  };
  it('the --out copy is compared with the result byte for byte: same lines, other bytes is exit 2 and nothing is left at --out', () => {
    const bad = outCase({ cat: corruptRes });
    couldNotRun(bad.r, null);
    assert.deepEqual(bad.names, [], 'no result and no temporary file after a corrupted copy');
    const good = outCase({});
    assert.equal(good.r.status, 0, good.r.all);
    assert.deepEqual(good.names, ['result']);
  });
  it('the comparison of the --out copy that cannot be made, or that says "different", is exit 2 and nothing is left', () => {
    const onlyRes = (code) => `for a in "$@"; do case $a in */res) exit ${code} ;; esac; done\nexec ${which('cmp')} "$@"`;
    for (const code of [1, 2]) {
      const r = outCase({ cmp: onlyRes(code) });
      couldNotRun(r.r, null);
      assert.deepEqual(r.names, [], `cmp of the result ending with status ${code}: nothing is left at --out`);
    }
    const missing = outCase({ cmp: `for a in "$@"; do case $a in */res) exit 127 ;; esac; done\nexec ${which('cmp')} "$@"` });
    couldNotRun(missing.r, null);
    assert.deepEqual(missing.names, []);
  });

  /** A git whose answer to `rev-parse` or `cat-file` is changed by `body` (a shell fragment; $T holds the real answer). */
  const gitShim = ({ revParse, catFile }) => `real=${which('git')}\ncase " $* " in\n *" rev-parse "*)\n  T=$(${which('mktemp')}) || exit 3; $real "$@" > "$T" || exit $?\n  ${revParse ?? `${which('cat')} "$T"`}\n  ${which('rm')} -f "$T"; exit 0 ;;\n *" cat-file "*)\n  ${catFile ?? 'exec $real "$@"'} ;;\n *) exec $real "$@" ;;\nesac`;
  const rangeArgs = () => ['--list', writeList(RANGE_LIST, root), '--range', fx.a, fx.b];
  it('a range whose git answers are untouched passes (guard for the shim below)', () => {
    const r = shimmed({ git: gitShim({}) }, rangeArgs(), { cwd: fx.repo });
    assert.equal(r.status, 0, r.all);
    assert.match(r.out, /3 path\(s\)/);
  });
  it('rev-parse must answer exactly "<sha>\\n": an extra line, extra bytes, no line feed, a CR, a blank line or two shas is exit 2', () => {
    const cat = which('cat'); const tr = which('tr');
    const variants = {
      'an extra line': `${cat} "$T"; echo extra`,
      'a blank line after': `${cat} "$T"; echo`,
      'two shas': `${cat} "$T"; ${cat} "$T"`,
      'no line feed': `${tr} -d '\\n' < "$T"`,
      'a trailing space': `${tr} '\\n' ' ' < "$T"; echo`,
      'a carriage return': `${tr} -d '\\n' < "$T"; printf '\\r\\n'`,
      'extra bytes after the line': `${cat} "$T"; printf 'x'`,
    };
    for (const [name, revParse] of Object.entries(variants)) {
      couldNotRun(shimmed({ git: gitShim({ revParse }) }, rangeArgs(), { cwd: fx.repo }), null);
      assert.ok(name);
    }
  });
  it('the object must be confirmed as a commit by a second question: cat-file -t answering anything but "commit\\n", or cut short, is exit 2', () => {
    const variants = {
      tree: 'echo tree', blob: 'echo blob', tag: 'echo tag', 'commit without a line feed': "printf 'commit'",
      'commit and an extra line': "echo commit; echo extra", 'commit with a space': "echo 'commit '", 'nothing': ':', 'a failing cat-file': 'exit 1',
      'a CR': "printf 'commit\\r\\n'",
    };
    for (const [name, catFile] of Object.entries(variants)) {
      couldNotRun(shimmed({ git: gitShim({ catFile }) }, rangeArgs(), { cwd: fx.repo }), null);
      assert.ok(name);
    }
    const asked = path.join(root, `asked-${n++}`);
    const r = shimmed({ git: gitShim({ catFile: `echo "$@" >> ${asked}; exec $real "$@"` }) }, rangeArgs(), { cwd: fx.repo });
    assert.equal(r.status, 0, r.all);
    const lines = readFileSync(asked, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2, 'one cat-file question for each of the two arguments');
    for (const l of lines) assert.match(l, /cat-file -t [0-9a-f]{40}$/);
  });
});

// ---- the oracle: an independent matcher (a list line is a literal or has * for "any characters, / included") ---------------------------
function readList(file) {
  const text = readFileSync(file, 'utf8');
  return text === '' ? [] : text.replace(/\n$/, '').split('\n').map((l) => { const [cls, pattern, reason] = l.split('\t'); return { cls, pattern, reason }; });
}
const toRe = (p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+^${}()|\\[\]?]/g, '\\$&')).join('[^]*')}$`);
function oracle(rules, p) {
  for (const r of rules) if (toRe(r.pattern).test(p)) return { cls: r.cls, matched: true };
  return { cls: 'basis', matched: false };
}

// ---- 6 completeness -----------------------------------------------------------------------------------------------------
describe('classify-paths.sh: the output is complete, and agrees with an independent matcher (6)', () => {
  it('250 paths in: 250 rows out, in order, each class equal to the independent matcher; --quiet prints no path', () => {
    const rules = [{ cls: 'basis', pattern: '*/__tests__/*', reason: 'r' }, { cls: 'implementation', pattern: 'src/*', reason: 'r' }, { cls: 'generated', pattern: 'gen/*', reason: 'r' }, { cls: 'implementation', pattern: '*.sh', reason: 'r' }];
    const paths = [];
    for (let i = 0; i < 250; i += 1) paths.push(['src/m' + i + '.ts', 'src/__tests__/t' + i + '.ts', 'gen/g' + i + '.sql', 'docs/d' + i + '.md', 'tools/s' + i + '.sh'][i % 5]);
    const list = writeList(rules.map((r) => L(r.cls, r.pattern, r.reason)));
    const out = path.join(scratch, `out-${seq++}`);
    const r = run(['--list', list, '--paths', writePaths(paths), '--out', out]);
    assert.equal(r.status, 0, r.all);
    const rows = rowsOf(out);
    assert.equal(rows.length, 250);
    assert.deepEqual(rows.map((x) => x[1]), paths);
    assert.deepEqual(rows.map((x) => x[0]), paths.map((p) => oracle(rules, p).cls));
    const count = (c) => rows.filter((x) => x[0] === c).length;
    assert.equal(r.out, `classify-paths: 250 path(s): ${count('basis')} basis, ${count('generated')} generated, ${count('implementation')} implementation\n`);
    const q = run(['--list', list, '--paths', writePaths(paths), '--quiet']);
    assert.equal(q.out.split('\n').length, 2, 'one summary line');
    for (const p of ['src/m1.ts', 'gen/g2.sql', 'tools/s4.sh']) assert.ok(!q.all.includes(p), `--quiet printed ${p}`);
  });
  it('a range of 60 paths: the rows are the paths node computes from the files it wrote', () => {
    const d = newRepo({ 'docs/base.md': 'a\n' });
    const a = git(d, 'rev-parse', 'HEAD');
    const expected = [];
    for (let i = 0; i < 60; i += 1) { const p = [`impl/f${i}.sh`, `gen/f${i}.sql`, `docs/f${i}.md`][i % 3]; put(d, p); expected.push(p); }
    const b = commit(d);
    const r = range(d, a, b);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(r.sorted.map((x) => x[1]), [...expected].sort());
    assert.deepEqual(r.sorted.map((x) => x[0]), [...expected].sort().map((p) => oracle(readList(writeList(RANGE_LIST)), p).cls));
    assert.match(r.out, /60 path\(s\): 20 basis, 20 generated, 20 implementation/);
  });
});

// ---- 7 this repository's own list ---------------------------------------------------------------------------------------
/**
 * Every tracked path at HEAD is classified, and the paths that fall to "unmatched = basis" sit in the groups named here. A new
 * top-level directory, a new package or a new kind of file therefore fails this test until its place is chosen: a line in
 * basis-paths.tsv (implementation, generated) or a group here (basis on purpose). A stale group fails too.
 */
const UNMATCHED_FILES = ['basis-paths.tsv', '.gitignore', '.gitleaksignore', '.nvmrc', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'README.md', 'package-lock.json', 'package.json', 'product.md', 'vitest.config.mts',
  'framework/guarantees.md', 'scripts/push-gate.gitleaks.toml', 'scripts/scan-exclusions.tsv', '.github/pull_request_template.md'];
// supabase/migrations/ is here on purpose: a directory is trusted as generated only once CI proves its files fresh (known-gaps)
const UNMATCHED_DIRS = ['.claude/', 'docs/', 'tests/', 'legacy/', 'framework/adapters/', 'framework/lint-config/', 'framework/runtime/', 'supabase/migrations/'];
describe('classify-paths.sh: this repository (7)', () => {
  const listFile = path.join(repoRoot, 'basis-paths.tsv');
  const tracked = () => {
    const r = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'], { cwd: repoRoot, env: cleanEnv, encoding: 'utf8', maxBuffer: 1 << 28 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.split('\0').filter(Boolean);
  };
  it('the list parses, and every tracked path at HEAD is classified as the independent matcher says', () => {
    const paths = tracked();
    assert.ok(paths.length > 1000, `${paths.length} tracked paths`);
    const out = path.join(scratch, `repo-out-${seq++}`);
    const r = run(['--list', listFile, '--paths', writePaths(paths), '--out', out]);
    assert.equal(r.status, 0, r.all);
    const rows = rowsOf(out);
    const rules = readList(listFile);
    assert.equal(rows.length, paths.length);
    assert.deepEqual(rows.map((x) => x[1]), paths);
    const wrong = rows.filter(([cls, p]) => cls !== oracle(rules, p).cls).map(([, p]) => p);
    assert.deepEqual(wrong, []);
    const count = (c) => rows.filter((x) => x[0] === c).length;
    assert.ok(count('implementation') > 0 && count('basis') > 0, 'basis and implementation are in use');
    assert.equal(count('generated'), 0, 'no path of this repository is generated until CI proves a directory fresh (known-gaps): the class stays in the script and its tests');
    assert.ok(!rules.some((x) => x.cls === 'generated'), 'the list has no generated line');
    assert.equal(r.out, `classify-paths: ${paths.length} path(s): ${count('basis')} basis, ${count('generated')} generated, ${count('implementation')} implementation\n`);
  });
  it('the paths that fall to "unmatched = basis" are exactly the groups named in this test', () => {
    const rules = readList(listFile);
    const unmatched = tracked().filter((p) => !oracle(rules, p).matched);
    const outside = unmatched.filter((p) => !UNMATCHED_FILES.includes(p) && !UNMATCHED_DIRS.some((d) => p.startsWith(d)));
    assert.deepEqual(outside, [], 'a path that no line matches and no group names: put it on the list, or name its group here');
    const staleFiles = UNMATCHED_FILES.filter((f) => !unmatched.includes(f));
    const staleDirs = UNMATCHED_DIRS.filter((d) => !unmatched.some((p) => p.startsWith(d)));
    assert.deepEqual([...staleFiles, ...staleDirs], [], 'a group that holds no unmatched path any more');
    // source never falls through silently: nothing unmatched sits in a source directory or is a script that runs
    const sourceLike = unmatched.filter((p) => /(^|\/)src\//.test(p) || /^legacy\/spec-tools\/(lib|cli)\//.test(p) || /^(bin|scripts)\/.*\.(sh|mjs)$/.test(p) || /^\.github\/workflows\//.test(p) || /^templates\/workflows\/.*\.ya?ml$/.test(p));
    assert.deepEqual(sourceLike, []);
  });
  it('the lines that carry the design: tests inside an implementation tree stay basis, and the list, docs and configs are basis', () => {
    const cls = (p) => { const r = classify(readList(listFile).map((x) => L(x.cls, x.pattern, x.reason)), [p]); assert.equal(r.status, 0, r.all); return r.rows[0][0]; };
    assert.equal(cls('framework/runtime/src/domain/__tests__/x.test.ts'), 'basis');
    assert.equal(cls('framework/runtime/testing/harness/x.ts'), 'basis');
    assert.equal(cls('framework/adapters/postgrest/src/rpc/__tests__/x.test.ts'), 'basis');
    assert.equal(cls('framework/runtime/src/domain/x.ts'), 'implementation');
    assert.equal(cls('legacy/spec-tools/lib/x.ts'), 'implementation');
    assert.equal(cls('legacy/spec-tools/cli/x.ts'), 'implementation');
    assert.equal(cls('legacy/spec-tools/__tests__/unit/x.test.ts'), 'basis');
    assert.equal(cls('scripts/classify-paths.sh'), 'implementation');
    assert.equal(cls('scripts/scan-exclusions.tsv'), 'basis');
    assert.equal(cls('bin/kaninabe.mjs'), 'implementation');
    assert.equal(cls('.github/workflows/pr-gate.yml'), 'implementation');
    assert.equal(cls('templates/workflows/pr-gate.product.yml'), 'implementation', 'a workflow that a product copies and runs');
    assert.equal(cls('templates/README.md'), 'basis', 'only the workflow templates are code');
    assert.equal(cls('templates/workflows/README.md'), 'basis', 'prose beside a workflow template');
    assert.equal(cls('templates/workflows/sub/x.yml'), 'implementation', 'the * crosses /: a template in a directory below is code too');
    assert.equal(cls('templates/workflows/x.yaml'), 'basis', 'templates are written as .yml only: no line matches .yaml, and the unmatched test above turns red on such a file');
    assert.equal(cls('supabase/migrations/20260912120201_ddl_items.sql'), 'basis', 'migrations are basis until CI proves them fresh');
    assert.equal(cls('.github/pull_request_template.md'), 'basis', 'prose, not code');
    assert.equal(cls('framework/runtime/scripts/check-node.mjs'), 'implementation');
    assert.equal(cls('framework/runtime/scripts/check-node.d.mts'), 'implementation');
    assert.equal(cls('framework/runtime/scripts/freshness-entries.json'), 'basis', 'a data table that a check reads');
    assert.equal(cls('basis-paths.tsv'), 'basis');
    assert.equal(cls('docs/rules/process/common/development-flow.md'), 'basis');
    assert.equal(cls('tests/basis-paths/classify-paths.test.mjs'), 'basis');
    assert.equal(cls('product.md'), 'basis');
    assert.equal(cls('package.json'), 'basis');
  });
});

describe('classify-paths.sh: nothing that looks like a test or data drifts into implementation or generated (7, the reverse guard)', () => {
  // a path in a class that the rule keeps apart from basis must not look like a test or like data. An exception is named here with
  // its reason, and a stale exception fails.
  const LOOKS_LIKE = /(\.test\.|\.spec\.|\/fixtures\/|\/__tests__\/|\.json$|\.md$|\.tsv$|\.ya?ml$|\.toml$|\.txt$|\.sql$|\.snap$|\.csv$|\.html$)/;
  const EXCEPTIONS = [
    [/^\.github\/workflows\/[^/]+\.ya?ml$/, 'a workflow is code: it runs, and a test-first change edits it after its tests'],
    [/^templates\/workflows\/[^/]+\.yml$/, 'a workflow template that a product copies byte for byte is code: it runs there, and a test-first change edits it after the tests that pin it'],
  ];
  it('every implementation and generated path at HEAD is code, or an excepted workflow', () => {
    const r = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'], { cwd: repoRoot, env: cleanEnv, encoding: 'utf8', maxBuffer: 1 << 28 });
    assert.equal(r.status, 0, r.stderr);
    const rules = readList(path.join(repoRoot, 'basis-paths.tsv'));
    const guarded = r.stdout.split('\0').filter(Boolean).filter((p) => oracle(rules, p).cls !== 'basis');
    assert.ok(guarded.length > 100, `${guarded.length} guarded paths`);
    const surprising = guarded.filter((p) => LOOKS_LIKE.test(p) && !EXCEPTIONS.some(([re]) => re.test(p)));
    assert.deepEqual(surprising, [], 'a path that looks like a test or data sits in a class that is not basis: narrow the list line, or name the exception with its reason');
    const stale = EXCEPTIONS.filter(([re]) => !guarded.some((p) => re.test(p))).map(([re]) => String(re));
    assert.deepEqual(stale, [], 'an exception that matches no guarded path any more');
  });
});

// ---- the shell that runs it: the same output under sh (dash here), bash, bash --posix and busybox sh ----------------------------
const SHELLS = [['bash', which('bash') ? [which('bash')] : null], ['bash --posix', which('bash') ? [which('bash'), '--posix'] : null], ['busybox sh', which('busybox') ? [which('busybox'), 'sh'] : null]];
describe('classify-paths.sh: the same bytes under other shells', () => {
  let root; let d; let a; let b;
  before(() => {
    root = fresh('shells');
    d = path.join(root, 'repo'); mkdirSync(d);
    git(d, 'init', '-q', '-b', 'main'); put(d, 'docs/a.md'); put(d, 'impl/o.sh'); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'a');
    a = git(d, 'rev-parse', 'HEAD');
    put(d, 'impl/n.sh'); put(d, 'gen/g.sql'); put(d, 'docs/a b.md', 'y\n'); put(d, '日本語.txt'); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'b');
    b = git(d, 'rev-parse', 'HEAD');
  });
  const scenario = (shell, tag) => {
    const list = writeList([...RANGE_LIST, L('basis', 'docs/*', 'a reason')], root);
    const paths = writePaths(['docs/a', 'impl/x', 'gen/y', 'a b', '日本語', '-x'], root);
    const o1 = path.join(root, `o1-${tag}`); const o2 = path.join(root, `o2-${tag}`);
    const rows = run(['--list', list, '--paths', paths], { shell });
    const viaOut = run(['--list', list, '--paths', paths, '--out', o1, '--require', 'basis-only'], { shell });
    const rng = run(['--list', list, '--range', a, b, '--out', o2], { cwd: d, shell });
    const bad = run(['--list', writeRaw('basis\tx\n', root), '--paths', paths], { shell });
    const own = run(['--list', path.join(repoRoot, 'basis-paths.tsv'), '--range', 'HEAD~1', 'HEAD', '--quiet'], { cwd: repoRoot, shell });
    const idDir = path.join(root, `id-${tag}-${seq++}`); mkdirSync(idDir);
    writeFileSync(path.join(idDir, 'l2.tsv'), `${L('basis', 'x/*', 'r')}\n`); writeFileSync(path.join(idDir, 'p2.bin'), 'a\0');
    const ident = run(['--list', 'l2.tsv', '--paths', 'p2.bin', '--out', './l2.tsv'], { cwd: idDir, shell });
    const identKept = existsSync(path.join(idDir, 'l2.tsv'));
    return JSON.stringify([rows, viaOut, readFileSync(o1, 'utf8'), rng, readFileSync(o2, 'utf8'), bad, own, ident, identKept].map((x) => (typeof x === 'string' || typeof x === 'boolean' ? x : [x.status, x.out, x.err])));
  };
  const baseline = () => scenario(undefined, 'sh');
  it('(guard) the scenario itself behaves: statuses 0, 1, 0, 2 and rows in order', () => {
    const [rows, viaOut, , rng, , bad, , ident, identKept] = JSON.parse(baseline());
    assert.equal(rows[0], 0); assert.equal(viaOut[0], 1); assert.equal(rng[0], 0); assert.equal(bad[0], 2);
    assert.equal(ident[0], 2); assert.equal(identKept, true, 'the input named as --out is not removed');
    assert.match(rows[1], /^basis\tdocs\/a\n/);
  });
  for (const [name, shell] of SHELLS) {
    it(`under ${name}: byte-identical to /bin/sh${shell ? '' : ' (SKIPPED: not installed here)'}`, (t) => {
      if (!shell) { console.log(`classify-paths shell test: ${name} is not installed, skipped`); t.skip(`${name} not installed`); return; }
      assert.equal(scenario(shell, name.replace(/\W/g, '')), baseline());
    });
  }
});
