/**
 * Tests of scripts/check-basis-record.sh (development-flow, 「基準の commit の記録」): the check of the order basis, then implementation, in
 * the commits of a pull request, against the record in the pull request body.
 *
 *   check-basis-record.sh --body F --head SHA --base SHA --repo O/R --pr N --list F
 *
 * It runs in the repository of the current directory, which holds the base tip, the head and the commits between them (nothing is
 * checked out, merged or run). The paths come from `classify-paths.sh` and the record from `check-review-record.sh --emit`, both the
 * siblings of the script, and the list is the base's (the one that is passed; a list in the head is only data).
 *
 * Output, one line each: `basis record: not needed (one kind of path)` / `basis record: matches (origin XXXXXXXX, basis XXXXXXXX)` (exit 0),
 * the findings and then `basis record: FAILED` (exit 1), `basis record: could not run (REASON)` (exit 2: never a verdict, never a finding).
 *
 * The rules (R1..R7 of the plan; X is the first 8 characters of a sha):
 *   no basis line in the record: the combined diff from the origin (the one merge base of base and head) to the head must not touch both
 *     basis and implementation paths; merge commits are allowed.
 *   with a record, F = basis-first (or basis), S = basis, P = the first-parent commits of head that the base does not hold:
 *     R2 every commit on P has one parent, and F, each basis-prev, S are on P;   R3 they are in strictly increasing order;
 *     R4 up to F no commit touches implementation, and at least one touches basis;   R5 from F to S no commit touches both;
 *     R6 S touches basis;   R7 after S no commit touches basis.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-basis-record.sh', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const s8 = (x) => x.slice(0, 8);
const MARK = 'SECRETMARK';
const NOT_NEEDED = 'basis record: not needed (one kind of path)';
const FAILED = 'basis record: FAILED';
const COULD_NOT = /^basis record: could not run \(.+\)$/;
const VERDICT = /^basis record: (not needed|matches|FAILED)/;
const matches = (origin, basis) => `basis record: matches (origin ${s8(origin)}, basis ${s8(basis)})`;

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const gitEnv = { ...cleanEnv, HOME: '/nonexistent-home', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

let scratch;
let seq = 0;
before(() => { scratch = mkdtempSync(path.join(tmpdir(), 'basis-record-')); });
after(() => { rmSync(scratch, { recursive: true, force: true }); });
const fresh = (name) => { const d = path.join(scratch, `${name}-${seq++}`); mkdirSync(d); return d; };
const uid = () => `${seq++}`;
const L = (...cols) => cols.join('\t');

// The list of these tests: scripts and src are implementation, gen is generated, everything else (docs, tests, ext, ...) is basis.
const LIST_LINES = [L('implementation', 'scripts/*.sh', 'r'), L('implementation', 'src/*', 'r'), L('generated', 'gen/*', 'r')];
let LISTFILE;
before(() => { LISTFILE = path.join(scratch, 'list.tsv'); writeFileSync(LISTFILE, `${LIST_LINES.join('\n')}\n`); });
const writeList = (text) => { const f = path.join(fresh('list'), 'list.tsv'); writeFileSync(f, text); return f; };

// ---- a temporary repository: main holds the base, `pr` holds the pull request ----------------------------------------------------
function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=tester', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function put(dir, rel, content) { const f = path.join(dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, content); }
/**
 * `mark` is put into every path name and every commit message (the output must never show a path or a message).
 * Commits are made on the current branch; B is a basis commit, I an implementation commit, M one that touches both, G a generated
 * path, E an empty commit. `cm` takes a map of path to content (null deletes, `{ mode }` changes the mode).
 */
function world({ mark = '' } = {}) {
  const d = fresh('repo');
  git(d, 'init', '-q', '-b', 'main');
  for (const p of [`docs/${mark}seed.md`, `src/${mark}seed.ts`, `scripts/${mark}a.sh`, `tests/${mark}a.test`]) put(d, p, `${p}\n`);
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', `${mark}seed`);
  const fork = git(d, 'rev-parse', 'HEAD');
  git(d, 'checkout', '-q', '-b', 'pr');
  const cm = (files = {}, { empty = false, stage = true } = {}) => {
    for (const [p, c] of Object.entries(files)) {
      if (c === null) rmSync(path.join(d, p), { force: true });
      else if (typeof c === 'object') chmodSync(path.join(d, p), c.mode);
      else put(d, p, c);
    }
    if (stage) git(d, 'add', '-A');
    git(d, 'commit', '-q', ...(empty ? ['--allow-empty'] : []), '-m', `${mark}c${uid()}`);
    return git(d, 'rev-parse', 'HEAD');
  };
  const f = (dir, ext) => `${dir}/${mark}f${uid()}.${ext}`;
  const w = {
    d, fork, mark, cm,
    B: () => cm({ [f('docs', 'md')]: `${uid()}\n` }),
    I: () => cm({ [f('src', 'ts')]: `${uid()}\n` }),
    G: () => cm({ [f('gen', 'txt')]: `${uid()}\n` }),
    M: () => cm({ [f('docs', 'md')]: `${uid()}\n`, [f('src', 'ts')]: `${uid()}\n` }),
    E: () => cm({}, { empty: true }),
    head: () => git(d, 'rev-parse', 'HEAD'),
    base: () => git(d, 'rev-parse', 'main'),
    /** runs `fn` on main (the base moves), then back on the pull request */
    onMain: (fn) => { git(d, 'checkout', '-q', 'main'); try { return fn(); } finally { git(d, 'checkout', '-q', 'pr'); } },
    /** runs `fn` on a new branch that starts at the fork point (another fetched branch), then back on the pull request */
    side: (name, fn) => { git(d, 'checkout', '-q', '-b', name, fork); try { return fn(); } finally { git(d, 'checkout', '-q', 'pr'); } },
    merge: (...names) => { git(d, 'merge', '-q', '--no-edit', ...names); return git(d, 'rev-parse', 'HEAD'); },
    /** a submodule gitlink (a path that no list line names is basis) */
    link: () => { git(d, 'update-index', '--add', '--cacheinfo', `160000,${'5'.repeat(40)},ext/${mark}sub`); return cm({}, { stage: false }); },
    /** a commit with no parent: the history of the pull request shares nothing with the base */
    orphan: () => {
      git(d, 'checkout', '-q', '--orphan', 'orph'); git(d, 'rm', '-rf', '-q', '.');
      put(d, `docs/${mark}o.md`, 'orphan\n'); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', `${mark}orphan`);
      const sha = git(d, 'rev-parse', 'HEAD'); git(d, 'checkout', '-q', 'pr'); return sha;
    },
  };
  return w;
}

// ---- the body and the run -----------------------------------------------------------------------------------------------------
const LINK = (id, { repo = 'o/r', pr = '7' } = {}) => `https://github.com/${repo}/pull/${pr}#issuecomment-${id}`;
/** The body of a pull request. `rec` (when there is one) is { first, prev, basis, bo, bc, uo, uc, opus, codex }; the review lines name `head` unless told otherwise. */
function bodyOf(head, rec, mark = '') {
  let s = `## Summary\n\n${mark}something\n\n`;
  if (rec) s += `## Basis moves\n\n${mark}why the record moved\n\n`;
  s += `## Review\n- opus: ${rec?.opus ?? head}\n- codex: ${rec?.codex ?? head}\n`;
  if (rec) {
    const b = rec.basis;
    if (rec.first) s += `- basis-first: ${rec.first}\n`;
    for (const p of rec.prev ?? []) s += `- basis-prev: ${p}\n`;
    s += `- basis: ${b}\n- basis-opus: ${rec.bo ?? b} ${rec.uo ?? LINK(101)}\n- basis-codex: ${rec.bc ?? b} ${rec.uc ?? LINK(102)}\n`;
  }
  return s;
}
/** The usual arguments, as a list of [option, value] pairs. */
const usual = (f, head, base, over = {}) => [['--body', f], ['--head', head], ['--base', base], ['--repo', over.repo ?? 'o/r'], ['--pr', over.pr ?? '7'], ['--list', over.list ?? LISTFILE]];

/** Runs the script in the repository of `w` (or in `cwd`). `rec` is the record (none: a body without basis lines); `args` replaces the argument list (a function of the body file). */
function run(w, { rec, body, head = w.head(), base = w.base(), repo, pr, list, args, cwd = w.d, env = {}, bin } = {}) {
  const f = path.join(fresh('body'), 'body');
  writeFileSync(f, body ?? bodyOf(head, rec, w.mark));
  const a = args ? args(f) : usual(f, head, base, { repo, pr, list }).flat();
  const r = spawnSync('/bin/sh', [script, ...a], { cwd, encoding: 'utf8', env: { ...cleanEnv, ...(bin ? { PATH: bin } : {}), ...env } });
  const all = r.stdout + r.stderr;
  return { status: r.status, out: r.stdout, err: r.stderr, all, lines: all.split('\n').filter((x) => x !== '') };
}
function green(r, line) {
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(r.lines, [line], r.all);
}
/** A verdict of 1: every message is a line `basis record: <message>`, and the last line is FAILED. */
function red(r, ...messages) {
  assert.equal(r.status, 1, r.all);
  assert.equal(r.lines.at(-1), FAILED, r.all);
  for (const m of messages) assert.ok(r.lines.includes(`basis record: ${m}`), `should say "${m}": ${r.all}`);
  assert.ok(!r.lines.some((l) => /^basis record: (matches|not needed)/.test(l)), r.all);
  assert.ok(r.lines.every((l) => l.startsWith('basis record: ')), `a line that is not a finding: ${r.all}`);
}
function couldNotRun(r, secrets = []) {
  assert.equal(r.status, 2, r.all);
  assert.ok(r.lines.some((l) => COULD_NOT.test(l)), `no fixed message: ${r.all}`);
  assert.ok(!r.lines.some((l) => VERDICT.test(l)), `a verdict was printed: ${r.all}`);
  assert.ok(r.lines.filter((l) => l.startsWith('basis record: ')).every((l) => COULD_NOT.test(l)), `a finding was printed with exit 2: ${r.all}`);
  for (const s of secrets) assert.ok(!r.all.includes(s), `echoed ${s}: ${r.all}`);
}

const NOT_ON_PATH = (sha) => `${s8(sha)} is not a commit of this pull request`;
const ORDER = 'the recorded commits are not in order on the path';

// ---- 1 no record: the combined diff --------------------------------------------------------------------------------------------
describe('check-basis-record.sh: no basis line in the record (the combined diff from the origin)', () => {
  it('one kind of path is not needed: implementation only, basis only, generated only, and mixes with generated', () => {
    const shapes = {
      'implementation only': (w) => { w.I(); },
      'basis only': (w) => { w.B(); },
      'generated only': (w) => { w.G(); },
      'basis and generated': (w) => { w.B(); w.G(); },
      'implementation and generated': (w) => { w.I(); w.G(); w.I(); },
      'many commits of one kind': (w) => { w.I(); w.I(); w.G(); w.I(); },
      'no commit at all (the head is the base)': () => {},
      'an empty commit': (w) => { w.E(); },
    };
    for (const [name, make] of Object.entries(shapes)) {
      const w = world(); make(w);
      const r = run(w);
      assert.equal(r.status, 0, `${name}: ${r.all}`);
      assert.deepEqual(r.lines, [NOT_NEEDED], name);
    }
  });

  it('the diff is the combined one: a basis file added and removed again, with implementation, is net implementation only', () => {
    const w = world();
    w.cm({ 'docs/tmp.md': 'x\n' }); w.I(); w.cm({ 'docs/tmp.md': null });
    green(run(w), NOT_NEEDED);
  });

  it('a merge of the base into the pull request is allowed, and what the base brought is not the pull request\'s change', () => {
    const w = world();
    w.onMain(() => w.B());
    w.I();
    w.merge('main');
    green(run(w), NOT_NEEDED);
    w.onMain(() => w.B()); // and the base moves again, past the merge
    green(run(w, { base: w.base() }), NOT_NEEDED);
  });

  it('the base that moved after the fork does not count: its changes are not the pull request\'s (the origin is the merge base, not the base tip)', () => {
    const w = world();
    w.onMain(() => w.I());
    w.B();
    green(run(w), NOT_NEEDED);
    const v = world();
    v.onMain(() => v.B());
    v.I();
    green(run(v), NOT_NEEDED);
  });

  it('basis and implementation in separate commits, or in one commit, is red: record the basis', () => {
    const shapes = {
      'separate commits': (w) => { w.B(); w.I(); },
      'implementation first': (w) => { w.I(); w.B(); },
      'one commit': (w) => { w.M(); },
      'with generated paths': (w) => { w.B(); w.G(); w.I(); },
      'a test and a script': (w) => { w.cm({ 'tests/x.test': 'x\n' }); w.cm({ 'scripts/x.sh': 'x\n' }); },
    };
    for (const [name, make] of Object.entries(shapes)) {
      const w = world(); make(w);
      const r = run(w);
      assert.equal(r.status, 1, `${name}: ${r.all}`);
      red(r, 'record the basis');
    }
  });

  it('a mix across a merge is red as well, and a basis edit that is only in the merge counts', () => {
    const w = world();
    w.side('x1', () => w.B());
    w.I();
    w.merge('x1');
    red(run(w), 'record the basis');
  });

  it('uses the list that is passed: this repository\'s own list sorts tests as basis and scripts as implementation', () => {
    const real = path.join(repoRoot, 'basis-paths.tsv');
    const w = world();
    w.cm({ 'tests/x.test.mjs': 'x\n' }); w.cm({ 'scripts/x.sh': 'x\n' });
    red(run(w, { list: real }), 'record the basis');
    green(run(w, { list: writeList('implementation\t*\tall of it is implementation\n') }), NOT_NEEDED);
  });
});

// ---- 2 with a record ----------------------------------------------------------------------------------------------------------
describe('check-basis-record.sh: with a record, the shapes that pass', () => {
  it('the basis commit, then the implementation: matches, with the origin and the basis in the line', () => {
    const w = world();
    const b = w.B(); w.I(); w.I();
    green(run(w, { rec: { basis: b } }), matches(w.fork, b));
  });

  it('only basis commits, the record naming the last one (it is the head)', () => {
    const w = world();
    w.B(); const b = w.B();
    green(run(w, { rec: { basis: b } }), matches(w.fork, b));
  });

  it('basis-first and basis: implementation between them is allowed when it does not touch basis, and the basis commit is the head', () => {
    const w = world();
    w.B(); const first = w.B(); w.I(); const b = w.B();
    green(run(w, { rec: { first, basis: b } }), matches(w.fork, b));
  });

  it('the shape of a real pull request (basis commits, then implementation and basis fixes in turn, ending with a fix): with and without basis-prev', () => {
    const w = world();
    w.B(); w.B(); const first = w.B();
    w.I(); const fix1 = w.B(); w.I(); w.I(); const fix2 = w.B(); w.I(); w.I(); const last = w.B();
    for (const rec of [{ first, basis: last }, { first, prev: [fix1, fix2], basis: last }, { first, prev: [fix1], basis: last }, { first, prev: [fix2], basis: last }]) {
      green(run(w, { rec }), matches(w.fork, last));
    }
    // the same history with implementation after the last basis fix
    w.I(); w.I();
    green(run(w, { rec: { first, prev: [fix1, fix2], basis: last } }), matches(w.fork, last));
  });

  it('after the basis commit: implementation, generated paths, an empty commit, and a rename inside implementation are all allowed', () => {
    const w = world();
    const b = w.B();
    w.I(); w.G(); w.E(); w.cm({ 'gen/x.txt': 'x\n', 'src/y.ts': 'y\n' });
    w.cm({ 'scripts/a.sh': null, 'scripts/b.sh': 'renamed\n' });
    green(run(w, { rec: { basis: b } }), matches(w.fork, b));
  });

  it('the base moved after the fork: matches, and the origin is the fork point', () => {
    const w = world();
    const b = w.B(); w.I();
    const moved = w.onMain(() => { w.B(); return w.I(); });
    assert.notEqual(w.base(), w.fork);
    green(run(w, { rec: { basis: b }, base: moved }), matches(w.fork, b));
  });

  it('a stale review line is red even when the basis record is right', () => {
    const w = world();
    const b = w.B(); w.I();
    red(run(w, { rec: { basis: b, opus: 'b'.repeat(40) } }), 'the review record does not pass (see the review step)');
  });
});

// ---- 3 with a record, the findings -------------------------------------------------------------------------------------------
describe('check-basis-record.sh: with a record, the findings', () => {
  it('a commit that changes basis and implementation between the first record and basis (the shape of a list edit with the script): red', () => {
    const w = world();
    const first = w.B();
    const mixed = w.cm({ 'src/x.ts': 'x\n', 'basis-paths.tsv': 'basis\tx\ty\n' });
    const b = w.B();
    red(run(w, { rec: { first, basis: b } }), `commit ${s8(mixed)} between the first record and basis changes basis and implementation paths`);
  });

  it('the basis commit itself changing both is also in that range', () => {
    const w = world();
    const first = w.B(); w.I();
    const b = w.M();
    red(run(w, { rec: { first, basis: b } }), `commit ${s8(b)} between the first record and basis changes basis and implementation paths`);
  });

  it('a commit that is not on the path of the pull request is not accepted for any of the three records', () => {
    const w = world();
    const b1 = w.B(); const b2 = w.B(); w.I();
    const other = w.side('other', () => w.B());
    const dev = w.onMain(() => w.B());
    const unknown = 'c'.repeat(40);
    const elsewhere = { 'a commit of another fetched branch': other, 'a commit of the base': dev, 'the fork point': w.fork, 'a sha that is no object': unknown };
    for (const [what, x] of Object.entries(elsewhere)) {
      red(run(w, { rec: { basis: x }, base: dev }), NOT_ON_PATH(x));
      red(run(w, { rec: { first: x, basis: b2 }, base: dev }), NOT_ON_PATH(x));
      red(run(w, { rec: { first: b1, prev: [x], basis: b2 }, base: dev }), NOT_ON_PATH(x));
      assert.ok(what);
    }
  });

  it('a head that was rebuilt (a force push): the record names commits that are not on the new path', () => {
    const w = world();
    const oldFirst = w.B(); const oldBasis = w.B(); w.I();
    git(w.d, 'reset', '-q', '--hard', w.fork);
    w.B(); w.B(); w.I();
    red(run(w, { rec: { basis: oldBasis } }), NOT_ON_PATH(oldBasis));
    red(run(w, { rec: { first: oldFirst, basis: w.head() } }), NOT_ON_PATH(oldFirst));
  });

  it('the records that are not in strict order on the path: out of order, first after basis, equal, repeated', () => {
    const w = world();
    const c = [w.B(), w.B(), w.B(), w.B()];
    const cases = {
      'previous records out of order': { first: c[0], prev: [c[2], c[1]], basis: c[3] },
      'a previous record before the first': { first: c[1], prev: [c[0]], basis: c[3] },
      'a previous record after basis': { first: c[0], prev: [c[3]], basis: c[2] },
      'first equal to basis': { first: c[1], basis: c[1] },
      'first after basis': { first: c[2], basis: c[1] },
      'a previous record equal to first': { first: c[0], prev: [c[0]], basis: c[3] },
      'a previous record equal to basis': { first: c[0], prev: [c[3]], basis: c[3] },
      'a previous record repeated': { first: c[0], prev: [c[1], c[1]], basis: c[3] },
    };
    for (const [name, rec] of Object.entries(cases)) {
      const r = run(w, { rec });
      assert.equal(r.status, 1, `${name}: ${r.all}`);
      red(r, ORDER);
    }
  });

  it('a merge commit on the path, a plain merge and an octopus one, is red whatever the record', () => {
    const w = world();
    const b = w.B();
    w.onMain(() => w.B());
    const m = w.merge('main');
    w.I();
    red(run(w, { rec: { basis: b } }), `merge commit ${s8(m)} is on the path (rebuild on the new base and record again)`);
    const v = world();
    const vb = v.B();
    v.side('x1', () => v.B()); v.side('x2', () => v.B());
    const octo = v.merge('x1', 'x2');
    v.I();
    red(run(v, { rec: { basis: vb } }), `merge commit ${s8(octo)} is on the path (rebuild on the new base and record again)`);
    // a merge as the head, with a record that names a commit before it
    const u = world();
    const ub = u.B(); u.I();
    u.side('x1', () => u.B());
    const um = u.merge('x1');
    red(run(u, { rec: { basis: ub } }), `merge commit ${s8(um)} is on the path (rebuild on the new base and record again)`);
  });

  it('a merge commit before the first record, or between the first record and basis, is red as well', () => {
    const w = world();
    const b1 = w.B();
    w.onMain(() => w.B());
    const m = w.merge('main');
    const b2 = w.B();
    w.I();
    const msg = (x) => `merge commit ${s8(x)} is on the path (rebuild on the new base and record again)`;
    red(run(w, { rec: { basis: b2 } }), msg(m));
    red(run(w, { rec: { first: b1, basis: b2 } }), msg(m));
    const v = world();
    const first = v.B();
    v.onMain(() => v.B());
    const vm = v.merge('main');
    const vb = v.B();
    red(run(v, { rec: { first, basis: vb } }), msg(vm));
  });

  it('a history that holds several merge bases (the base and the pull request merged each other) is red in both modes', () => {
    const w = world();
    w.I();
    const b1 = w.onMain(() => { const x = w.B(); w.merge('pr'); return x; });
    const m = w.merge(b1);
    const several = 'the pull request has several merge bases with the base (rebuild on the base)';
    red(run(w), several);
    red(run(w, { rec: { basis: m } }), `merge commit ${s8(m)} is on the path (rebuild on the new base and record again)`);
  });

  it('an implementation commit before the first record (or before basis, with no first): red', () => {
    const w = world();
    const impl = w.I(); const b = w.B();
    red(run(w, { rec: { basis: b } }), `commit ${s8(impl)} up to the first record changes implementation path(s)`);
    const v = world();
    const mixed = v.M(); const first = v.B(); v.I(); const vb = v.B();
    red(run(v, { rec: { first, basis: vb } }), `commit ${s8(mixed)} up to the first record changes implementation path(s)`);
    const u = world();
    u.B(); const g = u.cm({ 'src/g.ts': 'x\n', 'gen/g.txt': 'x\n' }); const ub = u.B();
    red(run(u, { rec: { basis: ub } }), `commit ${s8(g)} up to the first record changes implementation path(s)`);
  });

  it('an empty commit is not a record: as the first record, and as basis', () => {
    const w = world();
    const e = w.E(); w.I(); const b = w.B();
    red(run(w, { rec: { first: e, basis: b } }), 'the first record changes no basis path');
    // the commit named as the first record must itself change a basis path: an earlier commit that did does not make up for it
    const t = world();
    t.B(); const te = t.E(); t.I(); const tb = t.B();
    red(run(t, { rec: { first: te, basis: tb } }), 'the first record changes no basis path');
    const g = world();
    g.B(); const gg = g.G(); g.I(); const gb = g.B();
    red(run(g, { rec: { first: gg, basis: gb } }), 'the first record changes no basis path');
    const v = world();
    v.B(); const ve = v.E();
    red(run(v, { rec: { basis: ve } }), `basis ${s8(ve)} changes no basis path`);
    const u = world();
    const uf = u.B(); u.I(); const ue = u.E();
    red(run(u, { rec: { first: uf, basis: ue } }), `basis ${s8(ue)} changes no basis path`);
  });

  it('after basis, any change to a basis path is red: a test edit, a chmod, a rename out of a test, a gitlink, a delete, a mix', () => {
    const edits = {
      'a test edited': (w) => w.cm({ 'tests/a.test': 'changed\n' }),
      'a test chmod': (w) => w.cm({ 'tests/a.test': { mode: 0o755 } }),
      'a rename from tests/ to scripts/': (w) => w.cm({ 'tests/a.test': null, 'scripts/x.sh': 'moved\n' }),
      'a submodule gitlink': (w) => w.link(),
      'a basis file deleted': (w) => w.cm({ 'docs/seed.md': null }),
      'a new basis file': (w) => w.B(),
      'a basis file with an implementation file': (w) => w.M(),
    };
    for (const [name, edit] of Object.entries(edits)) {
      const w = world();
      const b = w.B(); w.I();
      const x = edit(w);
      const r = run(w, { rec: { basis: b } });
      assert.equal(r.status, 1, `${name}: ${r.all}`);
      red(r, `commit ${s8(x)} after basis changes basis path(s)`);
    }
  });

  it('after basis, a rename from implementation to a basis path is red (the delete counts, and the add is basis)', () => {
    const w = world();
    const b = w.B();
    const x = w.cm({ 'scripts/a.sh': null, 'docs/moved.md': 'moved\n' });
    red(run(w, { rec: { basis: b } }), `commit ${s8(x)} after basis changes basis path(s)`);
  });

  it('the list that decides is the one that is passed: a head that reclassifies tests as implementation does not help', () => {
    const w = world();
    const b = w.cm({ 'basis-paths.tsv': 'implementation\ttests/*\tthe head says so\n', 'docs/x.md': 'x\n' });
    w.I();
    const t = w.cm({ 'tests/a.test': 'edited after basis\n' });
    red(run(w, { rec: { basis: b } }), `commit ${s8(t)} after basis changes basis path(s)`);
    // with the head's own list, the same history would pass: the test is about which list is read
    green(run(w, { rec: { basis: b }, list: writeList(`implementation\ttests/*\tthe head says so\n${LIST_LINES.join('\n')}\n`) }), matches(w.fork, b));
  });

  it('a history that shares nothing with the base is red, with a record and without', () => {
    const w = world();
    const o = w.orphan();
    red(run(w, { head: o }), 'the pull request shares no history with the base');
    red(run(w, { head: o, rec: { basis: o } }), 'the pull request shares no history with the base');
  });

  it('the two answers: the sha of each must be basis, and the links must be comments of this pull request, two different ones', () => {
    const w = world();
    const b = w.B(); const i = w.I();
    red(run(w, { rec: { basis: b, bo: i } }), `basis-opus names ${s8(i)}, basis is ${s8(b)}`);
    red(run(w, { rec: { basis: b, bc: i } }), `basis-codex names ${s8(i)}, basis is ${s8(b)}`);
    red(run(w, { rec: { basis: b, bo: 'd'.repeat(40) } }), `basis-opus names dddddddd, basis is ${s8(b)}`);
    for (const [name, over] of Object.entries({ 'another repository': { repo: 'x/y' }, 'another pull request': { pr: '8' } })) {
      red(run(w, { rec: { basis: b, uo: LINK(101, over) } }), 'the basis-opus link is not a comment of this pull request');
      red(run(w, { rec: { basis: b, uc: LINK(102, over) } }), 'the basis-codex link is not a comment of this pull request');
      assert.ok(name);
    }
    red(run(w, { rec: { basis: b }, repo: 'x/y' }), 'the basis-opus link is not a comment of this pull request', 'the basis-codex link is not a comment of this pull request');
    red(run(w, { rec: { basis: b }, pr: '8' }), 'the basis-opus link is not a comment of this pull request', 'the basis-codex link is not a comment of this pull request');
    red(run(w, { rec: { basis: b, uc: LINK(101) } }), 'basis-opus and basis-codex point to the same comment');
    green(run(w, { rec: { basis: b, uo: LINK(2), uc: LINK(1) } }), matches(w.fork, b));
  });

  it('a review record that does not pass: stale, missing or malformed, the finding names the review step', () => {
    const w = world();
    const b = w.B(); const i = w.I();
    const msg = 'the review record does not pass (see the review step)';
    red(run(w, { rec: { basis: b, codex: b } }), msg);
    red(run(w, { body: 'no record at all\n' }), msg);
    red(run(w, { body: `${bodyOf(i, { basis: b })}- basis: ${b}\n` }), msg);
    red(run(w, { body: bodyOf(i, undefined).replace(`- codex: ${i}`, `- codex: ${b}`) }), msg);
    red(run(w, { body: `<div>\n${bodyOf(i)}` }), msg);
    red(run(w, { body: `${bodyOf(i, { basis: b })}- basis-prev: ${b}\n` }), msg);
  });
});

// ---- 4 the script could not do its work ----------------------------------------------------------------------------------------
describe('check-basis-record.sh: what could not be done is exit 2, never a verdict', () => {
  it('a list that is missing, unreadable, a directory or malformed', () => {
    const w = world();
    w.B();
    for (const list of ['/nonexistent/list.tsv', path.dirname(LISTFILE), writeList('no tabs here\n'), writeList(`${L('basis', 'x/*', 'r')}`), writeList(`${L('nonsense', 'x/*', 'r')}\n`)]) {
      couldNotRun(run(w, { list }));
      couldNotRun(run(w, { list, rec: { basis: w.head() } }));
    }
  });

  it('a head or a base that is not a commit of this repository: unknown, a tree, a blob', () => {
    const w = world();
    const b = w.B();
    const tree = git(w.d, 'rev-parse', 'HEAD^{tree}');
    const blob = git(w.d, 'rev-parse', 'HEAD:docs/seed.md');
    for (const x of ['e'.repeat(40), tree, blob]) {
      couldNotRun(run(w, { head: x, rec: { basis: b } }));
      couldNotRun(run(w, { head: x }));
      couldNotRun(run(w, { base: x }));
    }
  });

  it('a shallow repository cannot give a merge base: exit 2', () => {
    const w = world();
    const b = w.B(); w.I();
    const dst = path.join(fresh('clone'), 'c');
    git(w.d, 'clone', '-q', '--depth', '1', `file://${w.d}`, dst);
    assert.equal(git(dst, 'rev-parse', '--is-shallow-repository'), 'true');
    const head = git(dst, 'rev-parse', 'HEAD');
    couldNotRun(run(w, { cwd: dst, head, base: head, rec: { basis: b } }));
    couldNotRun(run(w, { cwd: dst, head, base: head }));
  });

  it('a directory that is not a repository is exit 2', () => {
    const w = world();
    w.B();
    couldNotRun(run(w, { cwd: fresh('plain') }));
  });

  it('a wrong use of the arguments is exit 2: missing, doubled, unknown, malformed', () => {
    const w = world();
    const b = w.B(); const i = w.I();
    const base = w.base();
    const f = path.join(fresh('body'), 'body'); writeFileSync(f, bodyOf(i, { basis: b }));
    const pairs = usual(f, i, base);
    const flat = (ps) => ps.flat();
    const uses = {
      'no arguments': [],
      'a lone word': ['x'],
      'an unknown option': [...flat(pairs), '--verbose'],
      'an unknown option with a value': [...flat(pairs), '--extra', 'x'],
      'a positional argument': [...flat(pairs), 'x'],
      'an option without its value (the last)': [...flat(pairs.slice(0, -1)), '--list'],
      'a head that is short': flat(usual(f, i.slice(0, 39), base)),
      'a head in capitals': flat(usual(f, i.toUpperCase().replace(/[0-9]/g, 'A'), base)),
      'a head that is not hexadecimal': flat(usual(f, `${i.slice(0, 39)}g`, base)),
      'a head that is a name': flat(usual(f, 'pr', base)),
      'a base that is a name': flat(usual(f, i, 'main')),
      'a base that is short': flat(usual(f, i, base.slice(0, 12))),
      'a pull request number that is a word': flat(usual(f, i, base, { pr: 'abc' })),
      'a pull request number that is empty': flat(usual(f, i, base, { pr: '' })),
      'a pull request number with a sign': flat(usual(f, i, base, { pr: '-7' })),
      'a repository without a slash': flat(usual(f, i, base, { repo: 'nothing' })),
      'a repository with two slashes': flat(usual(f, i, base, { repo: 'a/b/c' })),
      'a repository with no owner': flat(usual(f, i, base, { repo: '/b' })),
      'a repository with no name': flat(usual(f, i, base, { repo: 'a/' })),
      'a body that is missing': flat(usual('/nonexistent/body', i, base)),
      'a body that is a directory': flat(usual(path.dirname(f), i, base)),
    };
    for (const [opt] of pairs) {
      uses[`${opt} missing`] = flat(pairs.filter(([o]) => o !== opt));
      uses[`${opt} given twice`] = [...flat(pairs), opt, pairs.find(([o]) => o === opt)[1]];
    }
    for (const [name, a] of Object.entries(uses)) {
      const r = run(w, { args: () => a });
      assert.equal(r.status, 2, `${name}: ${r.all}`);
      assert.ok(r.lines.some((l) => COULD_NOT.test(l)), `${name}: ${r.all}`);
      assert.ok(!r.lines.some((l) => VERDICT.test(l)), `${name}: ${r.all}`);
    }
    green(run(w, { args: () => flat(pairs) }), matches(w.fork, b));
  });
});

// ---- 5 what is never printed, and what is never left or changed --------------------------------------------------------------------
describe('check-basis-record.sh: nothing of the repository is printed, left behind or changed', () => {
  it('a marker string in every path name, commit message and the body is never printed, in any verdict', () => {
    const outs = [];
    const w = world({ mark: MARK });
    w.onMain(() => w.B());
    const b = w.B(); const first = w.B(); w.I();
    const mixed = w.cm({ [`docs/${MARK}m.md`]: 'x\n', [`src/${MARK}m.ts`]: 'x\n' });
    const t = w.cm({ [`tests/${MARK}a.test`]: 'edited\n' });
    outs.push(run(w, { rec: { basis: b } }));
    outs.push(run(w, { rec: { first, basis: b } }));
    outs.push(run(w));
    outs.push(run(w, { rec: { basis: t } }));
    outs.push(run(w, { rec: { basis: first } }));
    outs.push(run(w, { list: '/nonexistent/list.tsv' }));
    outs.push(run(w, { head: 'e'.repeat(40) }));
    const v = world({ mark: MARK }); v.I();
    outs.push(run(v));
    const u = world({ mark: MARK }); const ub = u.B(); u.I();
    outs.push(run(u, { rec: { basis: ub } }));
    const verdicts = new Set(outs.map((r) => r.status));
    assert.deepEqual([...verdicts].sort(), [0, 1, 2], 'the sample holds each kind of exit');
    assert.ok(mixed);
    for (const r of outs) assert.ok(!r.all.includes(MARK), `a marker was printed: ${r.all}`);
  });

  it('the temporary directory is empty after every kind of exit', () => {
    const w = world();
    const b = w.B(); w.I();
    for (const [what, opts, status] of [['matches', { rec: { basis: b } }, 0], ['not needed', { rec: undefined, head: b, base: w.fork }, 0], ['red', { rec: { basis: w.fork } }, 1], ['could not run', { list: '/nonexistent/list.tsv' }, 2]]) {
      const tmp = fresh('tmp');
      const r = run(w, { ...opts, env: { TMPDIR: tmp } });
      assert.equal(r.status, status, `${what}: ${r.all}`);
      assert.deepEqual(readdirSync(tmp), [], `${what}: files left in the temporary directory`);
    }
  });

  it('the repository is not changed: no checkout, no new ref, no change of the index or the work tree', () => {
    const w = world();
    const b = w.B(); const i = w.I();
    w.onMain(() => w.B());
    const snap = () => [git(w.d, 'rev-parse', 'HEAD'), git(w.d, 'symbolic-ref', 'HEAD'), git(w.d, 'for-each-ref'), git(w.d, 'status', '--porcelain=v2'), git(w.d, 'stash', 'list'),
      readdirSync(path.join(w.d, '.git')).sort().join(','), git(w.d, 'ls-files', '-s')].join('\n--\n');
    const before = snap();
    for (const opts of [{ rec: { basis: b } }, {}, { rec: { basis: i } }, { head: 'e'.repeat(40) }]) run(w, opts);
    assert.equal(snap(), before);
  });

  it('an environment that points elsewhere changes nothing: GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE of the caller are not used', () => {
    const w = world();
    const b = w.B(); w.I();
    const decoy = world();
    const r = run(w, { rec: { basis: b }, env: { GIT_DIR: path.join(decoy.d, '.git'), GIT_WORK_TREE: decoy.d, GIT_INDEX_FILE: path.join(decoy.d, 'no-index') } });
    green(r, matches(w.fork, b));
  });
});

// ---- 6 the class: a tool that fails, is missing or hands on a cut-short output is exit 2 -----------------------------------------
// The script runs git (through env, in a clean environment) and its siblings (through sh), with mktemp, rm, cat, cmp and wc. A private
// PATH holds only the tools the script and its siblings may call, so that a tool can be left out, made to fail, or made to hand on its
// standard output without its last k lines (k = 1, 2 and all) with status 0. For each tool and each call of it, counted per scenario:
// a call whose output really changed must end in exit 2 (a fixed message, never a verdict); a call that printed nothing is not cut,
// and the run is the untouched one. The two siblings are swept as `classify` and `review` (the calls of `sh` that run them).
// The runs are independent, so they go out a few at a time.
const SYSTEM = ['/usr/bin', '/bin', '/usr/local/bin'];
const which = (name) => SYSTEM.map((d) => path.join(d, name)).find((p) => spawnSync('/bin/sh', ['-c', `test -x ${p}`]).status === 0) ?? null;
const TOOLS = ['git', 'env', 'mktemp', 'rm', 'mv', 'tr', 'wc', 'cat', 'cmp', 'sh', 'awk', 'sed', 'sort'];
function makeBin(root, { omit = [], shim = {} } = {}) {
  const bin = path.join(root, `bin-${seq++}`);
  mkdirSync(bin);
  for (const n of TOOLS) {
    if (omit.includes(n)) continue;
    if (shim[n] !== undefined) { writeFileSync(path.join(bin, n), `#!/bin/sh\n${shim[n]}\n`); chmodSync(path.join(bin, n), 0o755); }
    else symlinkSync(which(n), path.join(bin, n));
  }
  return bin;
}
const exec = (cmd, args, opts) => new Promise((resolve) => {
  const c = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; let e = '';
  c.stdout.on('data', (x) => { o += x; }); c.stderr.on('data', (x) => { e += x; });
  c.on('close', (status) => resolve({ status, all: o + e, lines: (o + e).split('\n').filter((x) => x !== '') }));
});
async function pool(tasks, width = 4) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next; next += 1; results[i] = await tasks[i](); }
  }));
  return results;
}

describe('check-basis-record.sh: a tool that fails, is missing or hands on a cut-short output is exit 2, whatever the tool and whichever call', () => {
  let root;
  // the scenarios are named here (the tests are defined before the repositories are made) and built in `before`
  const scenarios = [
    { name: 'no record, one kind of path', truth: 0, make: (w) => { w.I(); w.I(); } },
    { name: 'no record, basis and implementation', truth: 1, make: (w) => { w.B(); w.I(); } },
    { name: 'no record, several merge bases', truth: 1, make: (w) => { w.I(); const b1 = w.onMain(() => w.B()); w.onMain(() => w.merge('pr')); w.merge(b1); } },
    { name: 'a record that matches', truth: 0, make: (w) => { const b = w.B(); w.I(); return { basis: b }; }, record: true },
    { name: 'a record, a commit that changes both', truth: 1, make: (w) => { const first = w.B(); w.M(); const b = w.B(); return { first, basis: b }; }, record: true },
  ];
  const SWEPT = ['git', 'env', 'mktemp', 'cat', 'wc', 'tr', 'awk', 'sed', 'sort', 'classify', 'review'];
  const SILENT = ['rm', 'cmp', 'mv']; // they print nothing: a cut cannot change them; they are swept as missing and failing
  const counter = { n: 0 };
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'basis-record-sweep-'));
    mkdirSync(path.join(root, 'tmp'));
    for (const sc of scenarios) {
      sc.w = world();
      const made = sc.make(sc.w);
      sc.head = sc.w.head();
      sc.rec = sc.record ? made : undefined;
    }
  });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  const shimText = (tool, virt, n, k, cnt) => {
    const real = which(tool);
    const cut = k === 'all' ? ': > "$U"' : `${which('head')} -n -${k} "$T" > "$U"`;
    const only = virt ? `case "$1" in */${virt === 'classify' ? 'classify-paths' : 'check-review-record'}.sh) ;; *) exec ${real} "$@" ;; esac\n` : '';
    // every command of the shim is checked: a failure of the test's own I/O goes to `.err` and fails the test; the mark that the output changed is written last
    return `bad() { echo "$1" >> ${cnt}.err; exit 3; }\n${only}c=0\nif [ -f ${cnt} ]; then read c < ${cnt} || bad count-read; fi\nc=$((c+1))\necho $c > ${cnt} || bad count-write\n`
      + `if [ "$c" = ${n} ]; then\n  T=$(${which('mktemp')}) || bad mktemp\n  U=$(${which('mktemp')}) || bad mktemp\n  rc0=0; ${real} "$@" > "$T" || rc0=$?\n  ${cut} || bad cut\n`
      + `  rc=0; ${which('cmp')} -s "$T" "$U" || rc=$?\n  case $rc in 0 | 1) ;; *) bad cmp ;; esac\n  if [ ! -s "$T" ]; then echo "$*" >> ${cnt}.empty || bad mark-empty; fi\n`
      + `  ${which('cat')} "$U" || bad hand-on\n  ${which('rm')} -f "$T" "$U" || bad rm\n  if [ "$rc" = 1 ]; then echo changed > ${cnt}.chg || bad mark; fi\n  exit $rc0\nfi\nexec ${real} "$@"`;
  };
  /** One run of scenario `sc` with the tool `tool` (or the sibling `virt` run by sh) shimmed: its call number n loses its last k lines (n = 0: only counted). */
  const runCut = async (sc, tool, virt, n, k) => {
    counter.n += 1;
    const cnt = path.join(root, `cnt-${counter.n}`);
    const bin = makeBin(root, { shim: { [tool]: shimText(tool, virt, n, k, cnt) } });
    const r = await exec('/bin/sh', [script, ...usual(path.join(root, `body-${sc.name}`), sc.head, sc.w.base()).flat()], { cwd: sc.w.d, env: { ...cleanEnv, PATH: bin, TMPDIR: path.join(root, 'tmp') } });
    const read = (suffix) => (existsSync(`${cnt}${suffix}`) ? readFileSync(`${cnt}${suffix}`, 'utf8') : '');
    assert.equal(read('.err'), '', `the shim's own command failed (${tool}${virt ? `:${virt}` : ''} call ${n}, k=${k}): ${read('.err')}`);
    return { ...r, calls: Number(read('').trim() || 0), changed: existsSync(`${cnt}.chg`), empty: read('.empty').split('\n').filter((x) => x !== '') };
  };
  const runFail = async (sc, omit, shim) => {
    const bin = makeBin(root, { omit, shim });
    return exec('/bin/sh', [script, ...usual(path.join(root, `body-${sc.name}`), sc.head, sc.w.base()).flat()], { cwd: sc.w.d, env: { ...cleanEnv, PATH: bin, TMPDIR: path.join(root, 'tmp') } });
  };
  const realTool = (t) => (t === 'classify' || t === 'review' ? 'sh' : t);
  const stops = (r, why) => {
    assert.equal(r.status, 2, `${why}: ${r.all}`);
    assert.ok(r.lines.some((l) => COULD_NOT.test(l)), `${why}: no fixed message: ${r.all}`);
    assert.ok(!r.lines.some((l) => VERDICT.test(l)), `${why}: a verdict was printed: ${r.all}`);
    assert.ok(r.lines.filter((l) => l.startsWith('basis record: ')).every((l) => COULD_NOT.test(l)), `${why}: a finding was printed with exit 2: ${r.all}`);
  };

  const prepare = (sc) => {
    writeFileSync(path.join(root, `body-${sc.name}`), bodyOf(sc.head, sc.rec, ''));
  };
  it('(guard) the private PATH itself works: every scenario gives its own verdict', async () => {
    for (const sc of scenarios) {
      prepare(sc);
      const r = await runFail(sc, [], {});
      assert.equal(r.status, sc.truth, `${sc.name}: ${r.all}`);
      assert.ok(r.lines.length >= 1 && r.lines.every((l) => l.startsWith('basis record: ')), `${sc.name}: ${r.all}`);
    }
  });

  let runs = 0;
  const cutCalls = Object.fromEntries(SWEPT.map((t) => [t, new Set()]));
  const allCalls = Object.fromEntries(SWEPT.map((t) => [t, new Map()])); // key -> the arguments of the runs in which the call printed nothing
  const started = Date.now();
  for (const sc of scenarios) {
    for (const tool of SWEPT) {
      it(`${sc.name}: ${tool}: every call cut by 1, 2 or all lines is exit 2 or unchanged`, async () => {
        prepare(sc);
        const virt = tool === 'classify' || tool === 'review' ? tool : null;
        const base = await runCut(sc, realTool(tool), virt, 0, 1);
        assert.equal(base.status, sc.truth, `the untouched run: ${base.all}`);
        if (base.calls < 1) return;
        const tasks = [];
        for (let n = 1; n <= base.calls; n += 1) for (const k of [1, 2, 'all']) tasks.push(async () => ({ n, k, r: await runCut(sc, realTool(tool), virt, n, k) }));
        const results = await pool(tasks);
        for (const { n, k, r } of results) {
          runs += 1;
          const label = `${tool} call ${n} of ${base.calls}, last ${k} line(s) dropped`;
          const key = `${sc.name}#${n}`;
          if (!allCalls[tool].has(key)) allCalls[tool].set(key, []);
          if (r.changed) {
            cutCalls[tool].add(key);
            stops(r, label);
          } else {
            assert.equal(r.status, sc.truth, `${label}: nothing was cut, and the verdict changed: ${r.all}`);
            assert.equal(r.all, base.all, `${label}: nothing was cut, and the output changed`);
            allCalls[tool].get(key).push(...r.empty);
          }
        }
      });
    }
    for (const tool of [...SWEPT.filter((t) => t !== 'classify' && t !== 'review'), ...SILENT, 'sh']) {
      it(`${sc.name}: ${tool} missing, and ${tool} failing with status 1: exit 2 when it is called, else the untouched run`, async () => {
        prepare(sc);
        const counted = await runCut(sc, tool, null, 0, 1);
        assert.equal(counted.status, sc.truth, counted.all);
        const [missing, failing] = await pool([() => runFail(sc, [tool], {}), () => runFail(sc, [], { [tool]: 'exit 1' })]);
        for (const [what, r] of [['missing', missing], ['failing', failing]]) {
          if (counted.calls >= 1) stops(r, `${tool} ${what}`);
          else { assert.equal(r.status, sc.truth, `${tool} ${what} but never called: ${r.all}`); assert.equal(r.all, counted.all); }
        }
      });
    }
  }
  it('(guard) the sweep ran, every call that prints something was really cut at least once, and the calls that print nothing are only the status questions of git', () => {
    assert.ok(runs > 200, `only ${runs} shimmed runs`);
    for (const tool of SWEPT) {
      for (const [key, empties] of allCalls[tool]) {
        if (cutCalls[tool].has(key)) continue;
        // not cut by any of the three cuts, so the call printed nothing: only a status question of git may do that
        const allowed = (tool === 'git' || tool === 'env') && empties.length >= 1 && empties.every((a) => a.includes('merge-base --is-ancestor'));
        assert.ok(allowed, `${tool}: the call ${key} was never really cut, and it is not a status question (it printed nothing in: ${empties.join(' | ') || 'no run'})`);
      }
    }
    for (const tool of ['git', 'env', 'mktemp', 'cat', 'wc', 'tr', 'classify', 'review']) assert.ok(cutCalls[tool].size >= 1, `${tool}: no call was cut`);
    console.log(`sweep: ${runs} shimmed runs in ${Date.now() - started} ms, calls cut ${JSON.stringify(Object.fromEntries(SWEPT.map((t) => [t, cutCalls[t].size])))}`);
  });
});

// the siblings are the ones next to the script, and what they hand on is proven: the check reads the emit file of the review check and nothing else
describe('check-basis-record.sh: the siblings are found next to the script, and their answers are proven', () => {
  const REAL = ['check-basis-record.sh', 'check-review-record.sh', 'classify-paths.sh'];
  /** A copy of the scripts directory in which `stubs` (name -> text) replace the siblings; runs the copy on the pull request of `w`. */
  function withStubs(w, stubs, rec) {
    const dir = fresh('scripts');
    for (const n of REAL) writeFileSync(path.join(dir, n), stubs[n] ?? readFileSync(path.join(path.dirname(script), n)));
    const f = path.join(fresh('body'), 'body'); writeFileSync(f, bodyOf(w.head(), rec, w.mark));
    const r = spawnSync('/bin/sh', [path.join(dir, 'check-basis-record.sh'), ...usual(f, w.head(), w.base()).flat()], { cwd: w.d, encoding: 'utf8', env: cleanEnv });
    const all = r.stdout + r.stderr;
    return { status: r.status, all, lines: all.split('\n').filter((x) => x !== '') };
  }
  // a review check that says "matches the head" and writes the emit file named after --emit with `emit` as its text (none: no file)
  const reviewStub = (emit, code = 0, say = 'review record: matches the head') => `${emit === null ? '' : `while [ $# -gt 0 ]; do if [ "$1" = --emit ]; then printf '%s' '${emit}' > "$2"; fi; shift; done\n`}echo "${say}"\nexit ${code}\n`;
  const emitOf = (basis, { end = true } = {}) => `basis ${basis}\nbasis-opus ${basis} o/r 7 101\nbasis-codex ${basis} o/r 7 102\n${end ? 'end\n' : ''}`;

  it('with the real siblings it matches, and a classifier that cannot run is exit 2', () => {
    const w = world();
    const b = w.B(); w.I();
    green({ ...withStubs(w, {}, { basis: b }) }, matches(w.fork, b));
    for (const code of [2, 3]) couldNotRun(withStubs(w, { 'classify-paths.sh': `echo "classify-paths: could not run (a stub)"\nexit ${code}\n` }, { basis: b }));
  });

  it('a review check that exits 2 or 3, or that says it matches but leaves no emit file, or an emit file without its last line, is exit 2', () => {
    const w = world();
    const b = w.B(); w.I();
    const cases = {
      'exit 2': reviewStub(null, 2, 'review record: could not run (a stub)'),
      'exit 3': reviewStub(null, 3, 'review record: could not run (a stub)'),
      'matches, no emit file': reviewStub(null),
      'an emit file without end': reviewStub(emitOf(b, { end: false })),
      'an empty emit file': reviewStub(''),
    };
    for (const [name, text] of Object.entries(cases)) {
      const r = withStubs(w, { 'check-review-record.sh': text }, { basis: b });
      assert.equal(r.status, 2, `${name}: ${r.all}`);
      couldNotRun(r);
    }
    green(withStubs(w, { 'check-review-record.sh': reviewStub(emitOf(b)) }, { basis: b }), matches(w.fork, b));
  });

  it('what is judged is the emit file, not the body: an emit that names another commit of the path decides the verdict', () => {
    const w = world();
    const b1 = w.B(); const b2 = w.B(); w.I();
    green(withStubs(w, { 'check-review-record.sh': reviewStub(emitOf(b2)) }, { basis: b1 }), matches(w.fork, b2));
    const x = w.side('other', () => w.B());
    red(withStubs(w, { 'check-review-record.sh': reviewStub(emitOf(x)) }, { basis: b1 }), NOT_ON_PATH(x));
    // an emit with no basis line at all is the no-record mode, whatever the body says
    const r = withStubs(w, { 'check-review-record.sh': reviewStub('end\n') }, { basis: b1 });
    assert.equal(r.status, 1, r.all);
    red(r, 'record the basis');
  });
});
