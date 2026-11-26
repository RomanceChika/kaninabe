/**
 * Tests of scripts/scan-public.sh over throwaway repositories. Each failing case asserts the name of the rule it is
 * meant to trip, and every output is checked for what must never be printed (a word of the list, a path of a hit).
 * Strings the scans look for are built in helpers.mjs, never written in one piece here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OWNER, publicScript, WEB_FLOW, WORD, git, home, mail, makeRepo, ownerMail, runPublic, tempDir, wordList } from './helpers.mjs';

/** Runs `fn(dir)` on a repository made from `commits`, and removes it. */
function withRepo(commits, fn) {
  const dir = makeRepo(commits);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Asserts that scanning `commits` fails (exit 1) with `rule` in the output; returns the output. */
function fails(commits, rule, opts = {}) {
  return withRepo(commits, (dir) => {
    const env = { ...(opts.words ? { SCAN_WORDS_FILE: wordList(dir, opts.words) } : {}), ...(opts.env ?? {}) };
    const r = runPublic(opts.cwd ? path.join(dir, opts.cwd) : dir, { args: opts.args, env });
    assert.equal(r.status, 1, `${rule}: ${r.out}`);
    assert.ok(r.out.includes(rule), `should fail with "${rule}", got: ${r.out}`);
    return r.out;
  });
}

/** Asserts that scanning `commits` is clean. */
function clean(commits, opts = {}) {
  withRepo(commits, (dir) => {
    const env = { ...(opts.words ? { SCAN_WORDS_FILE: wordList(dir, opts.words) } : {}), ...(opts.env ?? {}) };
    const r = runPublic(dir, { args: opts.args, env });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('scan-public: clean'), r.out);
  });
}

const msg = (message, extra = {}) => [{ files: { 'a.txt': 'hello\n' }, message, ...extra }];
const file = (name, content) => [{ files: { [name]: content } }];
const withOwner = { env: { SCAN_OWNER: OWNER } };

describe('scan-public.sh: the setup', () => {
  it('is clean on an ordinary history, and says the word list was not used', () => {
    withRepo(msg('Add a greeting'), (dir) => {
      const r = runPublic(dir);
      assert.equal(r.status, 0, r.out);
      assert.ok(r.out.includes('word list: NOT USED'), r.out);
      assert.ok(r.out.includes('scan-public: clean'), r.out);
    });
  });

  it('exits 2 when a word list is required and missing, empty, unreadable or holds nothing but comments', () => {
    withRepo(msg('x'), (dir) => {
      for (const args of [['--require-words']]) {
        const r = runPublic(dir, { args });
        assert.equal(r.status, 2, r.out);
        assert.ok(r.out.includes('word list is required'), r.out);
      }
      const r2 = runPublic(dir, { env: { SCAN_REQUIRE_WORDS: '1' } });
      assert.equal(r2.status, 2, r2.out);
      assert.ok(r2.out.includes('word list is required'), r2.out);
      const missing = runPublic(dir, { env: { SCAN_WORDS_FILE: path.join(dir, 'no-such-list') } });
      assert.equal(missing.status, 2, missing.out);
      assert.ok(missing.out.includes('word list cannot be read'), missing.out);
      const empty = runPublic(dir, { env: { SCAN_WORDS_FILE: wordList(dir, '') } });
      assert.equal(empty.status, 2, empty.out);
      assert.ok(empty.out.includes('holds no pattern'), empty.out);
      const comments = runPublic(dir, { env: { SCAN_WORDS_FILE: wordList(dir, '# only a comment\n\n') } });
      assert.equal(comments.status, 2, comments.out);
      assert.ok(comments.out.includes('holds no pattern'), comments.out);
      const nul = runPublic(dir, { env: { SCAN_WORDS_FILE: wordList(dir, Buffer.from(`${WORD}\0\n`)) } });
      assert.equal(nul.status, 2, nul.out);
      assert.ok(nul.out.includes('holds a NUL byte'), nul.out);
    });
  });

  it('exits 2 on a pattern that grep or git grep cannot compile, and prints neither the pattern nor an error text', () => {
    // `a{1` and `*a` are accepted by grep -E and refused by git grep: the grammars differ, so both are asked.
    for (const bad of ['(', '[[:foo:]]', 'a{1', '*a']) {
      withRepo(msg('x'), (dir) => {
        const r = runPublic(dir, { env: { SCAN_WORDS_FILE: wordList(dir, `${WORD}\n${bad}\n`) } });
        assert.equal(r.status, 2, `${bad}: ${r.out}`);
        assert.ok(r.out.includes('scan-public: ERROR'), r.out);
        assert.ok(!r.out.includes(WORD) && !r.out.includes('foo') && !r.out.includes('a{1'), r.out);
      });
    }
  });

  it('exits 2 when the history cannot be listed, and on a shallow clone', () => {
    withRepo(msg('x'), (dir) => {
      const r = runPublic(dir, { args: ['no-such-base'] });
      assert.equal(r.status, 2, r.out);
      assert.ok(r.out.includes('git rev-list failed'), r.out);
      assert.equal(runPublic(dir, { args: ['--oops'] }).status, 2);
      const outside = tempDir();
      try {
        const o = runPublic(outside);
        assert.equal(o.status, 2, o.out);
        assert.ok(o.out.includes('not inside a git repository'), o.out);
      } finally { rmSync(outside, { recursive: true, force: true }); }
    });
    withRepo([...msg('one'), ...msg('two')], (dir) => {
      const shallow = tempDir();
      try {
        git(shallow, ['clone', '-q', '--depth', '1', `file://${dir}`, 'c']);
        const r = runPublic(path.join(shallow, 'c'));
        assert.equal(r.status, 2, r.out);
        assert.ok(r.out.includes('shallow clone'), r.out);
      } finally { rmSync(shallow, { recursive: true, force: true }); }
    });
  });

  it('scans <base>..HEAD when a base is given, and the whole tree even from a subdirectory', () => {
    const commits = [{ files: { 'old.txt': 'x' }, message: WORD }, { files: { 'new.txt': 'fine' } }];
    withRepo(commits, (dir) => {
      const base = git(dir, ['rev-parse', 'HEAD~1']);
      const env = { SCAN_WORDS_FILE: wordList(dir, WORD) };
      assert.equal(runPublic(dir, { args: [base], env }).status, 0);
      assert.equal(runPublic(dir, { env }).status, 1);
    });
    fails([{ files: { 'sub/ok.txt': 'fine', 'top.txt': WORD } }], 'word list: 1 file(s)', { words: WORD, cwd: 'sub' });
  });

  it('fails when a NUL byte hides a commit message from the line scans', () => {
    withRepo(msg('x'), (dir) => {
      const tree = git(dir, ['rev-parse', 'HEAD^{tree}']);
      const who = `Dev <${ownerMail()}> 1700000000 +0000`;
      const raw = `tree ${tree}\nauthor ${who}\ncommitter ${who}\n\nfine\0Generated with a tool\n`;
      const sha = git(dir, ['hash-object', '-t', 'commit', '-w', '--literally', '--stdin'], {}, raw);
      git(dir, ['update-ref', 'HEAD', sha]);
      const r = runPublic(dir);
      assert.equal(r.status, 1, r.out);
      assert.ok(r.out.includes('NUL byte: the message of'), r.out);
    });
  });
});

describe('scan-public.sh: the word list', () => {
  it('finds a word in any file, case-insensitively, and prints only a rule and a count', () => {
    const out = fails(file(`dir/${WORD}.txt`, `x ${WORD.toUpperCase()} y\n`), 'word list: 1 file(s)', { words: `${WORD}\n` });
    assert.ok(!out.toLowerCase().includes(WORD) && !out.includes('dir/'), out);
  });

  it('reads a file that git treats as binary: -diff, binary, NUL, long lines', () => {
    const cases = {
      '.gitattributes': '*.dat -diff\n*.bin binary\n',
      'a.dat': `${WORD}\n`,
      'b.bin': `\0\0${WORD}\0\0`,
      'c.txt': `ok\0${WORD}`,
      'd.txt': `${'x'.repeat(20000)}${WORD}`,
    };
    for (const [name, body] of Object.entries(cases).filter(([n]) => n !== '.gitattributes')) {
      fails([{ files: { '.gitattributes': cases['.gitattributes'], [name]: body } }], 'word list: 1 file(s)', { words: WORD });
    }
    clean([{ files: { 'a.dat': 'nothing\n' } }], { words: WORD });
  });

  it('fails on a file that starts with a UTF-16 byte order mark, little- or big-endian, and says so by rule only', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${WORD}\n`, 'utf16le')]);
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(`${WORD}\n`, 'utf16le').swap16()]);
    for (const body of [le, be]) {
      const out = fails(file('secret-name.txt', body), 'a UTF-16 file cannot be scanned: 1 file(s)', { words: WORD });
      assert.ok(!out.includes('secret-name'), out);
    }
    // Without a word list the rule still applies: the file is unreadable to every rule.
    fails(file('x.txt', le), 'a UTF-16 file cannot be scanned');
    clean(file('x.txt', Buffer.from([0xff, 0x41, 0x0a])));
  });

  it('reads a word list with CRLF, a byte order mark, comments and blank lines', () => {
    fails(file('a.txt', WORD), 'word list: 1 file(s)', { words: `# note\r\n\r\n${WORD}\r\n` });
    fails(file('a.txt', WORD), 'word list: 1 file(s)', { words: `\ufeff${WORD}\n` });
  });

  it('finds a word in a message, an author name and a committer name', () => {
    fails(msg(`about ${WORD}`), 'word list: the message of', { words: WORD });
    fails(msg('x', { author: [`${WORD} Dev`, ownerMail()] }), 'word list: author or committer of', { words: WORD });
    fails(msg('x', { committer: [`Dev ${WORD}`, ownerMail()] }), 'word list: author or committer of', { words: WORD });
  });

  it('applies a scoped line only under its prefix, with a tab as separator, and a regex that starts with a dash', () => {
    const words = `@docs\t-${WORD}\n`;
    fails(file('docs/a.txt', `x -${WORD} y`), 'scoped word list: 1 file(s)', { words });
    clean(file('src/a.txt', `x -${WORD} y`), { words });
    fails(file('docs/a.txt', WORD.toUpperCase()), 'scoped word list: 1 file(s)', { words: `@docs ${WORD}\n` });
    // A scoped line without a regex is a mistake in the list, not an empty rule.
    withRepo(msg('x'), (dir) => {
      const r = runPublic(dir, { env: { SCAN_WORDS_FILE: wordList(dir, `${WORD}\n@docs\n`) } });
      assert.equal(r.status, 2, r.out);
      assert.ok(r.out.includes('scoped word list line is malformed'), r.out);
    });
  });
});

describe('scan-public.sh: author and committer', () => {
  it('limits both to the owner noreply address and web-flow when the owner is known', () => {
    clean(msg('x', { author: ['Dev', ownerMail('12345+')], committer: ['GitHub', WEB_FLOW] }), withOwner);
    const other = mail('someone', 'users.noreply.github.com');
    fails(msg('x', { author: ['Dev', other] }), 'author or committer not allowed', withOwner);
    fails(msg('x', { committer: ['Dev', other] }), 'author or committer not allowed', withOwner);
    fails(msg('x', { author: ['Dev', mail('dev', 'example.com')] }), 'author or committer not allowed', withOwner);
    fails(msg('x', { author: ['Dev', mail(`${OWNER}x`, 'users.noreply.github.com')] }), 'author or committer not allowed', withOwner);
    // The owner comes from the Actions variable too.
    fails(msg('x', { author: ['Dev', other] }), 'author or committer not allowed', { env: { GITHUB_REPOSITORY_OWNER: OWNER } });
  });

  it('allows any GitHub noreply address, and nothing else, when no owner is known', () => {
    clean(msg('x', { author: ['Dev', mail('someone', 'users.noreply.github.com')] }));
    fails(msg('x', { author: ['Dev', mail('dev', 'example.com')] }), 'author or committer not allowed');
    fails(msg('x', { author: ['Dev', mail('x', 'users.noreply.github.com.evil.example')] }), 'author or committer not allowed');
  });

  it('fails on an AI or bot in a name or in the local part of a noreply address', () => {
    for (const author of [['Claude', ownerMail()], ['Dev GPT', ownerMail()], ['llm helper', ownerMail()], ['Dev', mail('12+Copilot', 'users.noreply.github.com')],
      ['dependabot[bot]', ownerMail()], ['Dev', mail('49+dependabot[bot]', 'users.noreply.github.com')], ['aider', ownerMail()]]) {
      fails(msg('x', { author }), 'author or committer names an AI');
    }
    clean(msg('x', { author: ['Alice Botha', ownerMail()] }));
  });

  it('fails on an email inside the name', () => {
    fails(msg('x', { author: [`Dev ${mail('a', 'example.com')}`, ownerMail()] }), 'name holds an email-like string');
    fails(msg('x', { committer: [`${mail('dev', 'x')}`, ownerMail()] }), 'name holds an email-like string');
  });
});

describe('scan-public.sh: attribution in a message', () => {
  const link = (host, rest) => `https://${host}/${rest}`;
  it('fails on a session, share or task link of any AI chat or agent service', () => {
    for (const url of [link('claude.ai', 'code/session_01abc'), link('claude.ai', 'chat/0000'), link('claude.ai', 'share/0000'), link('claude.ai', 'code/scheduled/x'),
      link('chatgpt.com', 'codex/tasks/task_e_1'), link('chatgpt.com', 'share/0000'), link('chatgpt.com', 'c/0000'), link('chat.openai.com', 'share/0000'),
      link('gemini.google.com', 'share/0000'), link('g.co', 'gemini/share/0000'), link('aistudio.google.com', 'prompts/0000'), link('www.perplexity.ai', 'search/x'),
      link('copilot.microsoft.com', 'shares/x'), link('grok.com', 'share/x'), link('app.devin.ai', 'sessions/x'), 'claude.ai/new', link('openai.com', 'share/x')]) {
      fails(msg(`Fix\n\nSee ${url}\n`), 'attribution line: the message of');
    }
    clean(msg('Fix\n\nSee https://example.com/claude.ai and notclaude.ai/x\n'));
    clean(msg('Fix\n\nhttps://claude.ai/\n'));
  });

  it('fails on a phrasing that credits an AI, and on any -by: trailer naming one', () => {
    for (const m of ['Written with GPT-5', 'Generated using a model', 'Generated by a tool', 'Assisted-by: GPT 5', 'Reviewed-by: Aider', 'Created with the help of Copilot',
      'Made by Gemini', 'Co-authored-by: Dev <x>', 'Claude-Session: x', 'Signed-off-by:Claude']) {
      fails(msg(`Fix\n\n${m}\n`), 'attribution line: the message of');
    }
    clean(msg('Fix\n\nWritten with care. Reviewed-by: Alice Botha\n'));
  });

  it('allows only the owner own co-author trailer after a squash merge, and only when the owner is known', () => {
    const trailer = (name, email) => `Fix\n\nCo-authored-by: ${name} <${email}>\n`;
    clean(msg(trailer('Dev', ownerMail('12345+'))), withOwner);
    fails(msg(trailer('Dev', ownerMail('12345+'))), 'attribution line');
    fails(msg(trailer('Dev', mail('other', 'users.noreply.github.com'))), 'attribution line', withOwner);
    fails(msg(trailer('Claude', ownerMail('1+'))), 'attribution line', withOwner);
    fails(msg(`${trailer('Dev', ownerMail('1+'))}\nGenerated with x\n`), 'attribution line', withOwner);
  });
});

describe('scan-public.sh: email-like strings', () => {
  const bad = [['john.example', 'mailbox.co'], ['evilson', 'mailbox.co'], ['alice', 'next.co.jp'], ['a', '163.com'], ['a', 'exampleco.com'], ['a', 'evil.example.io'],
    ['a', 'example.com.evil.io'], ['a', 'supabase.io'], ['a', 'x.md'], ['a', 'users.noreply.github.com.evil.io'], ['a', '1.2.3.com'], ['git', 'github.com.evil.io'],
    ['a', 'auth.external.evil.io']].map(([l, d]) => mail(l, d));
  const good = [['a', 'example.com'], ['a', 'sub.example.org'], ['a', 'b.example'], ['a', 'users.noreply.github.com'], ['git', 'github.com'], ['pkg', '1.2.3'],
    ['pkg', '63.1'], ['db', '127.0.0.1'], ['a', 'registry.npmjs.org']].map(([l, d]) => mail(l, d));

  it('fails on a look-alike or an ordinary address, in the tree and in a message', () => {
    for (const e of bad) {
      fails(file('a.txt', `contact ${e} now\n`), 'email-like string: 1 hit(s) in');
      fails(msg(`Fix\n\ncontact ${e}\n`), 'email-like string: the message of');
    }
    fails(file('a.txt', `x${String.fromCharCode(0xff20)}y.example.com`.replace('x', 'ab')), 'email-like string: 1 hit(s) in');
    fails(msg(`Fix\n\nab${String.fromCharCode(0xff20)}mailbox.co`), 'email-like string: the message of');
  });

  it('allows the reserved and fixed shapes, anchored', () => {
    for (const e of good) {
      clean(file('a.txt', `contact ${e} now\n`));
      clean(msg(`Fix\n\ncontact ${e}.\n`));
    }
  });
});

describe('scan-public.sh: local paths and keys', () => {
  const root = `/ro${'ot'}/`;
  const shapes = [home('Alice'), home('bob2'), home('Carol', ''), `${root}.ssh`, `/tmp/clau${'de'}-1/x`, `/Us${'ers'}/Dave/x`, 'C:\\Users\\Eve', 'c:\\users\\eve', `D:/Us${'ers'}/Eve`,
    `-----BEGIN RSA PRIV${'ATE'} KEY-----`];
  it('fails on any user directory, the root home, a tool temp directory and a private key, in the tree and in a message', () => {
    for (const s of shapes) {
      fails(file('a.txt', `see ${s} here\n`), 'local path or key shape: 1 hit(s) in');
      fails(msg(`Fix\n\nsee ${s}\n`), 'local path or key shape: the message of');
    }
  });
  it('allows the placeholder users and ordinary words', () => {
    clean(file('a.txt', `${home('runner')} ${home('user', '/')} src/${'ro'}ot/x ./${'ro'}ot/ /usr/home\n`));
  });
});

describe('scan-public.sh: files git treats as binary', () => {
  const attrs = '*.dat -diff\n';
  it('counts the paths and emails inside them one by one, and passes the placeholders', () => {
    const two = `\0${mail('a', 'mailbox.co')}\0${mail('b', 'mailbox.co')}\0`;
    fails([{ files: { '.gitattributes': attrs, 'x.dat': two } }], 'email-like string: 2 hit(s) in');
    fails([{ files: { 'x.bin': `\0\0${home('Alice')}\0` } }], 'local path or key shape: 1 hit(s) in');
    clean([{ files: { '.gitattributes': attrs, 'x.dat': `\0${mail('a', 'example.com')}\0${home('runner')}\0` } }]);
  });
});

describe('scan-public.sh: output', () => {
  it('prints no word and no path of a hit, whatever the rule', () => {
    const out = fails([{ files: { [`${WORD}-dir/${WORD}.txt`]: `${WORD} ${home('Alice')} ${mail('a', 'mailbox.co')}` } }], 'word list: 1 file(s)', { words: WORD });
    for (const s of [WORD, 'Alice', 'mailbox', '-dir/']) assert.ok(!out.includes(s), `${s} in ${out}`);
  });
  it('runs the same way when the script is called through a relative path', () => {
    withRepo(msg('x'), (dir) => {
      const r = spawnSync('sh', [path.relative(dir, publicScript)], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
      assert.equal(r.status, 0, r.stdout + r.stderr);
    });
  });
});
