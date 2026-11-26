/**
 * Tests of scripts/check-review-record.sh: a record that names the head passes; a stale, missing, doubled or
 * malformed record fails; and every body in which what a reader sees could differ from what is counted fails
 * (comments, raw-text tags, fences that hide or reveal the section, record lines before the section).
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

describe('check-review-record.sh', () => {
  it('passes when both lines name the head, also with CRLF and code before the section', () => {
    assert.equal(check(`## 何を変えたか\n\n本文\n\n${record()}`).status, 0);
    assert.equal(check(`x\r\n\r\n## Review\r\n- opus: ${HEAD}\r\n- codex: ${HEAD}\r\n`).status, 0);
    assert.equal(check(`\`\`\`sh\necho hi\n\`\`\`\n\n${record()}`).status, 0);
    assert.equal(check(`\`\`\`\`\n\`\`\`\n\`\`\`\n\`\`\`\`\n${record()}`).status, 0);
  });

  it('fails on a stale, empty, short or doubled record', () => {
    for (const body of [record(OLD), record(HEAD, OLD), record('', ''), record(HEAD.slice(0, 39)), record(HEAD.toUpperCase()),
      `${record()}- opus: ${HEAD}\n`, `${record()}\n${record()}`, 'no record\n']) {
      assert.equal(check(body).status, 1, JSON.stringify(body));
    }
  });

  it('fails when the section is not the last one or holds anything else', () => {
    assert.equal(check(`${record()}\n## 後書き\n`).status, 1);
    assert.equal(check(`${record()}メモ\n`).status, 1);
    assert.equal(check(`## Review\n<!-- x -->\n- opus: ${HEAD}\n- codex: ${HEAD}\n`).status, 1);
  });

  it('fails on comments and raw-text tags anywhere, so hidden text cannot be counted', () => {
    for (const body of [`<!-- ${record(OLD)} -->\n${record()}`, `<!--\n${record()}`, `\`<!--\`\n${record()}`,
      `<!-- x -->${record()}`, `<script>\n${record(OLD)}</script>\n${record()}`, `<PRE>\n${record()}`]) {
      assert.equal(check(body).status, 1, JSON.stringify(body));
    }
  });

  it('tracks fences by character and length, and fails when the section sits inside one', () => {
    for (const body of [`\`\`\`\n${record()}\`\`\`\n`, `\`\`\`\`\n\`\`\`\n${record()}`, `\`\`\`\n~~~\n${record()}`,
      `~~~\n\`\`\`\n${record()}`]) {
      assert.equal(check(body).status, 1, JSON.stringify(body));
    }
  });

  it('fails on a record-like line before the section, even in a fence', () => {
    for (const body of [`- opus: ${OLD}\n${record()}`, `\`\`\`\n- codex: ${HEAD}\n\`\`\`\n${record()}`, `> * Opus: x\n${record()}`]) {
      assert.equal(check(body).status, 1, JSON.stringify(body));
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
