/**
 * Scanner change, what the scans cannot read and the mail rule (docs/known-gaps.md 16(b), 16(e)): unreadable content is red
 * unless a `binary` entry names it, file names that cannot be written in the list are exit 2, and a mail address is matched
 * whole. REAL gitleaks and actionlint, like push-gate-verdict.test.mjs; a separate file so that node --test runs it in
 * parallel with the others. The harness is tests/push-gate/harness.mjs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { harness, realGate, reason, fakeKey, tab, sha256, blobId, rangeUnr, treeUnr, MAILMSG } from './harness.mjs';

// The harness registers the beforeEach / afterEach of this file. The paths live in the variables below (a test may move into another
// repository by assigning `repo`); the harness reads and sets them through these two functions.
let gate = realGate;
let gscripts;
let dir;
let repo;
let bin;
const H = harness({ get: () => ({ dir, repo, bin, gate, gscripts }), set: (v) => { ({ dir, repo, bin, gate, gscripts } = v); } });
const { env, git, commit, gateRun, general, setList, gateWith, scanPublic, commitRaw, commitNamed, scanPrText, WORDS } = H;


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

describe('the scanner change: a file that git treats as binary (the old known gap)', () => {
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

  // `nul`: whether the sample holds a NUL byte (a test asserts it). A sample without one must not be valid UTF-8 either.
  const KINDS = {
    'a UTF-16 file with a byte order mark (ASCII text, so NUL bytes)': { buf: Buffer.from('\ufeffplain words here\n', 'utf16le'), nul: true },
    'a UTF-16 file with a byte order mark (CJK text, no NUL byte)': { buf: Buffer.from('\ufeff\u6f22\u5b57\u6f22\u5b57', 'utf16le'), nul: false },
    'a UTF-16 file without a byte order mark (CJK text, no NUL byte, not valid UTF-8)': { buf: Buffer.from('\u9f9f\u8a8a\u9f9f\u8a8a\u9f9f', 'utf16le'), nul: false },
    'a latin-1 file (not valid UTF-8, no NUL byte)': { buf: Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from(' plain words\n')]), nul: false },
    'a file whose first NUL byte is after the 8000 bytes git looks at': { buf: Buffer.concat([Buffer.from('a'.repeat(8050)), Buffer.from([0]), Buffer.from('b\n')]), nul: true },
  };
  const validUtf8 = (buf) => { try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; } };
  for (const [label, { buf, nul }] of Object.entries(KINDS)) {
    it(`B3: ${label} is red (range 1, tree 1)`, () => {
      assert.equal(buf.includes(0), nul, 'the sample does not have the NUL bytes the label says');
      if (!nul) assert.equal(validUtf8(buf), false, 'a sample without a NUL byte must not be valid UTF-8');
      commitRaw({ 'notes.txt': buf });
      const r = general();
      assert.equal(r.status, 1, r.out);
      assert.equal(rangeUnr(r), 1, r.out);
      assert.equal(treeUnr(r), 1, r.out);
    });
  }

  it('B3: a binary file added in commit 2 and deleted in commit 3 is red through the range (1), not through the tree, in words mode and in general mode', () => {
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
  it('B3: the same for a key-free latin-1 file (words mode)', () => {
    commit({ 'a.txt': 'one\n' });
    commitRaw({ 'notes1.txt': KINDS['a latin-1 file (not valid UTF-8, no NUL byte)'].buf });
    git('rm', '-q', 'notes1.txt');
    git('commit', '-q', '-m', 'delete');
    const r = gateWith('', ['--mode', 'words', '--all'], words());
    assert.equal(r.status, 1, r.out);
    assert.equal(rangeUnr(r), 1, r.out);
    assert.equal(treeUnr(r), 0, r.out);
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
    assert.equal(rangeUnr(r), 0, r.out);
    assert.equal(treeUnr(r), 0, r.out);
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
    it('the string in its path passes (a full gate run)', () => {
      commit({ 'docs/contact.txt': `contact ${owner}\n` });
      const r = gateWith(entry(owner));
      assert.equal(r.status, 0, r.out);
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

