/**
 * The one exclusion list of the scans (scripts/scan-exclusions.tsv) and the rule that there is no other way to skip a file.
 *
 * The grammar: one entry per line, four fields separated by a tab, `kind<TAB>path<TAB>value<TAB>reason`. No blank line, no
 * comment line, no carriage return.
 *   - path: literal and relative. No `*`, `?`, `[` or `]`, no leading `/`, no trailing `/`, no empty, `.` or `..` segment
 *     (so no `./x` and no `a//b`), no control character (a name with a tab, a line feed or a byte that is not UTF-8 cannot be
 *     written here, so it is exit 2 as a file name). The path need not exist any more: history still holds the file.
 *   - kind `binary`: value is the blob id (40 lowercase hex digits); content that changed is red again.
 *   - kind `keys`: value is the blob id too; the key scan skips that one content at that one path (a changed file is scanned
 *     again). It silences nothing else: a mail string, a word of the list or an unreadable file at that path stays red.
 *   - kind `mail`: value is `sha256:<64 lowercase hex digits>` of the exact string (the list holds no address).
 *   - reason: not empty.
 * Only an EXACT duplicate line (same kind, path and value) is refused. Several `mail` lines for one path and several `binary`
 * lines for one path (one per blob over the history) are valid.
 * A line that does not fit, an unknown kind, an exact duplicate and a missing list file stop the gate with exit 2. An empty
 * file is a valid empty list. The list is read from the gate's own scripts directory (next to push-gate.sh), never from the
 * scanned tree and never from the environment: a test that needs a list runs a copy of the scripts directory with the list
 * written into the copy.
 *
 * "No other mechanism" is checked two ways: the vendored gitleaks configuration holds no global allowlist and its rules are the
 * pinned version's default rules, and no script contains a pathspec, an `--exclude` or a glob that skips files.
 *
 * Fake keys are assembled at run time and written only into throwaway repositories.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scriptsDir = path.join(root, 'scripts');
const LIST = path.join(scriptsDir, 'scan-exclusions.tsv');

// ---- the grammar ----

/** The problems of one line of the list (an empty array = a valid line). */
export function problems(line) {
  if (line.includes('\r')) return ['carriage return'];
  const f = line.split('\t');
  if (f.length !== 4) return [`${f.length} fields, not 4`];
  const [kind, p, value, reason] = f;
  const out = [];
  if (!['binary', 'mail', 'keys'].includes(kind)) out.push('unknown kind');
  if (p === '') out.push('empty path');
  if (/[*?[\]]/.test(p)) out.push('glob character in the path');
  if (p.startsWith('/')) out.push('leading slash');
  if (p.endsWith('/')) out.push('trailing slash');
  if (p !== '' && p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) out.push('empty, . or .. segment in the path');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) out.push('control character in the path');
  if ((kind === 'binary' || kind === 'keys') && !/^[0-9a-f]{40}$/.test(value)) out.push(`${kind} value is not a blob id`);
  if (kind === 'mail' && !/^sha256:[0-9a-f]{64}$/.test(value)) out.push('mail value is not sha256:<hex>');
  if (reason.trim() === '') out.push('empty reason');
  return out;
}
/** The problems of a whole list: each line, and exact duplicates (kind, path and value). */
export function listProblems(text) {
  if (text === '') return [];
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  const out = lines.flatMap((l, i) => problems(l).map((m) => `line ${i + 1}: ${m}`));
  const seen = new Set();
  lines.forEach((l, i) => {
    const key = l.split('\t').slice(0, 3).join('\t');
    if (seen.has(key)) out.push(`line ${i + 1}: exact duplicate`);
    seen.add(key);
  });
  return out;
}

const H40 = 'a'.repeat(40);
const H64 = 'b'.repeat(64);
const VALID = [
  `binary\tassets/blob.bin\t${H40}\ta made-up binary fixture`,
  `mail\tdocs/contact.txt\tsha256:${H64}\ta made-up address in a made-up fixture`,
  `keys\tfixtures/sample.txt\t${H40}\ta made-up key in a made-up fixture`,
  `binary\tassets/blob.bin\t${'c'.repeat(40)}\tthe next blob at the same path`,
  `mail\tdocs/contact.txt\tsha256:${'d'.repeat(64)}\ta second string in the same file`,
];
const K = `\t${H40}\treason`;
const MALFORMED = {
  'too few fields': 'keys\tfixtures/sample.txt',
  'too many fields': `keys\tfixtures/sample.txt${K}\textra`,
  'a tab inside the path': `keys\tfixtures/sam\tple.txt${K}`,
  'a tab inside the reason': `keys\tfixtures/sample.txt\t${H40}\tre\tason`,
  'unknown kind': `other\tfixtures/sample.txt${K}`,
  'a glob (*)': `keys\tfixtures/*.txt${K}`,
  'a glob (?)': `keys\tfixtures/sample?.txt${K}`,
  'a glob ([)': `keys\tfixtures/sample[1].txt${K}`,
  'a leading slash': `keys\t/fixtures/sample.txt${K}`,
  'a .. segment': `keys\tfixtures/../sample.txt${K}`,
  'a . segment (./x)': `keys\t./x${K}`,
  'an empty segment (a//b)': `keys\ta//b${K}`,
  'a trailing slash': `keys\tfixtures/${K}`,
  'an empty path': `keys\t${K}`,
  'a blank line': '',
  'a comment line': '# a comment',
  'a carriage return at the end of the line': `keys\tfixtures/sample.txt${K}\r`,
  'a binary value that is not a blob id': 'binary\tassets/blob.bin\tnot-a-blob-id\treason',
  'a binary value in uppercase hex': `binary\tassets/blob.bin\t${'A'.repeat(40)}\treason`,
  'a keys value that is not a blob id (-)': 'keys\tfixtures/sample.txt\t-\treason',
  'a mail value without the sha256: prefix': `mail\tdocs/contact.txt\t${H64}\treason`,
  'a mail value of the wrong length': 'mail\tdocs/contact.txt\tsha256:abc\treason',
  'a mail value in uppercase hex': `mail\tdocs/contact.txt\tsha256:${'B'.repeat(64)}\treason`,
  'an empty reason': `keys\tfixtures/sample.txt\t${H40}\t`,
};

describe('the grammar of scripts/scan-exclusions.tsv', () => {
  it('(guard) the checker accepts the valid forms and names every malformed one', () => {
    for (const l of VALID) assert.deepEqual(problems(l), [], l);
    for (const [label, l] of Object.entries(MALFORMED)) assert.ok(problems(l).length > 0, `not refused: ${label}`);
  });
  it('(guard) only an exact duplicate is refused: several mail lines or several binary lines for one path are valid', () => {
    assert.deepEqual(listProblems(`${VALID.join('\n')}\n`), []);
    assert.deepEqual(listProblems(''), []);
    assert.deepEqual(listProblems(`${VALID[0]}\n${VALID[0]}\n`), ['line 2: exact duplicate']);
  });

  it('every line of the list is a valid entry, with no exact duplicate', () => {
    assert.ok(existsSync(LIST), 'scripts/scan-exclusions.tsv does not exist: the gate reads its one exclusion list from there');
    assert.deepEqual(listProblems(readFileSync(LIST, 'utf8')), []);
  });
});

// ---- the gate with a list (a small harness, real tools) ----

const CORE = [
  'sh', 'git', 'grep', 'sed', 'cut', 'wc', 'tr', 'head', 'tail', 'mktemp', 'rm', 'cat', 'dirname', 'basename', 'tar',
  'awk', 'sort', 'uniq', 'mkdir', 'ls', 'find', 'env', 'true', 'false', 'cp', 'mv', 'date', 'less', 'sha256sum',
];
const find = (name, searchPath) => {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: { PATH: searchPath } });
  const p = r.stdout.trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
};
const real = { gitleaks: find('gitleaks', process.env.PATH ?? ''), actionlint: find('actionlint', process.env.PATH ?? '') };
const missing = Object.entries(real).filter(([, p]) => !p).map(([n]) => n);
const fakeKey = () => ['gh', 'p_'].join('') + randomBytes(60).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 36).padEnd(36, 'x');

describe('the gate and the list', () => {
  let dir;
  let repo;
  let bin;
  const env = () => ({ PATH: bin, HOME: path.join(dir, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' });
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
      git('add', '--', name);
    }
    git('commit', '-q', '-m', message);
  };
  /** The gate from a copy of the scripts directory with `list` as its scan-exclusions.tsv (the file is removed when `list` is null). */
  const gateWith = (list) => {
    const copy = path.join(dir, 'gate-scripts');
    rmSync(copy, { recursive: true, force: true });
    cpSync(scriptsDir, copy, { recursive: true });
    if (list === null) rmSync(path.join(copy, 'scan-exclusions.tsv'), { force: true });
    else writeFileSync(path.join(copy, 'scan-exclusions.tsv'), list);
    const r = spawnSync('/bin/sh', [path.join(copy, 'push-gate.sh'), '--mode', 'general', '--all'], { cwd: repo, encoding: 'utf8', env: env() });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const gateReal = () => {
    const r = spawnSync('/bin/sh', [path.join(scriptsDir, 'push-gate.sh'), '--mode', 'general', '--all'], { cwd: repo, encoding: 'utf8', env: env() });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  beforeEach(() => {
    if (missing.length) throw new Error(`${missing.join(' and ')} not installed: run "sh scripts/setup-dev-env.sh --bin-dir <dir on PATH>" first`);
    dir = mkdtempSync(path.join(tmpdir(), 'scan-exclusions-'));
    bin = path.join(dir, 'bin');
    mkdirSync(bin);
    for (const n of CORE) { const p = find(n, '/usr/bin:/bin:/usr/local/bin'); if (p) symlinkSync(p, path.join(bin, n)); }
    for (const [n, p] of Object.entries(real)) symlinkSync(p, path.join(bin, n));
    repo = path.join(dir, 'repo');
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    commit({ 'a.txt': 'one\n' });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('(guard) an empty list, and a list with one valid entry of each kind (and a second entry for the same path), are accepted', () => {
    assert.equal(gateWith('').status, 0);
    const r = gateWith(`${VALID.join('\n')}\n`);
    assert.equal(r.status, 0, r.out);
  });

  const stopsWith = (list) => {
    const r = gateWith(list);
    assert.equal(r.status, 2, r.out);
    assert.ok(r.out.includes('scan-exclusions'), `the reason does not name the list: ${r.out}`);
    assert.ok(!r.out.includes('push-gate: passed'), r.out);
  };
  for (const [label, line] of Object.entries(MALFORMED)) {
    it(`a list with ${label} stops the gate with exit 2 and names the list`, () => stopsWith(`${VALID[2]}\n${line}\n`));
  }
  it('a list with an exact duplicate line stops the gate with exit 2 and names the list', () => stopsWith(`${VALID[0]}\n${VALID[0]}\n`));
  it('a list that is missing stops the gate with exit 2 and names the list', () => stopsWith(null));

  it('(guard) a list inside the scanned tree is not the list: a malformed one there changes nothing', () => {
    commit({ 'scripts/scan-exclusions.tsv': 'this line is not an entry\n' });
    const r = gateReal();
    assert.equal(r.status, 0, r.out);
  });

  it('(guard) a `keys` entry (with the right blob id) written into the scanned tree does not silence a key', () => {
    const conf = `token = ${fakeKey()}\n`;
    commit({ 'scripts/scan-exclusions.tsv': `keys\tconf.txt\t${createHash('sha1').update(`blob ${conf.length}\0${conf}`).digest('hex')}\ta made-up reason\n`, 'conf.txt': conf });
    const r = gateReal();
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('push-gate: step gitleaks: FAILED'), r.out);
  });
});

// ---- no other mechanism ----

/** The lines of a file without the ones that are only a comment. */
const codeLines = (file) => readFileSync(file, 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*#/.test(l));

describe('there is no way to skip a file except the list', () => {
  const CONFIG = path.join(scriptsDir, 'push-gate.gitleaks.toml');
  it('the vendored gitleaks configuration does not extend anything, has no global allowlist (any spelling) and no `paths =`', () => {
    const lines = codeLines(CONFIG);
    const hits = lines.filter(([, l]) => /useDefault/.test(l) || /^\s*\[\s*extend\s*\]/.test(l) || /^\s*\[\s*allowlist\s*\]/.test(l) || /^\s*\[\[\s*allowlists\s*\]\]/.test(l)
      || /^\s*allowlists?\s*=/.test(l) || /^\s*paths\s*=/.test(l));
    assert.deepEqual(hits, [], 'useDefault / [extend] bring in the default global allowlist; paths = would skip files by name (a [[rules.allowlists]] without paths is fine)');
  });
  it('before its first [[rules]] the vendored configuration holds only comments, blank lines, title = and minVersion =', () => {
    const text = readFileSync(CONFIG, 'utf8');
    const i = text.indexOf('[[rules]]');
    const head = (i < 0 ? text : text.slice(0, i)).split('\n').filter((l) => l.trim() !== '' && !/^\s*#/.test(l) && !/^\s*(title|minVersion)\s*=/.test(l));
    assert.deepEqual(head, [], 'something other than a comment, title or minVersion precedes the rules');
    assert.ok(i >= 0, 'the vendored configuration has no [[rules]]');
  });

  /** The default configuration that the pinned gitleaks carries inside its binary, found offline in the binary's own bytes. */
  const embeddedDefault = () => {
    const bin = spawnSync('/bin/sh', ['-c', 'command -v gitleaks'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(bin.startsWith('/'), 'gitleaks is not installed: run "sh scripts/setup-dev-env.sh --bin-dir <dir on PATH>" first');
    const pinned = /^GITLEAKS_VERSION=(\S+)/m.exec(readFileSync(path.join(scriptsDir, 'setup-dev-env.sh'), 'utf8'))?.[1];
    const have = spawnSync(bin, ['version'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(have, pinned, `the installed gitleaks (${have}) is not the pinned one (${pinned})`);
    const data = readFileSync(bin);
    const start = data.indexOf('# This file has been auto-generated');
    assert.ok(start >= 0, 'the default configuration was not found in the binary');
    let end = start;
    while (end < data.length && (data[end] === 9 || data[end] === 10 || data[end] === 13 || data[end] >= 32) && data[end] !== 127) end += 1;
    return data.subarray(start, end).toString('utf8');
  };
  /**
   * The rules of a configuration, compared without the one thing the gate must not keep: a `paths = [...]` list. The pinned
   * default has three of them inside rule-level allowlists (.bb files for generic-api-key, and @octokit/auth-token/README.md for
   * two GitHub rules). They skip files by name, so the vendored copy has no `paths`. Dropping only the `paths` of an allowlist
   * is right when it combines its parts with OR (a match on paths OR on regexes allows): the rest still allows what it did.
   * With `condition = "AND"` (a match must be on the path AND on the regexes) dropping only `paths` would widen the allowlist to
   * every file, so the WHOLE allowlist is dropped. A rule-level allowlist left with nothing but a description is dropped too.
   */
  const stripPaths = (lines) => {
    const kept = [];
    let skipping = false;
    for (const l of lines) {
      if (skipping) { if (/^\s*\]$/.test(l)) skipping = false; continue; }
      if (/^\s*paths\s*=\s*\[\s*$/.test(l)) { skipping = true; continue; }
      if (/^\s*paths\s*=\s*\[.*\]$/.test(l)) continue;
      kept.push(l);
    }
    return kept;
  };
  const rulesOf = (text) => {
    const i = text.indexOf('[[rules]]');
    if (i < 0) return '';
    const tables = text.slice(i).split('\n').map((x) => x.replace(/\s+$/, '')).join('\n').split(/^(?=\[)/m);
    const out = [];
    for (const t of tables) {
      if (!/^\[\[rules\.allowlists\]\]/.test(t)) { out.push(stripPaths(t.split('\n')).join('\n')); continue; }
      if (/^\s*paths\s*=/m.test(t) && /^\s*condition\s*=\s*"AND"/m.test(t)) continue;
      const body = stripPaths(t.split('\n'));
      if (body.slice(1).every((l) => l === '' || /^\s*description\s*=/.test(l))) continue;
      out.push(body.join('\n'));
    }
    return out.join('').replace(/\n{2,}/g, '\n').trim();
  };
  it('(guard) the comparison drops a whole AND allowlist that had paths, and only the paths of an OR one', () => {
    const text = '[[rules]]\nid = "x"\n[[rules.allowlists]]\ncondition = "AND"\npaths = [\n  \'a\',\n]\nregexes = [\'bbb\']\n[[rules.allowlists]]\npaths = [\'ccc\']\nregexes = [\'ddd\']\n[[rules.allowlists]]\ndescription = "d"\npaths = [\'eee\']\n';
    const out = rulesOf(text);
    assert.ok(!out.includes('bbb') && !out.includes('ccc') && !out.includes('eee') && !out.includes('paths'), out);
    assert.ok(out.includes('ddd') && out.includes('id = "x"'), out);
  });
  it('the vendored rules are exactly the pinned gitleaks\' default rules (its global allowlist is the only part left out)', () => {
    const want = rulesOf(embeddedDefault());
    assert.ok(want.length > 10000, 'could not read the default rules out of the pinned binary');
    assert.ok(!/^\s*paths\s*=/m.test(want), 'the comparison text must hold no paths list');
    const have = rulesOf(readFileSync(CONFIG, 'utf8'));
    assert.ok(have.length > 0, 'the vendored configuration has no rules');
    assert.equal(have === want, true, 'the vendored rules differ from the default rules of the pinned gitleaks (take them from its default configuration, without [allowlist])');
  });

  const SKIPPERS = [
    ['a `:!` pathspec', /:!/, "gg -l x -- . ':!lock.json'"],
    ['a `:(exclude)` pathspec', /:\(exclude/, "git grep x -- ':(exclude)a'"],
    ['a `:^` pathspec', /(^|[\s'"]):\^/, "git grep x -- ':^b'"],
    ['--exclude', /--exclude/, 'tar --exclude=.git'],
    ['find -not/! -path or -name', /(-not|!)\s+-(i?path|i?name|i?regex)\b/, 'find . ! -name x'],
    ['a path list in the gitleaks configuration', /^\s*paths\s*=/, 'paths = ["x"]'],
  ];
  it('(guard) the named exception is one line of one file, and the detector still catches that construct elsewhere', () => {
    assert.equal(OLD_CHECK.reason, 'old check, removed in the follow-up after the first green run on dev');
    const hits = codeLines(path.join(scriptsDir, 'gitleaks-public.sh')).filter(([, l]) => SKIPPERS.some(([, re]) => re.test(l)));
    assert.ok(hits.length <= 1, `the old check holds more than its one tar --exclude: ${JSON.stringify(hits)}`);
    assert.ok(SKIPPERS.find(([label]) => label === OLD_CHECK.label)[1].test('tar -C "$target" --exclude=.git -cf x .'), 'the detector must see the construct');
  });
  it('(guard) the detector names each kind of skipper', () => {
    for (const [label, re, sample] of SKIPPERS) assert.ok(re.test(sample), `not seen: ${label}`);
    assert.ok(!SKIPPERS.some(([, re]) => re.test('echo "${x:-default}" && find . -name x')), 'a plain find -name is not a skipper');
    assert.ok(!SKIPPERS.some(([, re]) => re.test("regex = '''(?:^|x)y'''")), 'a non-capturing group that starts with ^ is not a pathspec');
  });

  const files = [
    ...readdirSync(scriptsDir).filter((n) => /\.(sh|mjs|toml)$/.test(n)).map((n) => path.join(scriptsDir, n)),
    ...readdirSync(path.join(root, '.githooks')).map((n) => path.join(root, '.githooks', n)),
  ];
  // The one named exception: the old check kept on purpose. scripts/gitleaks-public.sh (and its ci.yml step) is the pre-gate key scan; it
  // stays until the follow-up that removes it after the first green run of the gate on dev (docs/rules development-flow.md, "検査を入れ替えるとき";
  // known-gaps 15). Its `tar --exclude=.git` is the only construct excused, in that file only: the detector still catches it anywhere else.
  const OLD_CHECK = { file: 'scripts/gitleaks-public.sh', label: '--exclude', reason: 'old check, removed in the follow-up after the first green run on dev' };
  it('no script, hook or scanner configuration has a pathspec, an --exclude or a glob that skips files', () => {
    const offences = [];
    for (const f of files) {
      for (const [n, l] of codeLines(f)) {
        for (const [label, re] of SKIPPERS) {
          if (!re.test(l)) continue;
          if (path.relative(root, f) === OLD_CHECK.file && label === OLD_CHECK.label && /^\s*tar -C "\$target" --exclude=\.git -cf /.test(l)) continue;
          offences.push(`${path.relative(root, f)}:${n} ${label}`);
        }
      }
    }
    assert.deepEqual(offences, [], `${offences.length} way(s) to skip a file outside the list:\n${offences.join('\n')}`);
  });
});

// The named exception for the configuration of the old key-scan wrapper (the same exception, with the same reason, as the wrapper itself:
// old check, removed in the follow-up after the first green run on dev). The old check keeps its old behaviour, so it keeps its old
// configuration: `useDefault = true`, which brings in the tool's default allowlist. No other file may do that, and the gate never reads it.
describe('the old key-scan wrapper keeps its old configuration, as a named exception (old check, removed in the follow-up after the first green run on dev)', () => {
  const OLD_CONFIG = 'gitleaks-public.toml';
  // How it is pinned: the sha256 of the text of scripts/push-gate.gitleaks.toml as it was on origin/dev (693 bytes), taken from `git show origin/dev:scripts/push-gate.gitleaks.toml`.
  const OLD_SHA256 = 'c4e82dc4ad8ddb912e9b0a70365548ff6d4aadb71ea93d1f42b1e87bb2258cbf';
  const text = () => readFileSync(path.join(scriptsDir, OLD_CONFIG), 'utf8');
  const files = [
    ...readdirSync(scriptsDir).map((n) => path.join(scriptsDir, n)),
    ...readdirSync(path.join(root, '.githooks')).map((n) => path.join(root, '.githooks', n)),
  ];
  it('the file is the old configuration: its text, without a leading header comment line, is the pinned old text', () => {
    const lines = text().split('\n');
    const body = /^# .*old check/.test(lines[0]) && lines[0].startsWith('#') ? lines.slice(1).join('\n') : lines.join('\n');
    assert.equal(createHash('sha256').update(body).digest('hex'), OLD_SHA256);
    assert.ok(/^useDefault = true$/m.test(body) && /^\[extend\]$/m.test(body));
  });
  it('the wrapper reads that file and not the gate\'s', () => {
    const w = readFileSync(path.join(scriptsDir, 'gitleaks-public.sh'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.ok(w.includes(`cfg="$here/${OLD_CONFIG}"`), 'the wrapper must read scripts/gitleaks-public.toml');
    assert.ok(!w.includes('push-gate.gitleaks.toml'), 'the wrapper must not name the gate\'s configuration in its code');
  });
  it('no other script, hook or configuration reads it: the gate and the scans name only push-gate.gitleaks.toml', () => {
    const readers = files.filter((f) => path.basename(f) !== 'gitleaks-public.sh' && path.basename(f) !== OLD_CONFIG)
      .filter((f) => !/\.toml$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes(OLD_CONFIG)).map((f) => path.relative(root, f));
    assert.deepEqual(readers, []);
  });
  it('only that file in the scripts directory has `useDefault` or `[extend]`: the exception covers no other file', () => {
    const offenders = readdirSync(scriptsDir).filter((n) => /\.toml$/.test(n) && n !== OLD_CONFIG)
      .filter((n) => codeLines(path.join(scriptsDir, n)).some(([, l]) => /useDefault/.test(l) || /^\s*\[\s*extend\s*\]/.test(l)));
    assert.deepEqual(offenders, []);
  });
});
