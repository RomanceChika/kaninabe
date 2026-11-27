/**
 * Tests of .github/workflows/pr-gate.yml, the workflow whose shell decides whether a merge is allowed. It comes under the
 * same class rule as the scripts it calls (a step that fails must never read as "passed"):
 *   1. wiring: the triggers, the permissions, the checkout, what is read from the event, where the secret goes;
 *   2. the class rule applied mechanically to every `run:` block (the detector of no-pipes.test.mjs, plus a `$(...)` that sits
 *      directly in an argument of echo / printf, where its status is lost);
 *   3. behaviour: the `run:` blocks are executed the way Actions runs them (`bash -e`), in order, in a temp dir, against a fake
 *      event file and a private PATH, and each tool that can fail is made to fail.
 * The YAML is read by a small purpose-built parser (the repository has no YAML dependency at its root): it covers the shapes this
 * workflow uses and throws on anything else, so a new shape in the workflow stops the test instead of being skipped.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspect } from '../push-gate/no-pipes.test.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const workflowText = readFileSync(path.join(repoRoot, '.github/workflows/pr-gate.yml'), 'utf8');

// ---- a parser for the YAML subset the workflow uses ----

/** Block maps and sequences, plain scalars, flow sequences of scalars, `|` literal blocks. Anything else throws. */
export function parseYaml(text) {
  if (text.includes('\t')) throw new Error('yaml: a tab');
  const lines = text.split('\n');
  let i = 0;
  const indentOf = (l) => l.length - l.trimStart().length;
  const skip = () => { while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#'))) i++; };
  const scalar = (raw) => {
    let s = raw.trim();
    if (/^[&*!>{|?%@`]/.test(s) || s.startsWith('- ')) throw new Error(`yaml: unsupported value: ${raw}`);
    if (s.startsWith('"') || s.startsWith("'")) {
      const q = s[0];
      const end = s.lastIndexOf(q);
      if (end < 1 || s.slice(end + 1).replace(/\s*#.*$/, '') !== '' || s.slice(1, end).includes(q) || s.includes('\\')) throw new Error(`yaml: unsupported quoted value: ${raw}`);
      return s.slice(1, end);
    }
    s = s.replace(/\s+#.*$/, '');
    if (s.startsWith('[')) {
      if (!s.endsWith(']')) throw new Error(`yaml: unsupported flow sequence: ${raw}`);
      const inner = s.slice(1, -1).trim();
      return inner === '' ? [] : inner.split(',').map((x) => scalar(x));
    }
    return s;
  };
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
      if (v === undefined || v.replace(/\s+#.*$/, '') === '') {
        skip();
        if (i < lines.length && indentOf(lines[i]) > ind) o[key] = block();
        else o[key] = null;
      } else if (v === '|') o[key] = literal(ind);
      else o[key] = scalar(v);
    }
    return o;
  };
  const seq = (indent) => {
    const a = [];
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== indent || !lines[i].trimStart().startsWith('- ')) break;
      const rest = lines[i].slice(indent + 2);
      if (/^[A-Za-z0-9_.-]+:( |$)/.test(rest)) { lines[i] = ' '.repeat(indent + 2) + rest; a.push(map(indent + 2)); } else { i++; a.push(scalar(rest)); }
    }
    return a;
  };
  const doc = map(0);
  skip();
  if (i < lines.length) throw new Error(`yaml: unparsed text at line ${i + 1}`);
  return doc;
}

const wf = parseYaml(workflowText);
const job = wf.jobs?.gate;
const steps = job?.steps ?? [];
const runs = steps.filter((s) => s.run !== undefined);

describe('the YAML subset parser fails loudly on what it does not understand', () => {
  it('reads the shapes it supports', () => {
    const d = parseYaml('a: 1\nb:\n  c: [x, y]\n  d:\n    - n: 1\n      run: |\n        echo "a"\n\n        echo b\n    - uses: u\n# c\ne: "q"\n');
    assert.deepEqual(d, { a: '1', b: { c: ['x', 'y'], d: [{ n: '1', run: 'echo "a"\n\necho b\n' }, { uses: 'u' }] }, e: 'q' });
  });
  it('throws on anchors, folded blocks, flow maps, tabs and stray indent', () => {
    for (const bad of ['a: &x 1\n', 'a: >\n  x\n', 'a: {b: 1}\n', 'a:\n\tb: 1\n', 'a: 1\n  b: 2\n', 'a: 1\na: 2\n', 'just text\n']) {
      assert.throws(() => parseYaml(bad), /yaml:/, JSON.stringify(bad));
    }
  });
});

// ---- 1. wiring ----

describe('pr-gate.yml: wiring', () => {
  it('is triggered by pull_request_target with exactly these types and nothing else', () => {
    assert.deepEqual(Object.keys(wf.on), ['pull_request_target']);
    assert.deepEqual(wf.on.pull_request_target, { types: ['opened', 'edited', 'synchronize', 'reopened', 'ready_for_review'] });
  });

  it('has top-level permissions of exactly contents: read, and no job widens them', () => {
    assert.deepEqual(wf.permissions, { contents: 'read' });
    assert.equal(job.permissions, undefined);
    assert.equal(Object.keys(wf.jobs).length, 1);
    assert.deepEqual(Object.keys(wf.jobs), ['gate']);
  });

  it('keeps the concurrency group of the pull request and cancels the older run', () => {
    assert.deepEqual(wf.concurrency, { group: 'pr-gate-${{ github.event.pull_request.number }}', 'cancel-in-progress': 'true' });
  });

  it('checks out github.sha only, without credentials, and never the pull request', () => {
    const checkouts = steps.filter((s) => (s.uses ?? '').startsWith('actions/checkout@'));
    assert.equal(checkouts.length, 1);
    assert.deepEqual(checkouts[0].with, { ref: '${{ github.sha }}', 'persist-credentials': 'false' });
    assert.ok(steps.filter((s) => s.uses !== undefined).every((s) => s === checkouts[0]), 'no other action is used');
    for (const forbidden of ['github.event.pull_request.head.ref', 'refs/pull/', 'github.head_ref', 'github.event.pull_request.head.repo']) {
      const where = workflowText.split('\n').map((l, k) => [l, k + 1]).filter(([l]) => !l.trim().startsWith('#') && l.includes(forbidden));
      // reading the head repo's name as data (the fork step) is allowed in a run block through the event file, not through an expression
      assert.deepEqual(where, [], `${forbidden} must not appear outside comments`);
    }
    for (const s of steps) {
      if (s === checkouts[0]) continue;
      assert.ok(!JSON.stringify(s.with ?? {}).includes('head'), 'only the checkout takes a ref');
    }
  });

  it('hands the head sha of the pull request to the review check and runs the scan script on the text', () => {
    const review = runs.filter((s) => s.run.includes('scripts/check-review-record.sh'));
    assert.equal(review.length, 1);
    assert.equal(review[0].env.HEAD_SHA, '${{ github.event.pull_request.head.sha }}');
    assert.match(review[0].run, /check-review-record\.sh\s+\S+\s+"\$HEAD_SHA"/);
    const scan = runs.filter((s) => s.run.includes('scripts/scan-pr-text.sh'));
    assert.equal(scan.length, 1);
  });

  it('exposes the secret only as SCAN_WORDS of the scan step, and puts neither the title nor the body in any env', () => {
    const secretLines = workflowText.split('\n').filter((l) => !l.trim().startsWith('#') && l.includes('secrets.'));
    assert.deepEqual(secretLines.map((l) => l.trim()), ['SCAN_WORDS: ${{ secrets.SCAN_WORDS }}']);
    const scan = runs.find((s) => s.run.includes('scripts/scan-pr-text.sh'));
    assert.deepEqual(scan.env, { SCAN_WORDS: '${{ secrets.SCAN_WORDS }}' });
    for (const s of steps) {
      const env = JSON.stringify(s.env ?? {});
      assert.ok(!/title|body/i.test(env), `env of "${s.name}" names the title or body`);
      assert.ok(!/github\.event\.pull_request\.(title|body)/.test(JSON.stringify(s)), `"${s.name}" reads the title or body through an expression`);
    }
    assert.deepEqual(wf.env ?? null, null);
    assert.equal(job.env ?? null, null);
  });

  it('has a fork step that turns a pull request from another repository red', () => {
    const fork = runs.filter((s) => s.run.includes('head.repo.full_name'));
    assert.equal(fork.length, 1);
    assert.match(fork[0].run, /GITHUB_REPOSITORY/);
  });
});

// ---- 2. the class rule on every run block ----

/** The logical lines of a run block: a `\` continuation is joined to the next line. */
function logicalLines(run) {
  const out = [];
  let cur = '';
  for (const line of run.split('\n')) {
    if (line.endsWith('\\')) { cur += `${line.slice(0, -1)} `; continue; }
    out.push(cur + line);
    cur = '';
  }
  return out;
}

describe('pr-gate.yml: the class rule on every run block', () => {
  it('has run blocks to look at', () => {
    assert.ok(runs.length >= 4, `${runs.length} run blocks`);
  });

  it('has no pipeline, no `|| true`, no bare grep and none of the other constructs the detector names', () => {
    const offences = [];
    runs.forEach((s, n) => logicalLines(s.run).forEach((line, k) => {
      const r = inspect(line);
      if (r.problems.length) offences.push(`run ${n + 1} (${s.name}) line ${k + 1}: ${r.problems.join(', ')}`);
    }));
    assert.deepEqual(offences, []);
  });

  it('has no `$(...)` directly in an argument of echo or printf, and none behind export / local / readonly', () => {
    const offences = [];
    runs.forEach((s, n) => logicalLines(s.run).forEach((line, k) => {
      const t = line.trim();
      // a command, or a command after `;`, `&&`, `||`, `then`, `do`, `{`
      for (const part of t.split(/;|&&|\|\||\bthen\b|\bdo\b|\{/)) {
        const p = part.trim();
        if (/^(echo|printf)\b/.test(p) && p.includes('$(')) offences.push(`run ${n + 1} line ${k + 1}: ${p}`);
        if (/^(export|local|readonly|declare|typeset)\s+[A-Za-z_][A-Za-z0-9_]*=.*\$\(/.test(p)) offences.push(`run ${n + 1} line ${k + 1}: ${p}`);
      }
    }));
    assert.deepEqual(offences, []);
  });

  it('the extra rule finds what it must', () => {
    // mirrors the detector tests: the shape that hid a failed hash must be seen
    const hit = (l) => logicalLines(l).some((x) => x.split(/;|&&|\|\|/).some((p) => /^(echo|printf)\b/.test(p.trim()) && p.includes('$(')));
    assert.ok(hit('echo "pr $(jq -r x f)"'));
    assert.ok(hit('printf \'%s\\n\' \\\n "$(jq -r x f)"'));
    assert.ok(!hit('n=$(jq -r x f) || exit 2\necho "$n"'));
  });
});

// ---- 3. behaviour: the run blocks, executed ----

const HEAD = 'a1'.repeat(20);
const BASE = 'b2'.repeat(20);
const OTHER_BASE = 'c3'.repeat(20);
const REPO = 'octo/repo';
const LIST = '# qjmarker list\nhitword\n';
const hexOf = (text) => createHash('sha256').update(text).digest('hex');

const TITLE = 'Add a thing';
const BODY = `Plain text.\n\n## Review\n- opus: ${HEAD}\n- codex: ${HEAD}\n`;
/** The bytes the gate hashes: `jq -r '.title, "", (.body // "")'`: the title, an empty line, the body, each followed by a line feed. */
const hashedBytes = (title, body) => `${title}\n\n${body}\n`;

function event({ title = TITLE, body = BODY, number = 42, head = HEAD, repo = REPO } = {}) {
  return { pull_request: { number, title, body, head: { sha: head, repo: { full_name: repo } }, base: { sha: OTHER_BASE } } };
}

const REAL = Object.fromEntries(['jq', 'sha256sum', 'rm'].map((n) => [n, ['/usr/bin', '/bin'].map((d) => path.join(d, n)).find((p) => spawnSync('/bin/sh', ['-c', `test -x ${p}`]).status === 0)]));

/** Resolves the `${{ ... }}` expressions a step's env may hold; throws on one it does not know. */
function expand(value, ctx) {
  return value.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, expr) => {
    if (!(expr in ctx)) throw new Error(`unknown expression ${expr}`);
    return ctx[expr];
  });
}

/**
 * Runs the run blocks of the job in order with `bash -e` (what Actions does by default on Linux), stopping at the first that fails.
 * Options: ev (the event), words (SCAN_WORDS), base (GITHUB_SHA), shims (name -> sh body, placed first on the PATH), only (a predicate
 * on a step: steps that do not pass are not run), pre (called with the dir before the steps run).
 */
function runJob({ ev = event(), words = LIST, base = BASE, shims = {}, only = () => true, pre = () => {}, rawEvent } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-gate-'));
  try {
    const bin = path.join(dir, 'bin');
    const runnerTemp = path.join(dir, 'runner-temp');
    const tmp = path.join(dir, 'tmp');
    for (const d of [bin, runnerTemp, tmp]) mkdirSync(d);
    for (const [name, body] of Object.entries(shims)) { writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(path.join(bin, name), 0o755); }
    const eventPath = path.join(dir, 'event.json');
    writeFileSync(eventPath, rawEvent ?? JSON.stringify(ev));
    const ctx = { 'secrets.SCAN_WORDS': words, 'github.event.pull_request.head.sha': ev.pull_request?.head?.sha ?? '', 'github.sha': base };
    pre({ dir, bin, runnerTemp, tmp });
    const results = [];
    for (const s of steps) {
      if (s.run === undefined || !only(s)) continue;
      const file = path.join(dir, `step-${results.length}.sh`);
      writeFileSync(file, s.run);
      const env = {
        PATH: `${bin}:/usr/bin:/bin`, HOME: dir, TMPDIR: tmp, RUNNER_TEMP: runnerTemp, GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: base, GITHUB_REPOSITORY: REPO, GITHUB_WORKSPACE: repoRoot, ...(s.env ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, expand(v, ctx)])) : {}),
      };
      const r = spawnSync('bash', ['-e', file], { cwd: repoRoot, env, encoding: 'utf8' });
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

const PASSED = /^pr-gate: passed /m;
const COULD_NOT = /^pr-gate: could not run \(.+\)$/m;
const isScan = (s) => s.run.includes('scripts/scan-pr-text.sh');
const isReview = (s) => s.run.includes('scripts/check-review-record.sh');

describe('pr-gate.yml: the run blocks, executed', () => {
  it('a good event passes with the exact line, the right number, head, base and the hash of the same bytes', () => {
    const r = runJob();
    assert.equal(r.status, 0, r.out);
    const lines = r.out.split('\n').filter((l) => l.startsWith('pr-gate: passed'));
    assert.deepEqual(lines, [`pr-gate: passed pr 42 head ${HEAD} base ${BASE} text sha256 ${hexOf(hashedBytes(TITLE, BODY))}`]);
    assert.ok(r.out.includes('pr-gate: pr 42'), 'the first step names the pull request');
    assert.ok(!r.out.includes('qjmarker') && !r.out.includes('hitword'), 'the word list is never printed');
  });

  it('hashes a title and a body with several lines, an empty body and a body without a final line feed', () => {
    for (const [title, body] of [['T', 'a\nb\n\nc'], ['T', ''], ['Ünï', 'x\n']]) {
      const r = runJob({ ev: event({ title, body: body === '' ? null : body, head: HEAD }), only: (s) => !isReview(s) });
      assert.equal(r.status, 0, r.out);
      assert.ok(r.out.includes(`text sha256 ${hexOf(hashedBytes(title, body))}\n`), r.out);
    }
  });

  it('turns a pull request from another repository red, with no passed line', () => {
    const r = runJob({ ev: event({ repo: 'someone/fork' }) });
    assert.equal(r.status, 1, r.out);
    assert.ok(!PASSED.test(r.out), r.out);
  });

  /** Every stop that is "could not run": exit 2, the fixed message, and never a passed line. */
  const stopsAs2 = (r, why) => {
    assert.equal(r.status, 2, `${why}: ${r.out}`);
    assert.ok(!PASSED.test(r.out), `${why}: a passed line was printed: ${r.out}`);
    assert.ok(/could not run/.test(r.out), `${why}: no could-not-run message: ${r.out}`);
  };
  const stopsAs2Fixed = (r, why) => {
    stopsAs2(r, why);
    assert.ok(COULD_NOT.test(r.out), `${why}: not the fixed pr-gate message: ${r.out}`);
  };

  describe('sha256sum', () => {
    const cases = [
      ['fails and prints nothing', 'exit 1'],
      ['prints nothing and succeeds', 'exit 0'],
      ['prints something that is not a hash', 'echo "nothex  file"'],
      ['prints a hash and fails', `echo "${'0'.repeat(64)}  file"; exit 1`],
      ['prints a short hash', `echo "${'0'.repeat(63)}  file"`],
    ];
    for (const [what, body] of cases) {
      it(`${what}: exit 2, could not run, no passed line`, () => {
        stopsAs2Fixed(runJob({ shims: { sha256sum: body } }), what);
      });
    }
  });

  describe('jq', () => {
    it('fails on any one of its calls: exit 2, could not run, no passed line', () => {
      let calls = 0;
      for (let n = 1; n <= 12; n++) {
        const r = runJob({
          pre: ({ dir }) => writeFileSync(path.join(dir, 'jq-n'), '0'),
          shims: { jq: `n=$(cat "$RUNNER_TEMP/../jq-n") || exit 3; n=$((n + 1)); echo $n > "$RUNNER_TEMP/../jq-n"; if [ $n = ${n} ]; then exit 1; fi; exec ${REAL.jq} "$@"` },
        });
        if (r.status === 0) break; // fewer than n calls: every call has been tried
        calls = n;
        stopsAs2(r, `jq call ${n} fails`);
      }
      assert.ok(calls >= 3, `jq is called at least 3 times in a good run (saw ${calls})`);
    });

    it('prints garbage: exit 2 for a number that is not digits, with no passed line', () => {
      for (const number of [null, 'abc', '4 2', -1, 1.5, '']) {
        const r = runJob({ ev: event({ number }), only: (s) => !isReview(s) });
        stopsAs2(r, `number ${JSON.stringify(number)}`);
      }
    });

    it('is given an event file that is not JSON: exit 2, no passed line', () => {
      stopsAs2(runJob({ rawEvent: 'not json' }), 'not json');
    });
  });

  describe('values that are not what the passed line promises', () => {
    it('a head sha that is not 40 hex characters: exit 2, no passed line (the review step is skipped so that the last step has to decide)', () => {
      for (const head of ['xyz', HEAD.slice(0, 39), HEAD.toUpperCase(), `${HEAD}0`, null, '']) {
        stopsAs2Fixed(runJob({ ev: event({ head }), only: (s) => !isReview(s) }), `head ${JSON.stringify(head)}`);
      }
    });
    it('a head sha that is not 40 hex characters stops the full job as well', () => {
      stopsAs2(runJob({ ev: event({ head: 'xyz' }) }), 'head xyz');
    });
    it('a base sha (GITHUB_SHA) that is not 40 hex characters: exit 2, no passed line', () => {
      for (const base of ['xyz', BASE.slice(0, 39), BASE.toUpperCase(), '']) {
        stopsAs2Fixed(runJob({ base, only: (s) => !isReview(s) }), `base ${JSON.stringify(base)}`);
      }
    });
  });

  describe('the word list', () => {
    it('SCAN_WORDS empty or unset is "could not run" (exit 2), not "found something" (exit 1)', () => {
      const r = runJob({ words: '' });
      stopsAs2Fixed(r, 'empty SCAN_WORDS');
      assert.equal(r.results.at(-1).step.run.includes('scripts/scan-pr-text.sh'), true, 'the scan step is the one that stops');
    });

    it('is gone after the scan step when the scan passes, and the secret is not in the output', () => {
      const r = runJob({ only: isScan });
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(r.leftContents.filter((c) => c.includes('qjmarker')), [], 'a file still holds the word list');
      assert.ok(!r.out.includes('qjmarker') && !r.out.includes('hitword'), r.out);
    });

    it('is gone after the scan step when the scan fails (exit 1 is passed on), and the secret is not in the output', () => {
      const r = runJob({ ev: event({ body: 'this says hitword here\n' }), only: isScan });
      assert.equal(r.status, 1, r.out);
      assert.deepEqual(r.leftContents.filter((c) => c.includes('qjmarker')), [], 'a file still holds the word list');
      assert.ok(!r.out.includes('qjmarker') && !r.out.includes('hitword'), r.out);
    });

    it('whose removal fails is "could not run" (exit 2), after a pass and after a fail, with no passed line', () => {
      // an rm that refuses exactly the files under RUNNER_TEMP that hold the list
      const rmShim = `for a in "$@"; do case "$a" in "$RUNNER_TEMP"/*) if [ -f "$a" ] && grep -q qjmarker "$a"; then exit 1; fi;; esac; done; exec ${REAL.rm} "$@"`;
      for (const ev of [event(), event({ body: 'this says hitword here\n' })]) {
        const r = runJob({ ev, shims: { rm: rmShim }, only: isScan });
        stopsAs2Fixed(r, 'rm of the word list fails');
        assert.ok(!r.out.includes('qjmarker') && !r.out.includes('hitword'), r.out);
      }
    });
  });
});
