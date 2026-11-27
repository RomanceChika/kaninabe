/**
 * Tests of scripts/check-review-record.sh: a record that names the head passes; a stale, missing, doubled or
 * malformed record fails; and every body in which what a reader sees could differ from what is counted fails
 * (HTML, stray carriage returns, invisible characters, fences that hide the section, record lines before it),
 * and each failing body fails for the rule it is meant to show.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

/** Runs the script on `body` against `head`; returns the exit status and output. */
function check(body, head = HEAD) {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-record-'));
  try {
    const file = path.join(dir, 'body');
    writeFileSync(file, body);
    const r = spawnSync('/bin/sh', [script, file, head], { encoding: 'utf8', env: envOf() });
    return { status: r.status, out: r.stdout + r.stderr };
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

const TAG = 'HTML tag or comment';
const LAST = 'must be the last one';
const BEFORE = 'record line appears before';
const INFENCE = 'inside fenced code';

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
/** A directory with only the tools the script needs: `awk` is the given program (a path, or ['busybox', 'awk']); `omit` names tools left out; `shim` maps a tool to a shell body. */
function makeBin(root, { awk = which('awk'), omit = [], shim = {} } = {}) {
  const bin = path.join(root, `bin-${Math.random().toString(36).slice(2)}`);
  mkdirSync(bin);
  const put = (name, body) => { writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  for (const n of TOOLS) {
    if (omit.includes(n)) continue;
    if (shim[n] !== undefined) put(n, shim[n]);
    else symlinkSync(which(n), path.join(bin, n));
  }
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
  for (const tool of ['awk', ...TOOLS.filter((n) => n !== 'rm')]) {
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
