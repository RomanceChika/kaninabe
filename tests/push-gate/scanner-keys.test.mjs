/**
 * Scanner change, keys (docs/known-gaps.md 16(a), 16(h), 17): a key is found under node_modules/, in a .svg and in a file named
 * gitleaks.toml at any depth, a `keys` entry silences one content at one path and nothing else, and the tree of HEAD is read the
 * way a commit is (no key is lost at a chunk boundary). REAL gitleaks and actionlint, like push-gate-verdict.test.mjs; they are
 * a separate file so that node --test runs it in parallel with the others.
 *
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';

import { harness, realGate, reason, fakeKey, tab, blobId, patchesOf, treeOf, rangeUnr, treeUnr } from './harness.mjs';

// The harness registers the beforeEach / afterEach of this file. The paths live in the variables below (a test may move into another
// repository by assigning `repo`); the harness reads and sets them through these two functions.
let gate = realGate;
let gscripts;
let dir;
let repo;
let bin;
const H = harness({ get: () => ({ dir, repo, bin, gate, gscripts }), set: (v) => { ({ dir, repo, bin, gate, gscripts } = v); } });
const { commit, general, setList, gateWith, commitRaw, WORDS } = H;


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
