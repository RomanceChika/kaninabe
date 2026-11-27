/**
 * Tests of scripts/scan-pr-text.sh: the title and body that a squash merge turns into a commit message. Each failing
 * case asserts the name of its rule; the word list is required where the gate needs it; no output quotes the text.
 * Strings the scans look for are built in helpers.mjs, never written in one piece here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OWNER, WORD, home, mail, ownerMail, runText, tempDir, textScript, wordList } from './helpers.mjs';

/** Runs the scan on `text` with a word list written into a temp directory. */
function withWords(text, words, opts = {}) {
  const dir = tempDir();
  try {
    const env = { ...(words === undefined ? {} : { SCAN_WORDS_FILE: wordList(dir, words) }), ...(opts.env ?? {}) };
    return runText(text, { args: opts.args, env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const failsWith = (text, rule, opts = {}) => {
  const r = withWords(text, opts.words, opts);
  assert.equal(r.status, 1, `${rule}: ${r.out}`);
  assert.ok(r.out.includes(rule), `should fail with "${rule}", got: ${r.out}`);
  return r.out;
};
const ok = (text, opts = {}) => {
  const r = withWords(text, opts.words, opts);
  assert.equal(r.status, 0, r.out);
  assert.ok(r.out.includes('scan-pr-text: clean'), r.out);
  return r.out;
};
const BODY = 'Add a thing\n\nIt does one job.\n';

describe('scan-pr-text.sh: the word list', () => {
  it('says the list was not used when there is none, and runs the other rules', () => {
    assert.ok(ok(BODY).includes('word list: NOT USED'));
    failsWith(`${BODY}see ${home('Alice')}\n`, 'local path or key shape: pull request title or body');
  });

  it('stops at the entrance when the list is required (flag or environment) and missing, unreadable, empty or only comments', () => {
    const gate = (r, text) => { assert.equal(r.status, 2, r.out); assert.ok(r.out.includes(text), r.out); };
    gate(runText(BODY, { args: ['--require-words'] }), 'word list is required');
    gate(runText(BODY, { env: { SCAN_REQUIRE_WORDS: '1' } }), 'word list is required');
    gate(withWords(BODY, undefined, { args: ['--require-words'] }), 'word list is required');
    gate(runText(BODY, { args: ['--require-words'], env: { SCAN_WORDS_FILE: path.join(tempDir(), 'none') } }), 'word list cannot be read');
    gate(withWords(BODY, '', { args: ['--require-words'] }), 'holds no pattern');
    gate(withWords(BODY, '# comment\n\n', { args: ['--require-words'] }), 'holds no pattern');
    gate(withWords(BODY, `@docs ${WORD}\n`, { args: ['--require-words'] }), 'holds no plain pattern');
    // Named but unreadable or empty is an error even when the list is not required.
    gate(runText(BODY, { env: { SCAN_WORDS_FILE: path.join(tempDir(), 'none') } }), 'word list cannot be read');
    gate(withWords(BODY, ''), 'holds no pattern');
    gate(withWords(BODY, Buffer.from(`${WORD}\0`)), 'holds a NUL byte');
    ok(BODY, { words: `${WORD}\n`, args: ['--require-words'] });
  });

  it('finds a word case-insensitively, with CRLF in the list, a leading dash, and prints no word', () => {
    const out = failsWith(`${BODY}${WORD.toUpperCase()}\n`, 'word list: pull request title or body', { words: `# c\r\n${WORD}\r\n` });
    assert.ok(!out.toLowerCase().includes(WORD), out);
    failsWith(`${BODY}x -${WORD}\n`, 'word list: pull request title or body', { words: `-${WORD}\n` });
    failsWith(`${BODY}${WORD}\n`, 'word list: pull request title or body', { words: `\ufeff${WORD}\n` });
  });

  it('exits 2 on a pattern grep cannot compile', () => {
    for (const bad of ['(', '[[:foo:]]']) {
      const r = withWords(BODY, `${WORD}\n${bad}\n`);
      assert.equal(r.status, 2, r.out);
      assert.ok(r.out.includes('scan-pr-text: ERROR'), r.out);
    }
  });

  it('exits 2 on an unreadable input or a bad call', () => {
    const dir = tempDir();
    try {
      for (const args of [[path.join(dir, 'none')], [], ['--bogus', path.join(dir, 'x')]]) {
        const r = spawnSync('sh', [textScript, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
        assert.equal(r.status, 2, r.stdout + r.stderr);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('scan-pr-text.sh: attribution, paths, emails and bytes', () => {
  it('fails on any co-author trailer, whoever the owner is', () => {
    failsWith(`${BODY}\nCo-authored-by: Dev <${ownerMail('1+')}>\n`, 'attribution line: pull request title or body', { env: { SCAN_OWNER: OWNER } });
  });

  it('fails on a link to any AI session, share page or task, and on the phrasings', () => {
    for (const t of ['https://claude.ai/code/session_01abc', 'https://claude.ai/chat/0000', 'https://claude.ai/share/0000', 'https://chatgpt.com/codex/tasks/task_e_1',
      'https://chatgpt.com/share/0000', 'https://chat.openai.com/share/0000', 'https://gemini.google.com/share/0000', 'Written with GPT-5', 'Generated using a model',
      'Assisted-by: GPT 5', 'Generated with Claude Code']) {
      failsWith(`${BODY}\n${t}\n`, 'attribution line: pull request title or body');
    }
    ok(`${BODY}\nSee https://example.com/docs and the Claude Code docs by name.\n`);
  });

  it('fails on a local path, a key shape or an email-like string, and passes the placeholders', () => {
    for (const s of [home('Alice'), home('bob2', ''), `/ro${'ot'}/x`, `/tmp/clau${'de'}-1`, 'C:\\Users\\Eve']) {
      failsWith(`${BODY}${s}\n`, 'local path or key shape: pull request title or body');
    }
    for (const e of [mail('evilson', 'mailbox.co'), mail('a', '163.com'), mail('a', 'exampleco.com'), mail('a', 'evil.example.io')]) {
      failsWith(`${BODY}${e}\n`, 'email-like string: pull request title or body');
    }
    ok(`${BODY}${home('runner')} ${mail('a', 'example.com')} ${mail('pkg', '1.2.3')}\n`);
  });

  it('fails on a NUL byte, which would hide the rest of a line from the scans', () => {
    failsWith(Buffer.from(`${BODY}fine\0Generated with x\n`), 'NUL byte: pull request title or body');
  });
});
