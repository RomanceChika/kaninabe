/**
 * Scanner change, keys (docs/known-gaps.md 16(a), 16(h), 17): a key is found under node_modules/, in a .svg and in a file named
 * gitleaks.toml at any depth, a `keys` entry silences one content at one path and nothing else, and the tree of HEAD is read the
 * way a commit is (no key is lost at a chunk boundary). REAL gitleaks and actionlint, like push-gate-verdict.test.mjs; they are
 * a separate file so that node --test runs it in parallel with the others.
 *
 * The harness below repeats the one in push-gate-verdict.test.mjs: the import fence lets a test import only node: built-ins and
 * scripts/ or bin/, so a shared helper module under tests/ is not possible without a change to the fence.
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
