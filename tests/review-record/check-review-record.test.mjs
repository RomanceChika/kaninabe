/**
 * Tests of scripts/check-review-record.sh: a record that names the head passes; a stale, missing, doubled or
 * malformed record fails; and every body in which what a reader sees could differ from what is counted fails
 * (HTML, stray carriage returns, invisible characters, fences that hide the section, record lines before it),
 * and each failing body fails for the rule it is meant to show.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-review-record.sh', import.meta.url));
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const record = (o = HEAD, c = HEAD) => `## Review\n- opus: ${o}\n- codex: ${c}\n`;

/** Runs the script on `body` against `head`; returns the exit status and output. */
function check(body, head = HEAD) {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-record-'));
  try {
    const file = path.join(dir, 'body');
    writeFileSync(file, body);
    const r = spawnSync('sh', [script, file, head], { encoding: 'utf8' });
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

describe('check-review-record.sh', () => {
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
    failsWith(`## Revi​ew\n- opus: ${HEAD}\n- codex: ${HEAD}\n${record()}`, 'invisible character');
    failsWith(`﻿${record()}`, 'invisible character');
    failsWith(`a‮b\n${record()}`, 'invisible character');
  });

  it('tracks fences by character and length, and fails when the section sits inside one', () => {
    for (const body of [`\`\`\`\n${record()}\`\`\`\n`, `\`\`\`\`\n\`\`\`\n${record()}`, `\`\`\`\n~~~\n${record()}`,
      `~~~\n\`\`\`\n${record()}`, `~~~\n${record()}`, `   ~~~~\n~~~\n${record()}`]) {
      failsWith(body, INFENCE);
    }
    assert.equal(check(`    \`\`\`\n${record()}`).status, 0, 'four spaces is indented code, not a fence');
  });

  it('fails on a record-like line before the section, even in a fence or other markup', () => {
    for (const body of [`- opus: ${OLD}\n${record()}`, `\`\`\`\n- codex: ${HEAD}\n\`\`\`\n${record()}`, `> * Opus: x\n${record()}`,
      `1. opus: ${OLD}\n${record()}`, `- **opus**: ${OLD}\n${record()}`]) {
      failsWith(body, BEFORE);
    }
  });

  it('exits 2 on a malformed head or an unreadable body, and never prints the body', () => {
    assert.equal(check(record(), 'xyz').status, 2);
    assert.equal(check(record(), `${HEAD}\n${HEAD}`).status, 2);
    assert.equal(spawnSync('sh', [script, '/nonexistent/body', HEAD]).status, 2);
    const r = check(`秘密の語\n${record(OLD)}`);
    assert.ok(!r.out.includes('秘密の語') && !r.out.includes(OLD), r.out);
  });
});
