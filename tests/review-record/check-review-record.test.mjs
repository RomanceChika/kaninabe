/**
 * Tests of scripts/check-review-record.sh: a record that names the head passes; a stale, missing, doubled or
 * malformed record fails; and every body in which what a reader sees could differ from what is counted fails
 * (HTML, stray carriage returns, invisible characters, fences that hide the section, record lines before it),
 * and each failing body fails for the rule it is meant to show.
 *
 * The record may also hold the basis lines (basis-first, basis-prev, basis, basis-opus, basis-codex): their grammar is held here,
 * and `--emit <file>` writes the values of those lines in one fixed form (the only reader of the record: the basis check reads that file).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-review-record.sh', import.meta.url));
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const record = (o = HEAD, c = HEAD) => `## Review\n- opus: ${o}\n- codex: ${c}\n`;

// The directory of tools the script runs with, when a test names one (a private PATH: a chosen awk, or a tool missing or failing).
// null: the PATH of the test run.
let toolPath = null;
const envOf = () => (toolPath ? { ...process.env, PATH: toolPath } : process.env);

/**
 * Runs the script on `body` against `head`; returns the exit status and output. `extra` is a list of arguments after the head, or a
 * function of (directory, body file) that makes it; `EMIT` is the usual one (`--emit <dir>/emit`). The file `<dir>/emit` is read back
 * (text, mode, null when it is not there), and so is the list of the files left in the directory.
 */
const EMIT = (dir) => ['--emit', path.join(dir, 'emit')];
function check(body, head = HEAD, extra = null, { umask = false, before } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-record-'));
  try {
    const file = path.join(dir, 'body');
    writeFileSync(file, body);
    if (before) before(dir, file);
    const args = [script, file, head, ...(typeof extra === 'function' ? extra(dir, file) : (extra ?? []))];
    const r = umask
      ? spawnSync('/bin/sh', ['-c', 'umask 000; exec /bin/sh "$@"', 'sh', ...args.slice(0)], { encoding: 'utf8', env: envOf() })
      : spawnSync('/bin/sh', args, { encoding: 'utf8', env: envOf() });
    const emitFile = path.join(dir, 'emit');
    const isFile = existsSync(emitFile) && statSync(emitFile).isFile();
    return {
      status: r.status,
      out: r.stdout + r.stderr,
      emit: isFile ? readFileSync(emitFile, 'utf8') : null,
      mode: isFile ? statSync(emitFile).mode & 0o777 : null,
      files: readdirSync(dir).sort(),
      bodyAfter: readFileSync(file, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Asserts that `body` fails with exit 1 and that the output names `rule`. */
function failsWith(body, rule) {
  const r = check(body);
  assert.equal(r.status, 1, JSON.stringify(body));
  assert.ok(r.out.includes(rule), `${JSON.stringify(body)} should fail with "${rule}", got: ${r.out}`);
}

const B1 = '1'.repeat(40);
const B2 = '2'.repeat(40);
const B3 = '3'.repeat(40);
const B4 = '4'.repeat(40);
const URL1 = 'https://github.com/o/r/pull/7#issuecomment-101';
const URL2 = 'https://github.com/o/r/pull/7#issuecomment-102';
/** The basis lines (default: just `basis` and its two answers). */
const basisLines = ({ first, prev = [], basis = B4, bo = basis, bc = basis, uo = URL1, uc = URL2 } = {}) =>
  `${first !== undefined ? `- basis-first: ${first}\n` : ''}${prev.map((p) => `- basis-prev: ${p}\n`).join('')}- basis: ${basis}\n- basis-opus: ${bo} ${uo}\n- basis-codex: ${bc} ${uc}\n`;
const withBasis = (opts) => record() + basisLines(opts);
const FULL = withBasis({ first: B1, prev: [B2, B3], basis: B4 });

const TAG = 'HTML tag or comment';
const LAST = 'must be the last one';
const BEFORE = 'record line appears before';
const INFENCE = 'inside fenced code';
const NEEDBASIS = 'a - basis: line is required when another basis line is present';
const NEEDFIRST = 'a - basis-prev: line needs a - basis-first: line';
const ORDER = 'the record lines are not in the required order';
const NOTSHA = 'is not a full commit sha';
const BADLINK = 'link is not https://github.com/OWNER/REPO/pull/N#issuecomment-ID';

function cases() {
  it('passes when both lines name the head, also with CRLF, code and prose about the reviewers before the section', () => {
    assert.equal(check(`## 何を変えたか\n\nOpus と Codex の両方が見る\n\n${record()}`).status, 0);
    assert.equal(check(`x\r\n\r\n## Review\r\n- opus: ${HEAD}\r\n- codex: ${HEAD}\r\n`).status, 0);
    assert.equal(check(`\`\`\`sh\necho hi\n\`\`\`\n\n${record()}`).status, 0);
    assert.equal(check(`\`\`\`\`\n\`\`\`\n\`\`\`\n\`\`\`\`\n${record()}`).status, 0);
    assert.equal(check(`a < b and 1 <2\n${record()}`).status, 0);
  });

  it('fails on a stale, empty, short or doubled record', () => {
    for (const body of [record(OLD), record(HEAD, OLD)]) failsWith(body, 'reviewed bbbbbbbb');
    for (const body of [record('', ''), record(HEAD.slice(0, 39)), record(HEAD.toUpperCase())]) failsWith(body, 'not a full commit sha');
    failsWith(`${record()}- opus: ${HEAD}\n`, 'exactly one - opus:');
    failsWith(`${record()}- codex: ${HEAD}\n`, 'exactly one - codex:');
    failsWith(`${record()}\n${record()}`, LAST);
    failsWith('no record\n', 'found none');
  });

  it('fails when the section is not the last one or holds anything else', () => {
    failsWith(`${record()}\n## 後書き\n`, LAST);
    failsWith(`${record()}メモ\n`, LAST);
  });

  it('fails on any HTML tag or comment, so hidden or flattened text cannot be counted', () => {
    for (const body of [`<!-- x -->\n${record()}`, `<!--\n${record()}`, `\`<!--\`\n${record()}`, `## Review\n<!-- x -->\n- opus: ${HEAD}\n- codex: ${HEAD}\n`,
      `<details>\n<summary>x</summary>\n\n${record()}`, `<div>\n${record()}`, `<?\n${record()}`, `<![CDATA[\n${record()}`,
      `<!DOCTYPE x\n${record()}`, `<PRE>\n${record()}`, `text <details> more\n\n${record()}`, `</p>\n${record()}`]) {
      failsWith(body, TAG);
    }
  });

  it('fails on a carriage return that does not end a line, and on invisible characters', () => {
    failsWith(`text\r\`\`\`\n${record()}`, 'carriage return');
    failsWith(`intro\r## Review\r- opus: ${OLD}\r- codex: ${OLD}\r\n${record()}`, 'carriage return');
    failsWith(`## Revi\u200bew\n- opus: ${HEAD}\n- codex: ${HEAD}\n${record()}`, 'invisible character');
    failsWith(`\ufeff${record()}`, 'invisible character');
    failsWith(`a\u202eb\n${record()}`, 'invisible character');
    failsWith(`a\u2060b\n${record()}`, 'invisible character');
    for (const ch of ['\u200b', '\u200d', '\u200f', '\u202a', '\u202e', '\u2060', '\u2061', '\u2064', '\u2066', '\u2069', '\ufeff']) {
      failsWith(`a${ch}b\n${record()}`, 'invisible character');
    }
  });

  it('tracks fences by character and length, and fails when the section sits inside one', () => {
    for (const body of [`\`\`\`\n${record()}\`\`\`\n`, `\`\`\`\`\n\`\`\`\n${record()}`, `\`\`\`\n~~~\n${record()}`,
      `~~~\n\`\`\`\n${record()}`, `~~~\n${record()}`, `\`\`\`\n\`\`\` x\n${record()}`]) {
      failsWith(body, INFENCE);
    }
    assert.equal(check(`\`\`\`a\`b\n${record()}`).status, 0, 'a backtick in the info string makes it not a fence');
    failsWith(`\`\`\`\`\`\n${record()}`, INFENCE);
    assert.equal(check(`~~消し線~~ と \`code\`\n${record()}`).status, 0, 'fewer than three is not a fence');
    failsWith(`> ## Review\n- opus: ${HEAD}\n- codex: ${HEAD}\n`, BEFORE);
  });

  it('fails on a fence that does not start the line (a list item ends it where a line reader cannot see)', () => {
    for (const body of [`- a\n  \`\`\`\n  x\n\`\`\`\n${record()}`, `1. a\n   ~~~\n~~~\n${record()}`, `   ~~~~\n~~~\n${record()}`,
      `    \`\`\`\n${record()}`, `> \`\`\`\n${record()}`, `use \`\`\` here\n${record()}`]) {
      failsWith(body, 'does not start the line');
    }
  });

  it('fails on a footnote, which GitHub shows after the record', () => {
    for (const body of [`a[^1]\n\n[^1]: note\n\n${record()}`, `a[^1]\n\n> [^1]: note\n\n${record()}`,
      `a[^1]\n\n- [^1]: note\n\n${record()}`, `a[^1]\n\n  [^1]: note\n\n${record()}`]) {
      failsWith(body, 'footnote');
    }
  });

  it('holds the section to the exact heading and record lines', () => {
    failsWith(`## Review foo\n- opus: ${HEAD}\n- codex: ${HEAD}\n`, BEFORE);
    assert.equal(check(`## Review \t\n\t\n- opus:\t ${HEAD} \t\n \n- codex:  ${HEAD}\t\n`).status, 0, 'blank lines and blanks around the value are allowed');
  });

  it('fails on a record-like line before the section, even in a fence or other markup', () => {
    for (const body of [`- opus: ${OLD}\n${record()}`, `\`\`\`\n- codex: ${HEAD}\n\`\`\`\n${record()}`, `> * Opus: x\n${record()}`,
      `1. opus: ${OLD}\n${record()}`, `- **opus**: ${OLD}\n${record()}`]) {
      failsWith(body, BEFORE);
    }
  });

  it('passes with the basis lines: the plain block, the first and previous records, either order of the two reviewers', () => {
    for (const body of [withBasis(), FULL, withBasis({ first: B1, basis: B4 }), withBasis({ first: B1, prev: [B2], basis: B4 }),
      `## Basis moves\n\nBasis moves: why the record moved.\n\n${record()}${basisLines()}`,
      `## Review\n- codex: ${HEAD}\n- opus: ${HEAD}\n${basisLines()}`,
      `## Review\n- opus: ${HEAD}\n- codex: ${HEAD}\n- basis: ${B4}\n- basis-codex: ${B4} ${URL2}\n- basis-opus: ${B4} ${URL1}\n`,
      `## Review\r\n- opus: ${HEAD}\r\n- codex: ${HEAD}\r\n- basis: ${B4}\r\n- basis-opus: ${B4} ${URL1}\r\n- basis-codex: ${B4} ${URL2}\r\n`,
      `${record()}\n\n${basisLines({ first: B1 })}\n`]) {
      const r = check(body);
      assert.equal(r.status, 0, `${JSON.stringify(body)}: ${r.out}`);
      assert.ok(r.out.includes('matches the head'), r.out);
    }
  });

  it('a basis line does not make the record match: the review lines still have to name the head', () => {
    failsWith(withBasis().replace(`- opus: ${HEAD}`, `- opus: ${OLD}`), 'reviewed bbbbbbbb');
    failsWith(withBasis({ basis: HEAD, bo: HEAD, bc: HEAD }).replace(`- codex: ${HEAD}`, `- codex: ${OLD}`), 'codex reviewed bbbbbbbb');
  });

  it('fails when a basis line has no partner: basis without its two answers, answers without basis, first or previous without basis', () => {
    failsWith(`${record()}- basis: ${B4}\n`, 'need exactly one - basis-opus: line');
    failsWith(`${record()}- basis: ${B4}\n`, 'need exactly one - basis-codex: line');
    failsWith(`${record()}- basis: ${B4}\n- basis-opus: ${B4} ${URL1}\n`, 'need exactly one - basis-codex: line');
    failsWith(`${record()}- basis: ${B4}\n- basis-codex: ${B4} ${URL2}\n`, 'need exactly one - basis-opus: line');
    failsWith(`${record()}- basis-opus: ${B4} ${URL1}\n- basis-codex: ${B4} ${URL2}\n`, NEEDBASIS);
    failsWith(`${record()}- basis-opus: ${B4} ${URL1}\n`, NEEDBASIS);
    failsWith(`${record()}- basis-first: ${B1}\n`, NEEDBASIS);
    failsWith(`${record()}- basis-first: ${B1}\n- basis-prev: ${B2}\n`, NEEDBASIS);
    failsWith(`${record()}- basis-prev: ${B2}\n`, NEEDBASIS);
    failsWith(withBasis({ prev: [B2] }), NEEDFIRST);
  });

  it('fails on a doubled basis line', () => {
    failsWith(`${record()}- basis-first: ${B1}\n- basis-first: ${B2}\n${basisLines()}`, 'at most one - basis-first: line');
    failsWith(`${withBasis({ first: B1 })}- basis: ${B4}\n`, 'at most one - basis: line');
    failsWith(`${withBasis()}- basis-opus: ${B4} ${URL1}\n`, 'need exactly one - basis-opus: line');
    failsWith(`${withBasis()}- basis-codex: ${B4} ${URL2}\n`, 'need exactly one - basis-codex: line');
  });

  it('fails when a sha of a basis line is not a full sha: first, previous, basis, and the sha of each answer', () => {
    for (const v of [B1.slice(0, 39), B1.replace(/1/g, 'A'), '', `${B1.slice(0, 39)}g`, `${B1}0`]) {
      failsWith(withBasis({ first: v, basis: B4 }), `'- basis-first:' ${NOTSHA}`);
      failsWith(withBasis({ first: B1, prev: [v], basis: B4 }), `'- basis-prev:' ${NOTSHA}`);
      failsWith(withBasis({ basis: v, bo: v, bc: v }), `'- basis:' ${NOTSHA}`);
      failsWith(withBasis({ bo: v }), `'- basis-opus:' ${NOTSHA}`);
      failsWith(withBasis({ bc: v }), `'- basis-codex:' ${NOTSHA}`);
    }
  });

  it('fails when the link of an answer is not exactly https://github.com/OWNER/REPO/pull/N#issuecomment-ID', () => {
    const bad = ['http://github.com/o/r/pull/7#issuecomment-101', 'https://github.com/o/r/issues/7#issuecomment-101', 'https://github.com/o/r/pull/7',
      'https://github.com/o/r/pull/7#issuecomment-', 'https://github.com/o/r/pull/7#issuecomment-10x', 'https://github.com/o/r/pull/7#issuecomment-101 trailing',
      'https://github.com/o/r/pull/7#issuecomment-101#x', 'https://github.com/o/r/pull/7#discussion_r101', 'https://example.org/o/r/pull/7#issuecomment-101',
      'https://github.com/o/pull/7#issuecomment-101', 'https://github.com/o/r/pull/#issuecomment-101', 'https://github.com/o/r/pull/7/files#issuecomment-101',
      'HTTPS://github.com/o/r/pull/7#issuecomment-101', '', 'see the comment'];
    for (const u of bad) {
      failsWith(withBasis({ uo: u }), `'- basis-opus:' ${BADLINK}`);
      failsWith(withBasis({ uc: u }), `'- basis-codex:' ${BADLINK}`);
    }
    failsWith(`${record()}- basis: ${B4}\n- basis-opus: ${B4}\n- basis-codex: ${B4} ${URL2}\n`, `'- basis-opus:' ${BADLINK}`);
  });

  it('fails on a link in angle brackets (the HTML rule)', () => {
    failsWith(withBasis({ uo: `<${URL1}>` }), TAG);
    failsWith(withBasis({ uc: `<${URL2}>` }), TAG);
  });

  it('fails when the lines are not in the fixed order: the basis lines after the two reviewers, first, previous, basis, then the answers', () => {
    const lines = { o: `- opus: ${HEAD}\n`, c: `- codex: ${HEAD}\n`, f: `- basis-first: ${B1}\n`, p: `- basis-prev: ${B2}\n`, p2: `- basis-prev: ${B3}\n`,
      b: `- basis: ${B4}\n`, bo: `- basis-opus: ${B4} ${URL1}\n`, bc: `- basis-codex: ${B4} ${URL2}\n` };
    const section = (keys) => `## Review\n${keys.map((k) => lines[k]).join('')}`;
    assert.equal(check(section(['o', 'c', 'f', 'p', 'p2', 'b', 'bo', 'bc'])).status, 0);
    for (const keys of [
      ['o', 'c', 'b', 'f', 'bo', 'bc'], ['o', 'c', 'f', 'b', 'p', 'bo', 'bc'], ['o', 'c', 'p', 'f', 'b', 'bo', 'bc'], ['o', 'c', 'f', 'p', 'b', 'p2', 'bo', 'bc'],
      ['o', 'c', 'bo', 'b', 'bc'], ['o', 'c', 'bo', 'bc', 'b'], ['o', 'c', 'b', 'bo', 'f', 'bc'], ['f', 'o', 'c', 'b', 'bo', 'bc'], ['o', 'f', 'c', 'b', 'bo', 'bc'],
      ['b', 'o', 'c', 'bo', 'bc'], ['o', 'c', 'b', 'bo', 'bc', 'o'], ['o', 'c', 'b', 'bo', 'bc', 'p2'],
    ]) {
      failsWith(section(keys), ORDER);
    }
  });

  it('fails on a line that only looks like a basis line inside the section (it is not a record line, so the section is not the last)', () => {
    for (const bad of [`- Basis: ${B4}\n`, `- basis : ${B4}\n`, `- basis-latest: ${B4}\n`, `-  basis: ${B4}\n`, `* basis: ${B4}\n`, `basis: ${B4}\n`, `- basis-First: ${B1}\n`,
      `- basis_prev: ${B2}\n`, `- basis-opus : ${B4} ${URL1}\n`, `- Basis-Codex: ${B4} ${URL2}\n`]) {
      failsWith(record() + bad, LAST);
      failsWith(withBasis() + bad, LAST);
    }
  });

  it('fails on a line that looks like a basis line before the section, in prose, in a list, in a quote and in a fence', () => {
    for (const bad of [`- basis: ${B4}`, `Basis: moved because of x`, `- basis-first: ${B1}`, `basis_prev: ${B2}`, `- **basis-opus**: ${B4} ${URL1}`, `> basis-codex: ${B4} ${URL2}`,
      `1. Basis-First: ${B1}`, `- basis-prev: ${B2}`, `basis: `, `* BASIS: x`]) {
      failsWith(`${bad}\n${record()}`, BEFORE);
      failsWith(`${bad}\n${withBasis()}`, BEFORE);
      failsWith(`\`\`\`\n${bad}\n\`\`\`\n${record()}`, BEFORE);
    }
  });

  it('--emit writes the values of the record in one fixed form, and the last line is end', () => {
    const emitOf = (body) => { const r = check(body, HEAD, EMIT); assert.equal(r.status, 0, r.out); return r.emit; };
    assert.equal(emitOf(record()), 'end\n');
    assert.equal(emitOf(FULL), `basis-first ${B1}\nbasis-prev ${B2}\nbasis-prev ${B3}\nbasis ${B4}\nbasis-opus ${B4} o/r 7 101\nbasis-codex ${B4} o/r 7 102\nend\n`);
    assert.equal(emitOf(withBasis()), `basis ${B4}\nbasis-opus ${B4} o/r 7 101\nbasis-codex ${B4} o/r 7 102\nend\n`);
    assert.equal(emitOf(withBasis({ first: B1 })), `basis-first ${B1}\nbasis ${B4}\nbasis-opus ${B4} o/r 7 101\nbasis-codex ${B4} o/r 7 102\nend\n`);
    // the same values whichever order the reviewers' lines are in, and with the names and numbers of the links as they are written
    assert.equal(emitOf(`## Review\n- codex: ${HEAD}\n- opus: ${HEAD}\n- basis: ${B4}\n- basis-codex: ${B4} https://github.com/Own.er-1/re_po.js/pull/1234#issuecomment-9876543210\n- basis-opus: ${B4} https://github.com/Own.er-1/re_po.js/pull/1234#issuecomment-5\n`),
      `basis ${B4}\nbasis-opus ${B4} Own.er-1/re_po.js 1234 5\nbasis-codex ${B4} Own.er-1/re_po.js 1234 9876543210\nend\n`);
    assert.equal(emitOf(`x\r\n\r\n${record().replace(/\n/g, '\r\n')}${basisLines().replace(/\n/g, '\r\n')}`), `basis ${B4}\nbasis-opus ${B4} o/r 7 101\nbasis-codex ${B4} o/r 7 102\nend\n`);
  });

  it('--emit: the file is written only when the record passes, all or nothing, and an old file at that place is removed', () => {
    const stale = (dir) => writeFileSync(path.join(dir, 'emit'), 'STALE\n');
    for (const body of [record(OLD), withBasis().replace(`- codex: ${HEAD}`, `- codex: ${OLD}`), `<div>\n${record()}`, `${record()}- basis: ${B4}\n`, 'no record\n', `${record()}メモ\n`, withBasis({ prev: [B2] })]) {
      const r = check(body, HEAD, EMIT, { before: stale });
      assert.equal(r.status, 1, r.out);
      assert.equal(r.emit, null, `a file is left after a verdict of 1: ${JSON.stringify(body)}`);
      assert.deepEqual(r.files, ['body'], 'nothing else is left either');
    }
    const ok = check(FULL, HEAD, EMIT, { before: stale });
    assert.equal(ok.status, 0, ok.out);
    assert.ok(ok.emit.startsWith('basis-first '), 'a stale file is replaced, not kept');
    assert.deepEqual(ok.files, ['body', 'emit'], 'no temporary file is left beside the emit file');
    const bad = check(record(), 'xyz', EMIT);
    assert.equal(bad.status, 2);
    assert.equal(bad.emit, null);
    const gone = spawnSync('/bin/sh', [script, '/nonexistent/body', HEAD, '--emit', path.join(tmpdir(), 'never-written-emit')], { encoding: 'utf8', env: envOf() });
    assert.equal(gone.status, 2);
    assert.equal(existsSync(path.join(tmpdir(), 'never-written-emit')), false);
  });

  it('--emit: the file has mode 0600, whatever the umask', () => {
    for (const umask of [false, true]) {
      const r = check(FULL, HEAD, EMIT, { umask });
      assert.equal(r.status, 0, r.out);
      assert.equal(r.mode.toString(8), '600', `umask ${umask ? '000' : 'of the run'}`);
    }
  });

  it('--emit may not be the body, under any spelling: exit 2 and the body is not changed', () => {
    const spellings = {
      'the same path': (dir, file) => ['--emit', file],
      'a relative spelling': (dir, file) => ['--emit', path.join(dir, '.', 'body')],
      'a symbolic link to it': (dir, file) => { symlinkSync(file, path.join(dir, 'emit')); return ['--emit', path.join(dir, 'emit')]; },
      'a hard link to it': (dir, file) => { linkSync(file, path.join(dir, 'emit')); return ['--emit', path.join(dir, 'emit')]; },
    };
    for (const [name, extra] of Object.entries(spellings)) {
      const r = check(FULL, HEAD, extra);
      assert.equal(r.status, 2, `${name}: ${r.out}`);
      assert.equal(r.bodyAfter, FULL, `${name}: the body was changed`);
      assert.ok(r.out.includes('could not run'), `${name}: ${r.out}`);
    }
  });

  it('--emit: a directory that does not exist, a directory in its place, and a wrong use of the arguments are exit 2 with no file', () => {
    assert.equal(check(FULL, HEAD, (dir) => ['--emit', path.join(dir, 'no-such-dir', 'emit')]).status, 2);
    assert.equal(check(FULL, HEAD, (dir) => { mkdirSync(path.join(dir, 'emit')); return ['--emit', path.join(dir, 'emit')]; }).status, 2);
    const uses = { 'no file after --emit': () => ['--emit'], 'an empty file name': () => ['--emit', ''], 'a word after the file': (dir) => ['--emit', path.join(dir, 'emit'), 'b'],
      'another option': (dir) => ['--emitx', path.join(dir, 'emit')], 'a lone word': () => ['extra'] };
    for (const [name, extra] of Object.entries(uses)) {
      const r = check(FULL, HEAD, extra);
      assert.equal(r.status, 2, `${name}: ${r.out}`);
      assert.equal(r.emit, null, `${name}: a file was written`);
      assert.ok(/could not run|usage/.test(r.out), `${name}: ${r.out}`);
    }
    const twice = check(FULL, HEAD, (dir) => ['--emit', path.join(dir, 'emit'), '--emit', path.join(dir, 'emit2')]);
    assert.equal(twice.status, 2);
    assert.equal(twice.emit, null);
    assert.equal(check(FULL, HEAD).status, 0, 'the call with two arguments is unchanged');
    assert.equal(check(FULL, HEAD).emit, null, 'and it writes no file');
  });

  it('exits 2 on a malformed head or an unreadable body, and never prints the body', () => {
    assert.equal(check(record(), 'xyz').status, 2);
    assert.equal(check(record(HEAD.slice(0, 39), HEAD.slice(0, 39)), HEAD.slice(0, 39)).status, 2);
    assert.equal(check(record('g'.repeat(40), 'g'.repeat(40)), 'g'.repeat(40)).status, 2);
    assert.equal(check(record(), `${HEAD}\n${HEAD}`).status, 2);
    assert.equal(spawnSync('sh', [script, '/nonexistent/body', HEAD]).status, 2);
    const r = check(`秘密の語\n${record(OLD)}`);
    assert.ok(!r.out.includes('秘密の語') && !r.out.includes(OLD), r.out);
  });
}

describe('check-review-record.sh', cases);

// ---- the awk that runs it: the runner's awk is not the author's (the last scanner change taught that) ----
const SYSTEM = ['/usr/bin', '/bin', '/usr/local/bin'];
const which = (name) => SYSTEM.map((d) => path.join(d, name)).find((p) => spawnSync('/bin/sh', ['-c', `test -x ${p}`]).status === 0) ?? null;
const TOOLS = ['mktemp', 'rm', 'sed', 'sort', 'cat'];
// tools that are always put in the private PATH but are not swept (the `--emit` file may need them to be made and moved into place)
const EXTRA = ['mv', 'cmp', 'chmod', 'wc', 'tr', 'head', 'ls', 'dirname', 'basename', 'ln'];
/** A directory with only the tools the script needs: `awk` is the given program (a path, or ['busybox', 'awk']); `omit` names tools left out; `shim` maps a tool to a shell body; `extra` names more tools that are put in besides EXTRA. */
function makeBin(root, { awk = which('awk'), omit = [], shim = {}, extra = [] } = {}) {
  const bin = path.join(root, `bin-${Math.random().toString(36).slice(2)}`);
  mkdirSync(bin);
  const put = (name, body) => { writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  for (const n of TOOLS) {
    if (omit.includes(n)) continue;
    if (shim[n] !== undefined) put(n, shim[n]);
    else symlinkSync(which(n), path.join(bin, n));
  }
  for (const n of [...extra, ...EXTRA]) if (which(n) && !existsSync(path.join(bin, n))) symlinkSync(which(n), path.join(bin, n));
  if (!omit.includes('awk')) {
    if (shim.awk !== undefined) put('awk', shim.awk);
    else if (Array.isArray(awk)) put('awk', `exec ${awk[0]} ${awk[1]} "$@"`);
    else symlinkSync(awk, path.join(bin, 'awk'));
  }
  return bin;
}

const AWKS = [['gawk', which('gawk')], ['mawk', which('mawk')], ['original-awk', which('original-awk')], ['nawk', which('nawk')], ['busybox', which('busybox') ? [which('busybox'), 'awk'] : null]]
  .filter(([, p]) => p);
describe('check-review-record.sh: awks installed here', () => {
  it('(guard) at least one awk is installed', () => assert.ok(AWKS.length > 0));
});
for (const [name, awk] of AWKS) {
  describe(`check-review-record.sh with awk = ${name}`, () => {
    let root;
    before(() => { root = mkdtempSync(path.join(tmpdir(), 'review-record-awk-')); toolPath = makeBin(root, { awk }); });
    after(() => { toolPath = null; rmSync(root, { recursive: true, force: true }); });
    cases();
  });
}

describe('check-review-record.sh: a step that cannot run is exit 2, never 1 and never "matches the head"', () => {
  let root;
  before(() => { root = mkdtempSync(path.join(tmpdir(), 'review-record-run-')); });
  after(() => { toolPath = null; rmSync(root, { recursive: true, force: true }); });
  const stops = (r, why) => {
    assert.equal(r.status, 2, `${why}: ${r.out}`);
    assert.ok(!r.out.includes('matches the head'), `${why}: ${r.out}`);
    assert.ok(!r.out.includes('review record: FAILED'), `${why}: a verdict was printed: ${r.out}`);
    assert.ok(r.out.includes('could not run'), `${why}: no fixed message: ${r.out}`);
  };
  /** A body that fails the check (a stale record): an unusable tool must not turn it into exit 1 either. */
  const BODIES = [['a matching record', record()], ['a stale record', record(OLD)], ['a body with a rule broken', `<div>\n${record()}`]];

  it('(guard) the private PATH itself works: the tools it holds give exit 0 for a matching record', () => {
    toolPath = makeBin(root);
    assert.equal(check(record()).status, 0);
    assert.equal(check(record(OLD)).status, 1);
  });
  for (const tool of ['awk', ...TOOLS]) {
    for (const [what, body] of BODIES) {
      it(`${tool} missing: ${what} is exit 2`, () => {
        toolPath = makeBin(root, { omit: [tool] });
        stops(check(body), `${tool} missing`);
      });
      it(`${tool} failing with status 1: ${what} is exit 2`, () => {
        toolPath = makeBin(root, { shim: { [tool]: 'exit 1' } });
        stops(check(body), `${tool} fails`);
      });
    }
  }
  it('awk failing with status 1 after it printed findings is exit 2, not "found"', () => {
    toolPath = makeBin(root, { shim: { awk: "echo 'E need one ## Review section (found none outside fenced code)'; exit 1" } });
    stops(check(record()), 'awk exits 1 with output');
  });
  it('awk failing with status 2 (a program that does not parse) is exit 2', () => {
    toolPath = makeBin(root, { shim: { awk: 'exit 2' } });
    stops(check(record()), 'awk exits 2');
  });
  it('a temporary directory that cannot be made is exit 2: mktemp failing, and TMPDIR that does not exist', () => {
    toolPath = makeBin(root, { shim: { mktemp: 'exit 1' } });
    stops(check(record()), 'mktemp fails');
    toolPath = makeBin(root);
    const dir = mkdtempSync(path.join(tmpdir(), 'review-record-'));
    try {
      writeFileSync(path.join(dir, 'body'), record());
      const r = spawnSync('/bin/sh', [script, path.join(dir, 'body'), HEAD], { encoding: 'utf8', env: { ...process.env, PATH: toolPath, TMPDIR: '/nonexistent/tmpdir' } });
      stops({ status: r.status, out: r.stdout + r.stderr }, 'TMPDIR is not a directory');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('the body is not printed when a step cannot run', () => {
    toolPath = makeBin(root, { shim: { sort: 'exit 1' } });
    const r = check(`秘密の語\n${record(OLD)}`);
    assert.equal(r.status, 2, r.out);
    assert.ok(!r.out.includes('秘密の語') && !r.out.includes(OLD), r.out);
  });
});

describe('check-review-record.sh: a result that was cut short, or a body named like an awk assignment', () => {
  let root;
  before(() => { root = mkdtempSync(path.join(tmpdir(), 'review-record-cut-')); });
  after(() => { toolPath = null; rmSync(root, { recursive: true, force: true }); });
  /** An awk that runs the real one and then hands on its output without the last `n` lines, with status 0 (a write error that nobody saw). */
  const cutAwk = (n) => `T=$(${which('mktemp')}) || exit 3\n${which('awk')} "$@" > "$T" || exit $?\n${which('head')} -n -${n} "$T"\n${which('rm')} -f "$T"\nexit 0`;
  const BODIES = [['a matching record', record()], ['a record with a section after it', `${record()}メモ\n`], ['a record with an HTML tag before it', `<div>\n${record()}`]];
  for (const n of [1, 2]) {
    for (const [what, body] of BODIES) {
      it(`an awk whose output lost its last ${n} line(s): ${what} is exit 2, never 0 or 1`, () => {
        toolPath = makeBin(root, { shim: { awk: cutAwk(n) } });
        const r = check(body);
        assert.equal(r.status, 2, r.out);
        assert.ok(r.out.includes('could not run'), r.out);
        assert.ok(!r.out.includes('matches the head') && !r.out.includes('review record: FAILED'), r.out);
      });
    }
  }

  const inDir = (name, body) => {
    const dir = mkdtempSync(path.join(root, 'd-'));
    writeFileSync(path.join(dir, name), body);
    const r = spawnSync('/bin/sh', [script, name, HEAD], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  it('a body file named like an awk assignment (x=1, relative) is read as a file: a matching record passes', () => {
    const r = inDir('x=1', record());
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('matches the head'), r.out);
  });
  it('and a stale record in it fails for the right rule', () => {
    const r = inDir('x=1', record(OLD));
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('reviewed bbbbbbbb'), r.out);
  });
});

// ---- the class: every output the script reads must be proven complete before it is used ----
// A mechanical sweep: for each external tool the script calls, for each call index n of that tool (counted per body, since the path
// differs), a shim runs the real tool and hands on its standard output without the last k lines (k = 1, 2 and all) with status 0.
// The shim records whether the cut really changed the output of that call. A call whose output changed must be exit 2 (could not
// run); a call whose output did not change (there was nothing to cut) must be the untruncated run exactly.
describe('check-review-record.sh: a stage output that is cut short is exit 2, whatever the tool and whichever call', () => {
  let root;
  before(() => { root = mkdtempSync(path.join(tmpdir(), 'review-record-sweep-')); });
  after(() => { toolPath = null; rmSync(root, { recursive: true, force: true }); });
  const SWEPT = ['awk', 'sed', 'sort', 'cat', 'mktemp'];
  // the fourth value: the run has `--emit` (and the emit file is part of the verdict: written when it is 0, never otherwise)
  const BODIES = [
    ['a matching record', record(), 0],
    ['a full basis block', FULL, 0],
    ['a full basis block with --emit', FULL, 0, true],
    ['a basis-opus sha that differs from basis (the basis check compares them), with --emit', FULL.replace(`- basis-opus: ${B4}`, `- basis-opus: ${B3}`), 0, true],
    ['a basis line without its partner, with --emit', `${record()}- basis: ${B4}\n`, 1, true],
    ['a basis line without its partner', `${record()}- basis: ${B4}\n`, 1],
    ['a stale record', record(OLD), 1],
    ['a record followed by another section', `${record()}\n## 後書き\n`, 1],
    ['an HTML tag before the record', `<div>\n${record()}`, 1],
    ['no section', 'no record\n', 1],
    ['two sections', `${record()}\n${record()}`, 1],
  ];
  let counter = 0;
  /** Runs the body with `tool` shimmed: its call number `n` loses its last `k` lines (n = 0: no cut, only counted). Returns the result, how many times the tool was called, and whether the cut really changed what that call handed on (the shim compares the two). */
  const run = (tool, n, k, body, emit = false) => {
    const cnt = path.join(root, `cnt-${counter++}`);
    const real = tool === 'awk' ? which('awk') : which(tool);
    const cut = k === 'all' ? ': > "$U"' : `${which('head')} -n -${k} "$T" > "$U"`;
    // every command of the shim itself is checked: a failure of the test's own I/O is written to `.err` and fails the test, so that
    // it is never counted as "the script noticed the cut" (the mark that the output changed is written last, after everything else succeeded); cmp is read as 0 (same), 1 (changed) or anything else (could not compare)
    const shim = `bad() { echo "$1" >> ${cnt}.err; exit 3; }\nc=0\nif [ -f ${cnt} ]; then read c < ${cnt} || bad count-read; fi\nc=$((c+1))\necho $c > ${cnt} || bad count-write\n`
      + `if [ "$c" = ${n} ]; then\n  T=$(${which('mktemp')}) || bad mktemp\n  U=$(${which('mktemp')}) || bad mktemp\n  ${real} "$@" > "$T" || bad real-tool\n  ${cut} || bad cut\n  rc=0; ${which('cmp')} -s "$T" "$U" || rc=$?\n  case $rc in 0 | 1) ;; *) bad cmp ;; esac\n  ${which('cat')} "$U" || bad hand-on\n  ${which('rm')} -f "$T" "$U" || bad rm\n  if [ "$rc" = 1 ]; then echo changed > ${cnt}.chg || bad mark; fi\n  exit 0\nfi\nexec ${real} "$@"`;
    toolPath = makeBin(root, { shim: { [tool]: shim } });
    const r = check(body, HEAD, emit ? EMIT : null);
    let calls = 0;
    try { calls = Number(readFileSync(cnt, 'utf8').trim()); } catch { /* the tool was not called */ }
    assert.ok(!existsSync(`${cnt}.err`), `the shim's own command failed (${tool} call ${n}, k=${k}): ${existsSync(`${cnt}.err`) ? readFileSync(`${cnt}.err`, 'utf8') : ''}`);
    return { ...r, calls, changed: existsSync(`${cnt}.chg`) };
  };
  let runs = 0;
  const cutCalls = Object.fromEntries(SWEPT.map((t) => [t, new Set()]));
  const allCalls = Object.fromEntries(SWEPT.map((t) => [t, new Set()]));
  const started = Date.now();
  for (const tool of SWEPT) {
    for (const [what, body, truth, emit] of BODIES) {
      it(`${tool}: every call cut by 1, 2 or all lines: ${what} is exit 2 or unchanged`, () => {
        const base = run(tool, 0, 1, body, emit);
        assert.equal(base.status, truth, `the untruncated run: ${base.out}`);
        if (emit) assert.equal(base.emit !== null, truth === 0, 'the emit file exists exactly when the verdict is 0');
        assert.ok(base.calls >= 1, `${tool} is not called for ${what}`);
        for (let n = 1; n <= base.calls; n += 1) {
          for (const k of [1, 2, 'all']) {
            runs += 1;
            const r = run(tool, n, k, body, emit);
            const label = `${tool} call ${n} of ${base.calls}, last ${k} line(s) dropped`;
            allCalls[tool].add(`${what}#${n}`);
            if (r.changed) {
              cutCalls[tool].add(`${what}#${n}`);
              assert.equal(r.status, 2, `${label}: the output of the call was cut, and the result is not exit 2: ${r.out}`);
              assert.ok(r.out.includes('could not run'), `${label}: ${r.out}`);
              assert.ok(!r.out.includes('matches the head') && !r.out.includes('review record: FAILED'), `${label}: ${r.out}`);
              if (emit) assert.equal(r.emit, null, `${label}: an emit file is left after exit 2`);
            } else {
              assert.equal(r.status, truth, `${label}: nothing was cut, and the verdict changed: ${r.out}`);
              assert.equal(r.out, base.out, `${label}: nothing was cut, and the output changed`);
              if (emit) assert.equal(r.emit, base.emit, `${label}: nothing was cut, and the emit file changed`);
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

