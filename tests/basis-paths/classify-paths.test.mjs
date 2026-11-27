/**
 * Tests of scripts/classify-paths.sh and of this repository's basis-paths.tsv (development-flow, "どの path が基準か").
 *
 * The script sorts paths into three classes (basis, generated, implementation) by a list of lines `class<TAB>pattern<TAB>reason`:
 * lines are tried in order, the first match decides, a path that no line matches is basis. The paths come from a NUL-separated
 * file (--paths) or from `git diff --no-renames --name-only -z` between two commits (--range). Exit 0 passes, 1 means the
 * --require rule is violated, 2 means the script could not do its work (never 1, never a class line, never the summary line).
 *
 * The script is spec/test-first: this file is written before it. The sections follow the plan:
 *   1 list format        2 matching        3 ranges on a temporary git repository        4 --require
 *   5 a step that cannot run (and the cut-short sweep)        6 completeness        7 this repository's own list
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
const TOOLS = ['git', 'mktemp', 'rm', 'tr', 'wc', 'cat', 'cmp'];
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
function run(args, { cwd } = {}) {
  const r = spawnSync('/bin/sh', [script, ...args], { encoding: 'utf8', env: envOf(), cwd: cwd ?? scratch });
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
describe('classify-paths.sh with a private PATH holding only git, mktemp, rm, tr, wc, cat and cmp (no awk, sed, sort or grep)', () => {
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
function range(dir, a, b, { extra = [], list = RANGE_LIST, cwd } = {}) {
  const out = path.join(scratch, `rout-${seq++}`);
  const r = run(['--list', writeList(list), '--range', a, b, '--out', out, ...extra], { cwd: cwd ?? dir });
  const rows = r.status === 0 ? rowsOf(out) : null;
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
    mkdirSync(path.join(d, 'docs')); git(d, 'mv', 'impl/a.sh', 'docs/a.sh');
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
  const SCENARIOS = [
    { name: 'paths with --out', args: () => ['--list', fx.list, '--paths', fx.paths, '--out', outFile()], truth: 0, tools: ['mktemp', 'rm', 'tr', 'wc', 'cat', 'cmp'] },
    { name: 'a violated rule', args: () => ['--list', fx.list, '--paths', fx.paths, '--out', outFile(), '--require', 'basis-only'], truth: 1, tools: ['mktemp', 'rm', 'tr', 'wc', 'cat', 'cmp'] },
    { name: 'quiet', args: () => ['--list', fx.list, '--paths', fx.paths, '--quiet'], truth: 0, tools: ['mktemp', 'rm', 'tr', 'wc', 'cmp'] },
    { name: 'range with --out', args: () => ['--list', fx.list, '--range', fx.a, fx.b, '--out', outFile()], truth: 0, cwd: () => fx.repo, tools: ['git', 'mktemp', 'rm', 'tr', 'wc', 'cat', 'cmp'] },
    { name: 'a violated rule on a range', args: () => ['--list', fx.list, '--range', fx.a, fx.b, '--out', outFile(), '--require', 'no-basis'], truth: 1, cwd: () => fx.repo, tools: ['git', 'mktemp', 'rm', 'tr', 'wc', 'cat', 'cmp'] },
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
  const SWEPT = ['git', 'tr', 'wc', 'cat', 'mktemp'];
  const SCENARIOS = [
    { name: 'paths with --out', args: (o) => ['--list', fx.list, '--paths', fx.paths, '--out', o], truth: 0, tools: ['tr', 'wc', 'cat', 'mktemp'] },
    { name: 'a violated rule', args: (o) => ['--list', fx.list, '--paths', fx.paths, '--out', o, '--require', 'basis-only'], truth: 1, tools: ['tr', 'wc', 'cat', 'mktemp'] },
    { name: 'quiet', args: () => ['--list', fx.list, '--paths', fx.paths, '--quiet'], truth: 0, tools: ['tr', 'wc', 'mktemp'] },
    { name: 'range with --out', args: (o) => ['--list', fx.list, '--range', fx.a, fx.b, '--out', o], truth: 0, cwd: () => fx.repo, tools: ['git', 'tr', 'wc', 'cat', 'mktemp'] },
    { name: 'a violated rule on a range', args: (o) => ['--list', fx.list, '--range', fx.a, fx.b, '--out', o, '--require', 'basis-only'], truth: 1, tools: ['git', 'tr', 'wc', 'cat', 'mktemp'], cwd: () => fx.repo },
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
    const r = run(s.args(o), { cwd: s.cwd ? s.cwd() : undefined });
    let calls = 0;
    try { calls = Number(readFileSync(cnt, 'utf8').trim()); } catch { /* the tool was not called */ }
    assert.ok(!existsSync(`${cnt}.err`), `the shim's own command failed (${tool} call ${n}, k=${k}): ${existsSync(`${cnt}.err`) ? readFileSync(`${cnt}.err`, 'utf8') : ''}`);
    return { ...r, calls, changed: existsSync(`${cnt}.chg`) };
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
            } else {
              assert.equal(r.status, s.truth, `${label}: nothing was cut, and the verdict changed: ${r.all}`);
              assert.equal(r.out, baseOut, `${label}: nothing was cut, and the output changed`);
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
const UNMATCHED_FILES = ['.gitignore', '.gitleaksignore', '.nvmrc', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'README.md', 'package-lock.json', 'package.json', 'product.md', 'vitest.config.mts',
  'framework/guarantees.md', 'scripts/push-gate.gitleaks.toml', 'scripts/scan-exclusions.tsv'];
const UNMATCHED_DIRS = ['.claude/', 'docs/', 'tests/', 'legacy/', 'framework/adapters/', 'framework/lint-config/', 'framework/runtime/'];
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
    assert.ok(count('generated') > 0 && count('implementation') > 0 && count('basis') > 0, 'every class is in use');
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
    const sourceLike = unmatched.filter((p) => /(^|\/)src\//.test(p) || /^legacy\/spec-tools\/(lib|cli)\//.test(p) || /^(bin|scripts)\/.*\.(sh|mjs)$/.test(p) || /^\.github\//.test(p) || /^supabase\/migrations\//.test(p));
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
    assert.equal(cls('supabase/migrations/20260912120201_ddl_items.sql'), 'generated');
    assert.equal(cls('basis-paths.tsv'), 'basis');
    assert.equal(cls('docs/rules/process/common/development-flow.md'), 'basis');
    assert.equal(cls('tests/basis-paths/classify-paths.test.mjs'), 'basis');
    assert.equal(cls('product.md'), 'basis');
    assert.equal(cls('package.json'), 'basis');
  });
});
