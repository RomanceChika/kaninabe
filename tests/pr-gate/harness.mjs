/**
 * The shared harness of the tests of the two pr-gate workflows (the framework's .github/workflows/pr-gate.yml, and the template
 * templates/workflows/pr-gate.product.yml that a product copies). Not a test file (the runner picks up *.test.mjs only). The import
 * fence lets a test of tests/pr-gate/ import this one module. It holds what does not depend on which workflow is tested:
 *   - the detector of the class rule (cut from tests/push-gate/no-pipes.test.mjs, so that there is one detector),
 *   - a reader for the YAML subset the workflows use (strict on purpose: see parseYaml),
 *   - the logical lines of a run block,
 *   - the executor of run blocks (the way Actions runs them: `bash -e`, in order, in a temp dir, a fake event file, a private PATH),
 *   - small helpers of the git fixtures.
 * What belongs to one workflow (its steps, its fixture repository, its pinned lines) stays in its own test file.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The detector of tests/push-gate/no-pipes.test.mjs, taken from its source so that there is one detector and no copy that can drift
 * (the import fence lets a test import only node: built-ins, bin/ and scripts/, so the file is read, not imported). It throws if
 * the source no longer has the shape this expects.
 */
export const inspect = (() => {
  const src = readFileSync(path.join(repoRoot, 'tests/push-gate/no-pipes.test.mjs'), 'utf8');
  const from = src.indexOf("const MARKER = ");
  const to = src.indexOf("describe('no pipelines");
  if (from < 0 || to < from) throw new Error('no-pipes.test.mjs no longer has the shape the detector is cut from');
  const body = src.slice(from, to).replace('export function inspect', 'function inspect');
  if (body.includes('import ') || body.includes('export ')) throw new Error('the detector part of no-pipes.test.mjs has an import or export');
  return new Function(`${body}\nreturn inspect;`)();
})();

/** The expressions the framework's own gate may hold. A workflow with other expressions passes its own list to parseYaml. */
export const FRAMEWORK_EXPRESSIONS = ['github.sha', 'github.event.pull_request.number', 'github.event.pull_request.head.sha', 'secrets.SCAN_WORDS'];

// ---- a parser for the YAML subset the workflow uses ----

/**
 * Block maps and sequences, plain scalars, flow sequences of scalars, `|` literal blocks. Anything else throws. A workflow that
 * needs more than the framework's own gate says so in the options: `expressions` (the `${{ ... }}` bodies it may hold), `pinned`
 * (more keys whose YAML-typed value is accepted, by exact text) and `extraChars` (more characters of a plain scalar).
 */
export function parseYaml(text, { expressions = FRAMEWORK_EXPRESSIONS, pinned = {}, extraChars = '' } = {}) {
  if (text.includes('\t')) throw new Error('yaml: a tab');
  const lines = text.split('\n');
  let i = 0;
  const indentOf = (l) => l.length - l.trimStart().length;
  const skip = () => { while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#'))) i++; };
  // the values YAML would type that this workflow has, pinned by key: nothing else of that kind is accepted
  const PINNED = { 'persist-credentials': 'false', 'cancel-in-progress': 'true', 'timeout-minutes': '5', 'fetch-depth': '0', ...pinned };
  const TYPED = /^(true|false|yes|no|on|off|y|n|null|~)$/i;
  const NUMBERISH = /^[-+.]?[0-9]/;
  const scalar = (raw, key = null) => {
    const bad = (why) => new Error(`yaml: ${why}: ${JSON.stringify(raw)}`);
    if (raw !== raw.trim()) throw bad('blanks around a value');
    if (raw === '') throw bad('an empty value');
    if (!/^[A-Za-z0-9$_]/.test(raw)) throw bad('a value that starts with an indicator, a quote or a bracket (quoted scalars are not accepted)');
    if (raw.includes(' #') || raw.includes(': ') || raw.endsWith(':')) throw bad('a comment or a colon inside a plain value');
    if (!new RegExp(`^[A-Za-z0-9 _.,()/@\${}${extraChars}-]+$`).test(raw)) throw bad('a character outside the accepted set');
    let rest = raw;
    for (const e of expressions) rest = rest.split('${{ ' + e + ' }}').join('');
    if (/[${}]/.test(rest)) throw bad('an expression that is not one of the known ones');
    if (key in PINNED) {
      if (raw !== PINNED[key]) throw bad(`only ${PINNED[key]} is accepted for ${key}`);
    } else if (TYPED.test(raw) || NUMBERISH.test(raw)) throw bad('a word or number that YAML types differently');
    return raw;
  };
  const flow = (raw) => {
    if (!raw.startsWith('[') || !raw.endsWith(']')) throw new Error(`yaml: unsupported flow sequence: ${raw}`);
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') return [];
    return inner.split(',').map((x) => {
      const t = x.trim();
      if (!/^[a-z_]+$/.test(t)) throw new Error(`yaml: unsupported flow item: ${JSON.stringify(x)}`);
      if (TYPED.test(t)) throw new Error(`yaml: a flow item that YAML types differently: ${t}`);
      return t;
    });
  };
  const value = (raw, key) => (raw.startsWith('[') ? flow(raw) : scalar(raw, key));
  const literal = (parentIndent) => {
    const body = [];
    let blockIndent = -1;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') { body.push(''); i++; continue; }
      const ind = indentOf(l);
      if (ind <= parentIndent) break;
      if (blockIndent < 0) blockIndent = ind;
      if (ind < blockIndent) throw new Error('yaml: a literal block that dedents');
      body.push(l.slice(blockIndent));
      i++;
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    return `${body.join('\n')}\n`;
  };
  const block = () => {
    skip();
    const t = lines[i].trimStart();
    return t === '-' || t.startsWith('- ') ? seq(indentOf(lines[i])) : map(indentOf(lines[i]));
  };
  const map = (indent) => {
    const o = {};
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      const ind = indentOf(l);
      if (ind < indent) break;
      if (ind > indent) throw new Error(`yaml: unexpected indent at line ${i + 1}`);
      const m = /^([A-Za-z0-9_.-]+):(?: +(.*))?$/.exec(l.slice(ind));
      if (!m) throw new Error(`yaml: unsupported line ${i + 1}: ${l}`);
      const [, key, v] = m;
      if (key in o) throw new Error(`yaml: duplicate key ${key}`);
      i++;
      if (key !== 'on' && (TYPED.test(key) || NUMBERISH.test(key))) throw new Error(`yaml: a key that YAML types differently: ${key}`);
      if (v === undefined) {
        skip();
        if (i < lines.length && indentOf(lines[i]) > ind) o[key] = block();
        else o[key] = null;
      } else if (v === '|') o[key] = literal(ind);
      else o[key] = value(v, key);
    }
    return o;
  };
  const seq = (indent) => {
    const a = [];
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== indent || !lines[i].trimStart().startsWith('- ')) break;
      const rest = lines[i].slice(indent + 2);
      if (/^[A-Za-z0-9_.-]+:( |$)/.test(rest)) { lines[i] = ' '.repeat(indent + 2) + rest; a.push(map(indent + 2)); } else { i++; a.push(value(rest, null)); }
    }
    return a;
  };
  const doc = map(0);
  skip();
  if (i < lines.length) throw new Error(`yaml: unparsed text at line ${i + 1}`);
  return doc;
}

// ---- 2. the class rule on every run block ----

/** The logical lines of a run block: a `\` continuation is joined to the next line. */
export function logicalLines(run) {
  const out = [];
  let cur = '';
  for (const line of run.split('\n')) {
    if (line.endsWith('\\')) { cur += `${line.slice(0, -1)} `; continue; }
    out.push(cur + line);
    cur = '';
  }
  return out;
}

export const codeLines = (run) => logicalLines(run).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));

export const hexOf = (text) => createHash('sha256').update(text).digest('hex');

export const GIT_ENV = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 'fixture', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 'fixture' };

/** Runs git in `cwd` with the neutral environment, throws on failure, returns stdout without the final line feed. */
export function gitIn(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture: git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

export const REAL = Object.fromEntries(['jq', 'sha256sum', 'rm', 'git'].map((n) => [n, ['/usr/bin', '/bin'].map((d) => path.join(d, n)).find((p) => spawnSync('/bin/sh', ['-c', `test -x ${p}`]).status === 0)]));

/** Resolves the `${{ ... }}` expressions a step's env may hold; throws on one it does not know. */
export function expand(value, ctx) {
  return value.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, expr) => {
    if (!(expr in ctx)) throw new Error(`unknown expression ${expr}`);
    return ctx[expr];
  });
}

export const PASSED = /^pr-gate: passed /m;
export const COULD_NOT = /^pr-gate: could not run \(.+\)$/m;

/**
 * Runs the run blocks of a job in order with `bash -e` (what Actions does by default on Linux), stopping at the first that fails.
 *   steps       the parsed steps of the job; `ctx` resolves the `${{ ... }}` expressions of a step's env (an unknown one throws)
 *   makeWork    (dir) => the path of the workspace of this run (GITHUB_WORKSPACE, and the directory the steps run in)
 *   ev, base, repo   the event (written as JSON, or `rawEvent` as is), GITHUB_SHA, GITHUB_REPOSITORY
 *   shims       name -> sh body, placed first on the PATH
 *   only        a predicate on a step: steps that do not pass are not run
 *   pre         called with the dirs (`work` among them) before the steps run
 * Returns the results of the steps run, their output, the last status, and the contents of the files left in RUNNER_TEMP.
 */
export function runJob({ steps, makeWork, ctx, ev, base, repo, shims = {}, only = () => true, pre = () => {}, rawEvent, runnerName = 'runner-temp' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-gate-'));
  try {
    const bin = path.join(dir, 'bin');
    const runnerTemp = path.join(dir, runnerName);
    const tmp = path.join(dir, 'tmp');
    for (const d of [bin, runnerTemp, tmp]) mkdirSync(d);
    const work = makeWork(dir);
    for (const [name, body] of Object.entries(shims)) { writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(path.join(bin, name), 0o755); }
    const eventPath = path.join(dir, 'event.json');
    writeFileSync(eventPath, rawEvent ?? JSON.stringify(ev));
    pre({ dir, bin, runnerTemp, tmp, work });
    const results = [];
    for (const s of steps) {
      if (s.run === undefined || !only(s)) continue;
      const file = path.join(dir, `step-${results.length}.sh`);
      writeFileSync(file, s.run);
      const env = {
        PATH: `${bin}:/usr/bin:/bin`, HOME: dir, TMPDIR: tmp, RUNNER_TEMP: runnerTemp, GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: base, GITHUB_REPOSITORY: repo, GITHUB_WORKSPACE: work, ...(s.env ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, expand(v, ctx)])) : {}),
      };
      const r = spawnSync('bash', ['-e', file], { cwd: work, env, encoding: 'utf8' });
      results.push({ name: s.name ?? '(unnamed)', status: r.status, out: r.stdout + r.stderr, step: s });
      if (r.status !== 0) break;
    }
    const filesLeft = readdirSync(runnerTemp).map((f) => path.join(runnerTemp, f));
    const leftContents = filesLeft.map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } });
    return { results, out: results.map((r) => r.out).join(''), status: results.length ? results[results.length - 1].status : null, leftContents };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
