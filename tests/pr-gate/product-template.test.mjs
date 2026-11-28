/**
 * Tests of templates/workflows/pr-gate.product.yml, the workflow that a product copies byte for byte to its own
 * .github/workflows/pr-gate.yml (the product mounts this framework as the git submodule `kaninabe/`). It decides whether a merge is
 * allowed in a repository that may be private and may have no ruleset, so it comes under the same class rule as the framework's own
 * gate (tests/pr-gate/wiring.test.mjs, whose reader, detector and executor this file shares through ./harness.mjs). The template is
 * product-neutral: it names no product; its only fixed names are `kaninabe/` (the mount) and `basis-paths.tsv` (the product's list).
 *   1. wiring: triggers and the job condition, permissions, no secret and no token, the checkout, the order of the steps, how the
 *      scripts are called, and the drift guard against the framework's gate; and EVERY step pinned as exact lines (the file is copied
 *      byte for byte, so a change to it changes this test first), with no run block naming a file that changes what later steps run;
 *   2. the class rule applied mechanically to every `run:` block, and the one git line pinned;
 *   3. behaviour: the run blocks are executed the way Actions runs them (`bash -e`) in a fixture PRODUCT repository (a gitlink
 *      `kaninabe`, a working-tree copy of this repository's real scripts under `kaninabe/scripts`, the product's own
 *      basis-paths.tsv, a bare origin), so that the basis step really proves the head commit present and really runs the base's
 *      check-basis-record.sh.
 * Until the template exists every test that needs it fails with the one reason "the template cannot be used" (the tests of the
 * shared reader's options, of the pinned reference and of the fixture do not need it and pass). The syntax of the real file is also
 * checked by actionlint, here when it is installed (the push gate lints only .github/workflows).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { COULD_NOT, PASSED, REAL, codeLines, gitIn, hexOf, inspect, logicalLines, parseYaml, repoRoot, runJob as runJobWith, runnerFileProblems } from './harness.mjs';

const TEMPLATE_PATH = 'templates/workflows/pr-gate.product.yml';
const FRAMEWORK_GATE_PATH = '.github/workflows/pr-gate.yml';
const EXPRESSIONS = ['github.sha', 'github.event.pull_request.number', 'github.event.pull_request.head.sha'];
/** What the template needs beyond the framework gate's reader: `submodules: true`, the job condition (`==`), and no secret expression at all. */
const READER = { expressions: EXPRESSIONS, pinned: { submodules: 'true' }, extraChars: '=' };
const parse = (text) => parseYaml(text, READER);

const FW_TEXT = readFileSync(path.join(repoRoot, FRAMEWORK_GATE_PATH), 'utf8');
const FW = parseYaml(FW_TEXT);
const FW_STEPS = FW.jobs.gate.steps;

/** The template, read once. A missing or unreadable template is not a crash of the file: every test that needs it fails with the same reason. */
const T = (() => {
  try {
    const text = readFileSync(path.join(repoRoot, TEMPLATE_PATH), 'utf8');
    const doc = parse(text);
    const job = doc.jobs?.gate;
    const steps = job?.steps ?? [];
    return { text, doc, job, steps, runs: steps.filter((s) => s.run !== undefined) };
  } catch (error) {
    return { error };
  }
})();
const need = () => {
  if (T.error) throw new Error(`the template cannot be used: ${TEMPLATE_PATH}: ${T.error.message}`);
  return T;
};
const withoutComments = (text) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

// ---- the reader, with the options this template needs ----

describe('the YAML subset reader, with the options of the product template', () => {
  it('accepts `==` and `submodules: true` only when it is told to, and still refuses what YAML would type', () => {
    const gate = 'jobs:\n  gate:\n    if: github.event.pull_request.draft == false\n';
    assert.throws(() => parseYaml(gate), /yaml:/, 'the framework reader has no `=`');
    assert.equal(parse(gate).jobs.gate.if, 'github.event.pull_request.draft == false');
    assert.throws(() => parseYaml('a: submodules\nsubmodules: true\n'), /yaml:/);
    assert.deepEqual(parse('submodules: true\n'), { submodules: 'true' });
    for (const bad of ['submodules: recursive\n', 'submodules: false\n', 'submodules: True\n', 'if: a | b\n', 'if: a != b\n', 'x: ${{ secrets.X }}\n', 'x: ${{ github.token }}\n', 'x: ${{ github.event.pull_request.title }}\n', 'x: ${{ github.head_ref }}\n']) {
      assert.throws(() => parse(bad), /yaml:/, JSON.stringify(bad));
    }
    for (const ok of EXPRESSIONS) assert.deepEqual(parse(`x: \${{ ${ok} }}\n`), { x: `\${{ ${ok} }}` });
  });
});

// ---- 0. the shape: every key must be on a list of allowed ones ----

const sameKeys = (obj, allowed, where, out) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) out.push(`${where}: key "${k}" is not allowed`);
};

/** The problems of a parsed workflow's shape and wiring (empty for the template). Anything not listed here is a problem. */
function problemsOf(doc) {
  const out = [];
  const required = (obj, keys, where) => { for (const k of keys) if (!(k in obj)) out.push(`${where}: key "${k}" is missing`); };
  if (doc === null || typeof doc !== 'object') return ['the workflow is not a map'];
  sameKeys(doc, ['name', 'on', 'permissions', 'concurrency', 'jobs'], 'workflow', out);
  required(doc, ['name', 'on', 'permissions', 'concurrency', 'jobs'], 'workflow');
  if (JSON.stringify(doc.on) !== JSON.stringify({ pull_request_target: { types: ['opened', 'edited', 'reopened', 'ready_for_review'] } })) out.push('on: exactly pull_request_target with the types opened, edited, reopened, ready_for_review (in this order)');
  if (JSON.stringify(doc.permissions) !== JSON.stringify({ contents: 'read' })) out.push('permissions: exactly contents: read');
  if (JSON.stringify(doc.concurrency) !== JSON.stringify({ group: 'pr-gate-${{ github.event.pull_request.number }}', 'cancel-in-progress': 'true' })) out.push('concurrency: one group per pull request, cancel-in-progress');
  const j = doc.jobs?.gate;
  if (!j || Object.keys(doc.jobs).length !== 1) { out.push('jobs: exactly one job, named gate'); return out; }
  sameKeys(j, ['if', 'runs-on', 'timeout-minutes', 'steps'], 'job gate', out);
  required(j, ['if', 'runs-on', 'timeout-minutes', 'steps'], 'job gate');
  if (j.if !== 'github.event.pull_request.draft == false') out.push('job gate: if is exactly `github.event.pull_request.draft == false`');
  const checkouts = (j.steps ?? []).filter((s) => 'uses' in s);
  if (checkouts.length !== 1) out.push(`${checkouts.length} steps use an action`);
  (j.steps ?? []).forEach((st, n) => {
    const where = `step ${n + 1}`;
    if ('uses' in st) {
      sameKeys(st, ['uses', 'with'], where, out);
      sameKeys(st.with ?? {}, ['ref', 'persist-credentials', 'fetch-depth', 'submodules'], `${where} with`, out);
      const fw = FW_STEPS.find((s) => 'uses' in s);
      if (st.uses !== fw.uses) out.push(`${where}: the action is not the framework gate's (${fw.uses})`);
      if (JSON.stringify(st.with) !== JSON.stringify({ ref: '${{ github.sha }}', 'persist-credentials': 'false', 'fetch-depth': '0', submodules: 'true' })) out.push(`${where}: the checkout keys are exactly ref github.sha, persist-credentials false, fetch-depth 0, submodules true`);
    } else {
      sameKeys(st, ['name', 'run', 'env'], where, out);
      required(st, ['name', 'run'], where);
      sameKeys(st.env ?? {}, ['HEAD_SHA'], `${where} env`, out);
    }
  });
  return out;
}

/** A mutated copy of the template text, as a list of problems; a text the reader refuses counts as seen. */
function seen(text) {
  try { return problemsOf(parse(text)); } catch (e) { return [`the reader refuses it: ${e.message}`]; }
}

describe('the product template: the shape is closed (only allowed keys), the wiring is exact', () => {
  it('has only allowed keys at every level, and the exact triggers, permissions, concurrency, job condition and checkout', () => {
    assert.deepEqual(problemsOf(need().doc), []);
  });

  /** Each mutation edits the text of the template in the test (never the file) and must be seen. */
  const mutations = [
    ['synchronize added to the types', 'types: [opened, edited, reopened, ready_for_review]', 'types: [opened, edited, synchronize, reopened, ready_for_review]'],
    ['labeled added to the types', 'types: [opened, edited, reopened, ready_for_review]', 'types: [opened, edited, reopened, ready_for_review, labeled]'],
    ['opened removed from the types', 'types: [opened, edited, reopened, ready_for_review]', 'types: [edited, reopened, ready_for_review]'],
    ['ready_for_review removed from the types', 'types: [opened, edited, reopened, ready_for_review]', 'types: [opened, edited, reopened]'],
    ['another event', 'pull_request_target:', 'pull_request:'],
    ['a second event', 'on:\n  pull_request_target:', 'on:\n  workflow_dispatch:\n  pull_request_target:'],
    ['the job condition removed', '    if: github.event.pull_request.draft == false\n', ''],
    ['the job condition always()', 'if: github.event.pull_request.draft == false', 'if: always()'],
    ['the job condition or true', 'if: github.event.pull_request.draft == false', 'if: github.event.pull_request.draft == false || true'],
    ['the job condition inverted', 'if: github.event.pull_request.draft == false', 'if: github.event.pull_request.draft == true'],
    ['the job condition written another way', 'if: github.event.pull_request.draft == false', 'if: github.event.pull_request.draft==false'],
    ['the job condition as an expression', 'if: github.event.pull_request.draft == false', 'if: ${{ github.event.pull_request.draft == false }}'],
    ['the job condition negated', 'if: github.event.pull_request.draft == false', 'if: !github.event.pull_request.draft'],
    ['continue-on-error on the job', '    timeout-minutes: 5\n', '    timeout-minutes: 5\n    continue-on-error: later\n'],
    ['a condition on a step', '      - name: Tie the result to what was checked\n', '      - name: Tie the result to what was checked\n        if: always()\n'],
    ['a condition on the first step', '      - name: Name the pull request', '      - if: later\n        name: Name the pull request'],
    ['shell on a step', '      - name: The review record names the head commit\n', '      - name: The review record names the head commit\n        shell: sh\n'],
    ['working-directory on a step', '      - name: The review record names the head commit\n', '      - name: The review record names the head commit\n        working-directory: tmp\n'],
    ['defaults at the top', 'permissions:\n  contents: read\n', 'permissions:\n  contents: read\ndefaults:\n  run:\n    shell: sh\n'],
    ['env at the top', 'permissions:\n  contents: read\n', 'permissions:\n  contents: read\nenv:\n  X: val\n'],
    ['a permission added', 'permissions:\n  contents: read\n', 'permissions:\n  contents: read\n  pull-requests: read\n'],
    ['a permission widened', 'permissions:\n  contents: read\n', 'permissions:\n  contents: write\n'],
    ['permissions on the job', '    timeout-minutes: 5\n', '    timeout-minutes: 5\n    permissions:\n      contents: read\n'],
    ['a key nobody listed on the job', '    timeout-minutes: 5\n', '    timeout-minutes: 5\n    outputs:\n      x: val\n'],
    ['an env name that is not allowed', '      - name: The review record names the head commit\n        env:\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n', '      - name: The review record names the head commit\n        env:\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n          GITHUB_TOKEN: x\n'],
    ['a token as an env value', '      - name: The review record names the head commit\n        env:\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n', '      - name: The review record names the head commit\n        env:\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n          GH_TOKEN: ${{ github.token }}\n'],
    ['a secret as an env value', '      - name: The review record names the head commit\n        env:\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n', '      - name: The review record names the head commit\n        env:\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n          SCAN_WORDS: ${{ secrets.SCAN_WORDS }}\n'],
    ['a token for the checkout', '          submodules: true\n', '          submodules: true\n          token: val\n'],
    ['a with key that is not allowed', '          submodules: true\n', '          submodules: true\n          lfs: val\n'],
    ['the submodules key removed', '          submodules: true\n', ''],
    ['recursive submodules', '          submodules: true\n', '          submodules: recursive\n'],
    ['fetch-depth 1', 'fetch-depth: 0', 'fetch-depth: 1'],
    ['the fetch depth removed', '          fetch-depth: 0\n', ''],
    ['persist-credentials true', '          persist-credentials: false\n', '          persist-credentials: true\n'],
    ['the head of the pull request checked out', 'ref: ${{ github.sha }}', 'ref: ${{ github.event.pull_request.head.sha }}'],
    ['another version of the checkout action', 'uses: actions/checkout@v4', 'uses: actions/checkout@v3'],
    ['another action', 'uses: actions/checkout@v4', 'uses: actions/cache@v4'],
    ['a second job', 'jobs:\n', 'jobs:\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - name: x\n        run: |\n          true\n'],
    ['the concurrency without cancel', 'cancel-in-progress: true', 'cancel-in-progress: false'],
  ];
  for (const [what, from, to] of mutations) {
    it(`fires on: ${what}`, () => {
      const { text } = need();
      assert.ok(text.includes(from), `the anchor for "${what}" is not in the template`);
      assert.equal(text.split(from).length - 1, 1, `the anchor for "${what}" is not unique`);
      assert.ok(seen(text.replace(from, to)).length > 0, `not seen: ${what}`);
    });
  }
  it('fires on a mutated parsed structure as well', () => {
    const copy = JSON.parse(JSON.stringify(need().doc));
    copy.jobs.gate.steps.at(-1)['continue-on-error'] = 'true';
    assert.ok(problemsOf(copy).length > 0);
    const copy2 = JSON.parse(JSON.stringify(need().doc));
    copy2.jobs.gate.if = 'always()';
    assert.ok(problemsOf(copy2).length > 0);
  });
});

// ---- 1. wiring ----

const STEP_KINDS = [
  ['name the pull request', (s) => s.run?.includes('pr-gate: pr ')],
  ['checkout', (s) => (s.uses ?? '').startsWith('actions/checkout@')],
  ['fork', (s) => s.run?.includes('head.repo.full_name')],
  ['scan', (s) => s.run?.includes('scan-pr-text.sh')],
  ['review', (s) => s.run?.includes('check-review-record.sh')],
  ['basis', (s) => s.run?.includes('check-basis-record.sh')],
  ['tie', (s) => s.run?.includes('pr-gate: passed')],
];

describe('the product template: wiring', () => {
  it('has no secret, no token and no credential anywhere outside comments (persist-credentials: false is the one word of the kind)', () => {
    const code = withoutComments(need().text).replace('persist-credentials: false', '');
    const hits = code.split('\n').map((l, k) => [l.trim(), k + 1]).filter(([l]) => /secrets\.|github\.token|GH_TOKEN|GITHUB_TOKEN|SCAN_WORDS|token|credential|password|passwd|ssh-key|private[_-]?key|\bpat\b/i.test(l));
    assert.deepEqual(hits, []);
    for (const s of need().steps) assert.ok(!/title|body/i.test(JSON.stringify(s.env ?? {})), `env of "${s.name}" names the title or body`);
    assert.equal(need().doc.env ?? null, null);
    assert.equal(need().job.env ?? null, null);
  });

  it('puts the head sha, and nothing else, in an env, and only for the review step and the basis step', () => {
    const withEnv = need().steps.filter((s) => s.env !== undefined);
    assert.deepEqual(withEnv.map((s) => s.name), ['The review record names the head commit', 'The basis record matches the commits of the pull request']);
    for (const s of withEnv) assert.deepEqual(s.env, { HEAD_SHA: '${{ github.event.pull_request.head.sha }}' });
  });

  it('has no expression inside any run block, and the expressions it has are exactly these (the head sha is read by the review step and by the basis step)', () => {
    // An expression is substituted into the script text before the shell runs, so one that holds text from the pull request
    // (a branch name, a label) is script injection in a job that runs with the base repository's rights.
    for (const s of need().runs) assert.ok(!s.run.includes('${{'), `the run block of "${s.name}" holds an expression`);
    const code = withoutComments(need().text);
    const found = [...code.matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(found, ['github.event.pull_request.head.sha', 'github.event.pull_request.head.sha', 'github.event.pull_request.number', 'github.sha']);
    assert.equal(code.split('${{').length - 1, found.length, 'an expression that the pattern did not read');
  });

  it('checks out github.sha only and never the pull request, and no other step takes a ref', () => {
    const { text, steps } = need();
    const checkouts = steps.filter((s) => (s.uses ?? '').startsWith('actions/checkout@'));
    assert.equal(checkouts.length, 1);
    assert.deepEqual(checkouts[0].with, { ref: '${{ github.sha }}', 'persist-credentials': 'false', 'fetch-depth': '0', submodules: 'true' });
    assert.equal(checkouts[0].uses, FW_STEPS.find((s) => 'uses' in s).uses, 'the same pinned version as the framework gate');
    assert.ok(steps.filter((s) => s.uses !== undefined).every((s) => s === checkouts[0]), 'no other action is used');
    for (const forbidden of ['github.event.pull_request.head.ref', 'refs/pull/', 'github.head_ref', 'github.event.pull_request.head.repo']) {
      const where = text.split('\n').map((l, k) => [l, k + 1]).filter(([l]) => !l.trim().startsWith('#') && l.includes(forbidden));
      assert.deepEqual(where, [], `${forbidden} must not appear outside comments`);
    }
  });

  it('has the steps in this order: name, checkout, fork, scan, review, basis, tie (the passed line is printed last)', () => {
    const { steps } = need();
    assert.equal(steps.length, STEP_KINDS.length, `${steps.length} steps`);
    STEP_KINDS.forEach(([what, is], k) => {
      assert.ok(is(steps[k]), `step ${k + 1} is not the ${what} step`);
      assert.equal(steps.filter((x) => is(x)).length, 1, `the ${what} step is not the only one of its kind`);
    });
  });

  it('prints the passed line only in the last step, with the format of the framework gate', () => {
    const { steps } = need();
    assert.deepEqual(steps.filter((s) => s.run?.includes('pr-gate: passed')), [steps.at(-1)]);
    assert.ok(steps.at(-1).run.includes('printf \'pr-gate: passed pr %s head %s base %s text sha256 %s\\n\' "$n" "$head" "$GITHUB_SHA" "$hash"'));
  });

  /** The problems of how the run blocks of a list of steps call scripts and read the list (empty for the template). */
  function scriptCallProblems(runs) {
    const out = [];
    const lines = runs.flatMap((s) => codeLines(s.run));
    const names = [];
    for (const l of lines) {
      for (const m of l.matchAll(/scripts\/[A-Za-z0-9._-]+/g)) {
        if (!/(^|[^\w./$-])sh kaninabe\/$/.test(l.slice(0, m.index))) out.push(`a script that is not called as "sh kaninabe/scripts/NAME": ${l}`);
        names.push(m[0].slice('scripts/'.length));
      }
    }
    if (JSON.stringify(names.sort()) !== JSON.stringify(['check-basis-record.sh', 'check-review-record.sh', 'scan-pr-text.sh'])) out.push(`the scripts called are not exactly the three: ${names.join(' ')}`);
    for (const n of names) if (!existsSync(path.join(repoRoot, 'scripts', n))) out.push(`scripts/${n} does not exist`);
    const lists = lines.filter((l) => l.includes('basis-paths.tsv'));
    if (lists.length !== 1 || !lists[0].endsWith('--list basis-paths.tsv || rc=$?')) out.push('the list is read once, as --list basis-paths.tsv (the base checkout\'s own file)');
    if (runs.some((s) => s.run.includes('GITHUB_WORKSPACE') || /RUNNER_TEMP\/[^"\s]*(scripts|basis-paths)/.test(s.run))) out.push('something is taken from another directory');
    return out;
  }
  it('calls three scripts, each as `sh kaninabe/scripts/NAME`, that exist in this repository, and reads the product\'s list from the base checkout', () => {
    assert.deepEqual(scriptCallProblems(need().runs), []);
  });
  it('sees a script called without the kaninabe/ prefix, by another shell, from a path of the head, a fourth script, and another list', () => {
    for (const [from, to] of [
      ['sh kaninabe/scripts/check-review-record.sh', 'sh scripts/check-review-record.sh'], ['sh kaninabe/scripts/check-review-record.sh', 'sh ./kaninabe/scripts/check-review-record.sh'],
      ['sh kaninabe/scripts/check-review-record.sh', 'bash kaninabe/scripts/check-review-record.sh'], ['sh kaninabe/scripts/scan-pr-text.sh', 'sh "$GITHUB_WORKSPACE/kaninabe/scripts/scan-pr-text.sh"'],
      ['sh kaninabe/scripts/check-review-record.sh', 'sh kaninabe/scripts/check-review-record.sh\n          sh kaninabe/scripts/classify-paths.sh'], ['--list basis-paths.tsv', '--list "$RUNNER_TEMP/basis-paths.tsv"'], ['--list basis-paths.tsv', '--list kaninabe/basis-paths.tsv'],
    ]) {
      const { text } = need();
      assert.ok(text.includes(from), from);
      const doc = parse(text.replace(from, to));
      assert.ok(scriptCallProblems(doc.jobs.gate.steps.filter((s) => s.run)).length > 0, `not seen: ${to}`);
    }
  });

  it('has no word list: the scan step names none, and no SCAN_WORDS exists anywhere in the file', () => {
    const { text, steps } = need();
    assert.ok(!/SCAN_WORDS|word list|words/i.test(withoutComments(text)), 'a word list in code');
    const scan = steps.find((s) => s.run?.includes('scan-pr-text.sh'));
    assert.equal(scan.env, undefined);
    assert.deepEqual(codeLines(scan.run).filter((l) => l.includes('scan-pr-text.sh')), ['sh kaninabe/scripts/scan-pr-text.sh "$text" || rc=$?']);
  });

  it('keeps the review step as a call with two arguments (the basis check runs the review check with --emit itself)', () => {
    const review = need().steps.find((s) => s.run?.includes('check-review-record.sh'));
    assert.deepEqual(codeLines(review.run).filter((l) => l.includes('check-review-record.sh')), ['sh kaninabe/scripts/check-review-record.sh "$body" "$HEAD_SHA"']);
    assert.ok(!review.run.includes('--emit'));
  });

  it('has a fork step that turns a pull request from another repository red', () => {
    const fork = need().runs.filter((s) => s.run.includes('head.repo.full_name'));
    assert.equal(fork.length, 1);
    assert.match(fork[0].run, /GITHUB_REPOSITORY/);
  });

  it('states why a fork is red in a product, in a comment: the run works with the base\'s rights and the gate needs a head commit that is in the repository (it does not say that a fork receives the token)', () => {
    const comments = need().text.split('\n').filter((l) => l.trim().startsWith('#')).join('\n').replace(/\n#\s*/g, ' ');
    assert.match(comments, /pull request from a fork is red first, with a clear message/);
    assert.match(comments, /works with the base's rights/);
    assert.match(comments, /head commit that is in the repository itself/);
    assert.match(comments, /not in the checkout/);
    assert.ok(!/(gives|hands|passes|receives)[^.]*token[^.]*fork|fork[^.]*(gets|receives)[^.]*token/i.test(comments), 'a claim that a fork gets the token');
    assert.match(comments, /names no token and no secret/);
    assert.match(comments, /Where the product has no ruleset/);
    assert.match(comments, /cmp/);
  });
});

// ---- drift guard against the framework's gate ----

/**
 * What "equal" means. The steps that a product must run exactly as the framework does are the name step, the fork step, the review
 * step and the tie step. Two such steps are equal when they have the same `name`, the same `env` (both none, or the same map) and the
 * same `run` text once `sh kaninabe/scripts/` in the template is read as `sh scripts/`. Comments are not part of a step. The
 * checkout, the scan step (no word list) and the basis step (the head commit is proved, not fetched) differ by design: they are
 * not compared here, each is pinned on its own.
 */
function driftProblems(templateSteps, frameworkSteps) {
  const out = [];
  const kinds = STEP_KINDS.filter(([what]) => ['name the pull request', 'fork', 'review', 'tie'].includes(what));
  for (const [what, is] of kinds) {
    const a = templateSteps.filter((s) => is(s));
    const b = frameworkSteps.filter((s) => is(s));
    if (a.length !== 1 || b.length !== 1) { out.push(`${what}: ${a.length} step(s) in the template, ${b.length} in the framework gate`); continue; }
    if (a[0].name !== b[0].name) out.push(`${what}: the name differs`);
    if (JSON.stringify(a[0].env ?? null) !== JSON.stringify(b[0].env ?? null)) out.push(`${what}: the env differs`);
    if (a[0].run.split('sh kaninabe/scripts/').join('sh scripts/') !== b[0].run) out.push(`${what}: the run text differs`);
  }
  return out;
}

describe('the product template: the steps it shares with the framework gate do not drift', () => {
  it('has the name, fork, review and tie steps equal to the framework gate\'s, apart from the kaninabe/ prefix of a script call', () => {
    assert.deepEqual(driftProblems(need().steps, FW_STEPS), []);
  });

  it('sees a change of a name, an env, or one character of a run text, and a framework gate that changed', () => {
    const copy = () => JSON.parse(JSON.stringify(need().steps));
    const edit = (what, fn) => { const c = copy(); fn(c); assert.ok(driftProblems(c, FW_STEPS).length > 0, `not seen: ${what}`); };
    const find = (c, re) => c.find((s) => s.run && re.test(s.run));
    edit('the tie step: a character', (c) => { const s = find(c, /pr-gate: passed/); s.run = s.run.replace('is_hex "$hash" 64', 'is_hex "$hash" 63'); });
    edit('the tie step: a line removed', (c) => { const s = find(c, /pr-gate: passed/); s.run = s.run.replace('cmp -s "$text.want" "$text.sum" || stop "the hash record is not exactly one line"\n', ''); });
    edit('the fork step: the message', (c) => { const s = find(c, /head\.repo/); s.run = s.run.replace('is not gated here', 'is gated here'); });
    edit('the fork step: the exit', (c) => { const s = find(c, /head\.repo/); s.run = s.run.replace('exit 1; }', 'exit 0; }'); });
    edit('the name step: the first line', (c) => { const s = find(c, /pr-gate: pr /); s.run = s.run.replace('echo "pr-gate: pr $n"', 'echo "pr $n"'); });
    edit('the review step: the call', (c) => { const s = find(c, /check-review-record\.sh/); s.run = s.run.replace('"$body" "$HEAD_SHA"', '"$body"'); });
    edit('the review step: its name', (c) => { find(c, /check-review-record\.sh/).name = 'Review'; });
    edit('the review step: an env added', (c) => { find(c, /check-review-record\.sh/).env.X = 'y'; });
    edit('the tie step: an env added', (c) => { find(c, /pr-gate: passed/).env = { HEAD_SHA: 'x' }; });
    // a framework gate that changes its own tie step is seen as well (the template must then be updated with it)
    const fw = JSON.parse(JSON.stringify(FW_STEPS));
    const tie = fw.find((s) => s.run?.includes('pr-gate: passed'));
    tie.run = tie.run.replace('is_hex "$hash" 64', 'is_hex "$hash" 63');
    assert.ok(driftProblems(need().steps, fw).length > 0);
  });
});

// ---- 2. the class rule on every run block ----

describe('the product template: the class rule on every run block', () => {
  it('has run blocks to look at, and a live detector', () => {
    assert.equal(need().runs.length, 6, `${need().runs.length} run blocks`);
    assert.ok(inspect('x=$(a | b)').problems.length > 0 && inspect('a || true').problems.length > 0, 'the detector is live');
  });

  it('has no pipeline, no `|| true`, no bare grep and none of the other constructs the detector names', () => {
    const offences = [];
    need().runs.forEach((s, n) => logicalLines(s.run).forEach((line, k) => {
      const r = inspect(line);
      if (r.problems.length) offences.push(`run ${n + 1} (${s.name}) line ${k + 1}: ${r.problems.join(', ')}`);
    }));
    assert.deepEqual(offences, []);
  });

  it('has no `$(...)` directly in an argument of echo or printf, and none behind export / local / readonly', () => {
    const offences = [];
    need().runs.forEach((s, n) => logicalLines(s.run).forEach((line, k) => {
      for (const part of line.trim().split(/;|&&|\|\||\bthen\b|\bdo\b|\{/)) {
        const p = part.trim();
        if (/^(echo|printf)\b/.test(p) && p.includes('$(')) offences.push(`run ${n + 1} line ${k + 1}: ${p}`);
        if (/^(export|local|readonly|declare|typeset)\s+[A-Za-z_][A-Za-z0-9_]*=.*\$\(/.test(p)) offences.push(`run ${n + 1} line ${k + 1}: ${p}`);
      }
    }));
    assert.deepEqual(offences, []);
  });

  it('sees a pipeline, `|| true` and an unchecked substitution put into the template\'s own lines', () => {
    for (const [from, to] of [
      ['sha256sum < "$text" > "$text.sum" ||', 'sha256sum < "$text" | cat > "$text.sum" ||'],
      ['cmp -s "$text.want" "$text.sum" || stop "the hash record is not exactly one line"', 'cmp -s "$text.want" "$text.sum" || true'],
      ['sh kaninabe/scripts/scan-pr-text.sh "$text" || rc=$?', 'sh kaninabe/scripts/scan-pr-text.sh "$text" | cat || rc=$?'],
      ['echo "pr-gate: pr $n"', 'echo "pr-gate: pr $(jq -r .pull_request.number "$GITHUB_EVENT_PATH")"'],
    ]) {
      const { text } = need();
      assert.ok(text.includes(from), from);
      const doc = parse(text.replace(from, to));
      const bad = doc.jobs.gate.steps.filter((s) => s.run).some((s) => logicalLines(s.run).some((l) => inspect(l).problems.length > 0 || l.split(/;|&&|\|\|/).some((p) => /^(echo|printf)\b/.test(p.trim()) && p.includes('$('))));
      assert.ok(bad, `not seen: ${to}`);
    }
  });
});

// ---- 2b. the closed shape of the run blocks, and the basis step pinned line for line ----

/**
 * The specification of the basis step: its non-comment lines, exactly (the template is written to be this, line for line). The
 * shape is closed on purpose: a step that has the head commit at hand can be made to run head code with a few more lines (an archive, an
 * extract, a call), and a list of the words that must not appear cannot name every way. There is one git line, and it only asks
 * whether the head commit is in the object store: it does not fetch, and it uses no credential.
 */
const GIT_LINE = 'git cat-file -e "$HEAD_SHA^{commit}" > "$presence" 2>&1 || stop "the head commit is not in the checkout"';
const BASIS_STEP_LINES = [
  'stop() { echo "pr-gate: could not run ($1)"; exit 2; }',
  'is_hex() { case $1 in \'\'|*[!0-9a-f]*) return 1 ;; esac; [ "${#1}" = "$2" ]; }',
  'is_hex "$HEAD_SHA" 40 || stop "the head sha is not 40 hex characters"',
  'is_hex "$GITHUB_SHA" 40 || stop "the base sha is not 40 hex characters"',
  'body="$RUNNER_TEMP/pr-body"',
  'jq -r \'.pull_request.body // ""\' "$GITHUB_EVENT_PATH" > "$body" || stop "cannot read the body"',
  'n=$(jq -r \'.pull_request.number\' "$GITHUB_EVENT_PATH") || stop "cannot read the pull request number"',
  'case $n in \'\'|*[!0-9]*) stop "the pull request number is not a number" ;; esac',
  'presence="$RUNNER_TEMP/head-presence"',
  GIT_LINE,
  'rc=0',
  'sh kaninabe/scripts/check-basis-record.sh --body "$body" --head "$HEAD_SHA" --base "$GITHUB_SHA" --repo "$GITHUB_REPOSITORY" --pr "$n" --list basis-paths.tsv || rc=$?',
  'case $rc in',
  '0|1|2) exit "$rc" ;;',
  '*) stop "the basis check ended with status $rc" ;;',
  'esac',
];
const BASIS_STEP = { name: 'The basis record matches the commits of the pull request', env: { HEAD_SHA: '${{ github.event.pull_request.head.sha }}' }, run: `${BASIS_STEP_LINES.join('\n')}\n` };

/** What is wrong with the run blocks of a list of steps (empty when the shape is the closed one). */
function runClosureProblems(list) {
  const out = [];
  const rs = list.filter((s) => s.run !== undefined);
  const basis = rs.filter((s) => s.run.includes('check-basis-record.sh'));
  if (basis.length !== 1) out.push(`${basis.length} steps run the basis check`);
  else if (JSON.stringify(codeLines(basis[0].run)) !== JSON.stringify(BASIS_STEP_LINES)) out.push('the basis step is not exactly the pinned lines');
  const gitLines = rs.flatMap((s) => codeLines(s.run)).filter((l) => /\bgit\b/.test(l));
  if (gitLines.length !== 1) out.push(`the word git is on ${gitLines.length} lines`);
  else if (gitLines[0] !== GIT_LINE) out.push(`the one git line is not the pinned line: ${gitLines[0]}`);
  for (const s of rs) {
    for (const l of codeLines(s.run)) {
      if (/\b(tar|unzip|bash|source|eval|exec|curl|wget|gh|node|python3?|perl|ruby|xargs|nohup)\b|\/(sh|dash|zsh|ksh|busybox)(?![\w.-])/.test(l)) out.push(`a command that must not be here: ${l}`);
      if (/(^|[;&({]\s*|\bthen\s+|\bdo\s+)\.\s/.test(l)) out.push(`a dot command: ${l}`);
      for (const m of l.matchAll(/(?<![\w./$-])sh(?![\w.-])/g)) {
        if (!/^ kaninabe\/scripts\/[a-z][a-z0-9-]*\.sh(?: |$)/.test(l.slice(m.index + 2))) out.push(`a sh that is not "sh kaninabe/scripts/NAME.sh": ${l}`);
      }
    }
  }
  return out;
}
/** The steps of the real template with the specified basis step in place of the basis step (or put before the last step), then `mutate(copy)`. */
const withReference = (steps, mutate = () => {}) => {
  const copy = JSON.parse(JSON.stringify(steps)).filter((s) => !(s.run ?? '').includes('check-basis-record.sh'));
  copy.splice(copy.length - 1, 0, JSON.parse(JSON.stringify(BASIS_STEP)));
  mutate(copy);
  return copy;
};
const basisOf = (list) => list.find((s) => (s.run ?? '').includes('check-basis-record.sh'));

describe('the product template: the run blocks are of the closed shape', () => {
  it('has a basis step that is exactly the pinned lines (and its name and env), one git line that is the pinned cat-file line, and nothing that unpacks or runs other code', () => {
    const { steps } = need();
    assert.deepEqual(runClosureProblems(steps), []);
    const basis = basisOf(steps);
    assert.equal(basis.name, BASIS_STEP.name);
    assert.deepEqual(basis.env, BASIS_STEP.env);
  });

  it('proves the head commit present with that one line: its output goes to a file that is never read or printed, and the message is the fixed one', () => {
    const { steps } = need();
    const basis = basisOf(steps);
    assert.equal(basis.run.split('$presence').length - 1, 1, 'the file of git\'s output is used only as the target of the redirect');
    const code = need().runs.flatMap((s) => codeLines(s.run));
    for (const sub of ['fetch', 'show', 'checkout', 'switch', 'worktree', 'reset', 'merge', 'apply', 'restore', 'read-tree', 'submodule', 'clone', 'pull', 'archive', 'diff', 'log', 'rev-parse', 'remote', 'config', 'credential']) {
      assert.ok(!code.some((l) => new RegExp(`\\bgit\\s+(-\\S+\\s+)*${sub}\\b`).test(l)), `git ${sub}`);
    }
    assert.ok(!/\bgh\b|\bcurl\b|\bwget\b|\bauth\b|\bcredential|\bfetch\b/.test(need().runs.map((s) => s.run).join('\n')), 'no other way to reach the head, and no credential');
    assert.match(GIT_LINE, /stop "the head commit is not in the checkout"$/);
  });

  it('the pinned lines themselves are inside that shape (so the checks below find a mutation, not the reference)', () => {
    // independent of the template: the reference basis step next to the framework gate's other steps, `scripts/` read as `kaninabe/scripts/`
    const fwSteps = FW_STEPS.map((s) => (s.run ? { ...s, run: s.run.split('sh scripts/').join('sh kaninabe/scripts/') } : s)).filter((s) => !(s.run ?? '').includes('git fetch'));
    const ref = withReference(fwSteps);
    assert.deepEqual(runClosureProblems(ref), []);
  });

  describe('the closed shape sees a basis step that runs code of the head', () => {
    const fwBase = () => FW_STEPS.map((s) => (s.run ? { ...s, run: s.run.split('sh scripts/').join('sh kaninabe/scripts/') } : s));
    const base = () => withReference(fwBase().filter((s) => !(s.run ?? '').includes('git fetch')));
    const four = (git) => `h=$(mktemp -d) || stop "x"\n${git} archive -o "$h.tar" "$HEAD_SHA" 2> "$h.err" || stop "x"\ntar -x -f "$h.tar" -C "$h" || stop "x"\nif [ -f "$h/run-me.sh" ]; then bash "$h/run-me.sh" > "$h.out" 2>&1 || stop "x"; fi\n`;
    const inFront = (extra) => (list) => { const b = basisOf(list); b.run = b.run.replace('rc=0\n', `${extra}rc=0\n`); };
    for (const git of ['git', '"git"', '$(command -v git)', '/usr/bin/git']) {
      it(`archive, extract and run before the pinned call, git written as ${git}`, () => {
        const list = base();
        inFront(four(git))(list);
        const problems = runClosureProblems(list);
        assert.ok(problems.includes('the basis step is not exactly the pinned lines'), problems.join(' // '));
      });
    }
    it('a fetch in place of the presence check, a second git line, a credential helper, and the pinned line with another output or message', () => {
      const edits = [
        ['a fetch', (r) => r.replace(GIT_LINE, 'git fetch --no-tags --no-recurse-submodules origin "$HEAD_SHA" > "$presence" 2>&1 || stop "the head commit is not in the checkout"')],
        ['a second git line', (r) => r.replace('rc=0\n', 'git cat-file -e "$GITHUB_SHA^{commit}" > "$presence" 2>&1 || stop "x"\nrc=0\n')],
        ['a credential helper', (r) => r.replace(GIT_LINE, GIT_LINE.replace('git cat-file', "git -c credential.helper='!gh auth git-credential' cat-file"))],
        ['the output printed', (r) => r.replace(' > "$presence" 2>&1', '')],
        ['the status not checked', (r) => r.replace(' || stop "the head commit is not in the checkout"', ' || true')],
        ['another message', (r) => r.replace('the head commit is not in the checkout', 'no head')],
        ['the line removed', (r) => r.replace(`${GIT_LINE}\n`, '')],
        ['a changed message elsewhere', (r) => r.replace('cannot read the body', 'cannot read it')],
        ['an added line', (r) => `${r}true\n`],
        ['a removed line', (r) => r.replace('rc=0\n', '')],
        ['a reordered pair', (r) => r.replace('body="$RUNNER_TEMP/pr-body"\n', '').replace('rc=0\n', 'rc=0\nbody="$RUNNER_TEMP/pr-body"\n')],
      ];
      for (const [what, edit] of edits) {
        const list = base();
        const b = basisOf(list);
        b.run = edit(b.run);
        assert.ok(runClosureProblems(list).length > 0, `not seen: ${what}`);
      }
    });
    it('the same lines in any other step are seen as well: a second git, a fetch, tar, bash, a dot command, source, another sh', () => {
      const review = (list) => list.find((s) => (s.run ?? '').includes('check-review-record.sh'));
      const seenIn = [
        ['a second line with git', '/usr/bin/git archive -o "$h.tar" "$HEAD_SHA"', /word git is on 2 lines/],
        ['a fetch', 'git fetch origin "$HEAD_SHA"', /word git is on 2 lines/],
        ['git inside a quote', 'x="git" y', /word git is on 2 lines/],
        ['tar', 'tar -x -f "$h.tar" -C "$h"', /must not be here/],
        ['bash', 'bash "$h/run-me.sh"', /must not be here/],
        ['gh', 'gh api x', /must not be here/],
        ['source', 'source "$h/run-me.sh"', /must not be here/],
        ['a dot command', '. "$h/run-me.sh"', /a dot command/],
        ['a dot command after a semicolon', 'true; . "$h/run-me.sh"', /a dot command/],
        ['an sh with a path of the head', 'sh "$h/run-me.sh"', /a sh that is not/],
        ['an sh with the framework\'s own script directory', 'sh scripts/run-me.sh', /a sh that is not/],
        ['an sh by an absolute path', '/bin/sh "$h/run-me.sh"', /must not be here/],
        ['unzip', 'unzip x', /must not be here/],
      ];
      for (const [what, line, re] of seenIn) {
        const list = base();
        const r = review(list);
        r.run = `${line}\n${r.run}`;
        const problems = runClosureProblems(list);
        assert.ok(problems.some((p) => re.test(p)), `${what}: ${problems.join(' // ')}`);
      }
    });
  });
});

/**
 * EVERY step of the template as exact lines, and the workflow's name, runner and timeout. The template is copied byte for byte by a
 * product, so a change to it must change this test first; a closed list of words that must not appear cannot name every way to
 * make a step run something else (a write to the file named by GITHUB_ENV that a later step reads, for one), so the lines are the
 * specification. Comments are not code and are not pinned. The name, fork, review and tie steps are also held equal to the framework
 * gate's (the drift guard above).
 */
const HEAD_ENV = { HEAD_SHA: '${{ github.event.pull_request.head.sha }}' };
const STOP = 'stop() { echo "pr-gate: could not run ($1)"; exit 2; }';
const NUMBER_CHECK = 'case $n in \'\'|*[!0-9]*) stop "the pull request number is not a number" ;; esac';
const SPEC_STEPS = [
  { name: 'Name the pull request (first, so that a run that fails later can still be told apart)', lines: [
    STOP,
    'n=$(jq -r \'.pull_request.number\' "$GITHUB_EVENT_PATH") || stop "cannot read the pull request number"',
    NUMBER_CHECK,
    'echo "pr-gate: pr $n"',
  ] },
  { uses: 'actions/checkout@v4', with: { ref: '${{ github.sha }}', 'persist-credentials': 'false', 'fetch-depth': '0', submodules: 'true' } },
  { name: 'Only pull requests from this repository', lines: [
    STOP,
    'from=$(jq -r \'.pull_request.head.repo.full_name // ""\' "$GITHUB_EVENT_PATH") || stop "cannot read the head repository"',
    '[ "$from" = "$GITHUB_REPOSITORY" ] || { echo "pr-gate: a pull request from a fork is not gated here (push the branch to this repository)"; exit 1; }',
  ] },
  { name: 'Scan the title and body (the squash commit message)', lines: [
    STOP,
    'for f in scan-pr-text check-review-record check-basis-record; do',
    '[ -f "kaninabe/scripts/$f.sh" ] || stop "the framework is not in the checkout"',
    'done',
    'text="$RUNNER_TEMP/pr-text"; umask 077',
    'jq -r \'.pull_request.title, "", (.pull_request.body // "")\' "$GITHUB_EVENT_PATH" > "$text" || stop "cannot read the title and body"',
    'rc=0',
    'sh kaninabe/scripts/scan-pr-text.sh "$text" || rc=$?',
    'case $rc in',
    '0|1|2) exit "$rc" ;;',
    '*) stop "the scan ended with status $rc" ;;',
    'esac',
  ] },
  { name: 'The review record names the head commit', env: HEAD_ENV, lines: [
    STOP,
    'body="$RUNNER_TEMP/pr-body"',
    'jq -r \'.pull_request.body // ""\' "$GITHUB_EVENT_PATH" > "$body" || stop "cannot read the body"',
    'sh kaninabe/scripts/check-review-record.sh "$body" "$HEAD_SHA"',
  ] },
  { name: BASIS_STEP.name, env: BASIS_STEP.env, lines: BASIS_STEP_LINES },
  { name: 'Tie the result to what was checked', lines: [
    STOP,
    'is_hex() { case $1 in \'\'|*[!0-9a-f]*) return 1 ;; esac; [ "${#1}" = "$2" ]; }',
    'text="$RUNNER_TEMP/pr-text"',
    'n=$(jq -r \'.pull_request.number\' "$GITHUB_EVENT_PATH") || stop "cannot read the pull request number"',
    'head=$(jq -r \'.pull_request.head.sha\' "$GITHUB_EVENT_PATH") || stop "cannot read the head sha"',
    'sha256sum < "$text" > "$text.sum" || stop "cannot hash the title and body"',
    'IFS= read -r line < "$text.sum" || stop "cannot read the hash record"',
    'hash=${line%  -}',
    '[ "$hash" != "$line" ] || stop "the hash record does not end in two blanks and a dash"',
    'printf \'%s  -\\n\' "$hash" > "$text.want" || stop "cannot write the expected hash record"',
    'cmp -s "$text.want" "$text.sum" || stop "the hash record is not exactly one line"',
    NUMBER_CHECK,
    'is_hex "$head" 40 || stop "the head sha is not 40 hex characters"',
    'is_hex "$GITHUB_SHA" 40 || stop "the base sha is not 40 hex characters"',
    'is_hex "$hash" 64 || stop "the hash is not 64 hex characters"',
    'printf \'pr-gate: passed pr %s head %s base %s text sha256 %s\\n\' "$n" "$head" "$GITHUB_SHA" "$hash"',
  ] },
];

/** What differs from the pinned template: the workflow name, the runner and timeout, and every step (name, env, with, code lines). */
function pinProblems(doc) {
  const out = [];
  if (doc.name !== 'pr-gate') out.push('the workflow name is not pr-gate');
  const j = doc.jobs?.gate ?? {};
  if (j['runs-on'] !== 'ubuntu-latest') out.push('runs-on is not ubuntu-latest');
  if (j['timeout-minutes'] !== '5') out.push('timeout-minutes is not 5');
  const actual = (j.steps ?? []).map((s) => (s.uses !== undefined ? { uses: s.uses, with: s.with } : { name: s.name, ...(s.env ? { env: s.env } : {}), lines: codeLines(s.run ?? '') }));
  if (actual.length !== SPEC_STEPS.length) out.push(`${actual.length} steps, not ${SPEC_STEPS.length}`);
  SPEC_STEPS.forEach((want, k) => {
    if (JSON.stringify(actual[k]) !== JSON.stringify(want)) out.push(`step ${k + 1} is not the pinned step`);
  });
  return out;
}
/** A mutated template text, seen by the pin, by the words that change what later steps run, or by the reader (empty = not seen). */
function pinSeen(text) {
  try {
    const doc = parse(text);
    return [...pinProblems(doc), ...(doc.jobs?.gate?.steps ?? []).filter((s) => s.run).flatMap((s) => runnerFileProblems(s.run))];
  } catch (e) { return [`the reader refuses it: ${e.message}`]; }
}

describe('the product template: every step is pinned as exact lines', () => {
  it('is exactly the pinned template: name, runner, timeout, and the name, env, keys and code lines of every step', () => {
    assert.deepEqual(pinProblems(need().doc), []);
  });

  it('is written in printable ASCII with line feeds only (a space that is not ASCII would slip past a pin that trims its lines)', () => {
    const bad = need().text.split('\n').flatMap((l, n) => (/^[\x20-\x7e]*$/.test(l) ? [] : [`line ${n + 1}`]));
    assert.deepEqual(bad, []);
  });

  it('names none of GITHUB_ENV, GITHUB_PATH, GITHUB_OUTPUT, GITHUB_STATE, BASH_ENV in any run block', () => {
    assert.deepEqual(need().runs.flatMap((s, n) => runnerFileProblems(s.run).map((p) => `run ${n + 1}: ${p}`)), []);
  });

  /** Each mutation edits the template text in the test (never the file) and must be seen. */
  const SCAN_CALL = '          rc=0\n          sh kaninabe/scripts/scan-pr-text.sh "$text" || rc=$?\n';
  const injected = (line) => [SCAN_CALL, `          ${line}\n${SCAN_CALL}`];
  const pinMutations = [
    ['a write to the file of GITHUB_ENV with a default, in the scan step (the form that passed the class rule)', ...injected('printf \'BASH_ENV=%s\\n\' "$text" >> "${GITHUB_ENV:-/dev/null}" || stop "x"')],
    ['a write to GITHUB_PATH', ...injected('echo x >> "$GITHUB_PATH" || stop "x"')],
    ['a write to GITHUB_OUTPUT', ...injected('echo x >> "$GITHUB_OUTPUT" || stop "x"')],
    ['a write to GITHUB_STATE', ...injected('echo x >> "$GITHUB_STATE" || stop "x"')],
    ['BASH_ENV set', ...injected('BASH_ENV=/x')],
    ['an harmless extra line', ...injected('true')],
    ['the scan call with another argument', 'sh kaninabe/scripts/scan-pr-text.sh "$text" || rc=$?', 'sh kaninabe/scripts/scan-pr-text.sh "$text" x || rc=$?'],
    ['the scan exit mapping widened', 'case $rc in\n            0|1|2) exit "$rc" ;;\n            *) stop "the scan ended', 'case $rc in\n            0|1|2|3) exit "$rc" ;;\n            *) stop "the scan ended'],
    ['the framework check removed', '          for f in scan-pr-text check-review-record check-basis-record; do\n            [ -f "kaninabe/scripts/$f.sh" ] || stop "the framework is not in the checkout"\n          done\n', ''],
    ['the framework check with another message', 'stop "the framework is not in the checkout"', 'stop "no framework"'],
    ['the framework check without a script', 'for f in scan-pr-text check-review-record check-basis-record; do', 'for f in scan-pr-text check-basis-record; do'],
    ['the runner changed', 'runs-on: ubuntu-latest', 'runs-on: ubuntu-22.04'],
    ['the timeout changed', 'timeout-minutes: 5', 'timeout-minutes: 6'],
    ['the workflow renamed', 'name: pr-gate\n\n#', 'name: gate\n\n#'],
    ['a step renamed', '      - name: Only pull requests from this repository', '      - name: Only pull requests from here'],
    ['the fork exit changed', 'exit 1; }', 'exit 0; }'],
    ['a line of the tie step', 'is_hex "$hash" 64 || stop "the hash is not 64 hex characters"', 'is_hex "$hash" 63 || stop "the hash is not 64 hex characters"'],
    ['a line of the review step', 'jq -r \'.pull_request.body // ""\' "$GITHUB_EVENT_PATH" > "$body" || stop "cannot read the body"\n          sh kaninabe/scripts/check-review-record.sh', 'jq -r \'.pull_request.body // ""\' "$GITHUB_EVENT_PATH" > "$body" || stop "cannot read the body"\n          true\n          sh kaninabe/scripts/check-review-record.sh'],
    ['a line of the name step', 'echo "pr-gate: pr $n"', 'echo "pr-gate: pr $n"; true'],
    ['a line of the basis step', 'case $rc in\n            0|1|2) exit "$rc" ;;\n            *) stop "the basis check', 'case $rc in\n            0|1|2|3) exit "$rc" ;;\n            *) stop "the basis check'],
    ['the umask line', 'text="$RUNNER_TEMP/pr-text"; umask 077', 'text="$RUNNER_TEMP/pr-text"; umask 022'],
  ];
  for (const [what, from, to] of pinMutations) {
    it(`fires on: ${what}`, () => {
      const { text } = need();
      assert.ok(text.includes(from), `the anchor for "${what}" is not in the template`);
      assert.equal(text.split(from).length - 1, 1, `the anchor for "${what}" is not unique`);
      assert.ok(pinSeen(text.replace(from, to)).length > 0, `not seen: ${what}`);
    });
  }
  it('the words that change what later steps run are seen by the shared check alone as well, in every run block of the template', () => {
    for (const [n, s] of need().runs.entries()) {
      for (const form of ['printf \'BASH_ENV=%s\\n\' "$text" >> "${GITHUB_ENV:-/dev/null}" || stop "x"', 'echo x >> "$GITHUB_PATH"', 'echo x >> $GITHUB_OUTPUT', 'echo x >> "${GITHUB_STATE}"', 'BASH_ENV=/x', 'echo x >> "$GITHUB_E""NV"']) {
        assert.ok(runnerFileProblems(`${form}\n${s.run}`).length > 0, `not seen in run ${n + 1}: ${form}`);
      }
    }
  });
});

// ---- 3. behaviour: the run blocks, executed in a fixture product repository ----

/**
 * The fixture: a PRODUCT repository. One commit on `main` (the base): the product's own basis-paths.tsv, .gitmodules, a doc, and the
 * gitlink `kaninabe` (made with update-index: its target is not an object of this repository, as with a submodule). `origin` is a
 * bare clone that holds the base and four pull request branches. The workspaces are clones of it with a working-tree copy of this
 * repository's real scripts under `kaninabe/scripts`, the way `submodules: true` leaves them:
 *   workAll   a plain clone (every branch is there, as with the checkout's fetch depth zero)
 *   workMain  a clone of main only (the head commits are NOT in the object store)
 * The branches:
 *   ok      one commit: a basis path only
 *   mixed   a basis commit, then an implementation commit (a mixed change)
 *   record  the same shape as mixed; its first commit is the one a record names as `basis`
 *   evil    one commit that moves the gitlink to another commit, rewrites basis-paths.tsv to all-implementation, and adds a basis file
 *           and an implementation file (a head that tries to be judged by its own list and its own framework)
 */
const PRODUCT_LIST = 'implementation\t.github/workflows/*\tworkflows are code\nbasis\tkaninabe\tthe pinned framework decides what is checked\nbasis\t.gitmodules\twhere the framework comes from\n';
const FIX = (() => {
  const root = mkdtempSync(path.join(tmpdir(), 'pr-gate-product-fixture-'));
  process.on('exit', () => rmSync(root, { recursive: true, force: true }));
  const g = gitIn;
  const seed = path.join(root, 'seed');
  mkdirSync(seed);
  g(seed, 'init', '-q', '-b', 'main');
  const write = (files) => { for (const [f, c] of Object.entries(files)) { mkdirSync(path.dirname(path.join(seed, f)), { recursive: true }); writeFileSync(path.join(seed, f), c); } };
  const FRAMEWORK_ONE = 'a1'.repeat(20);
  const FRAMEWORK_TWO = 'b2'.repeat(20);
  write({ 'basis-paths.tsv': PRODUCT_LIST, '.gitmodules': '[submodule "kaninabe"]\n\tpath = kaninabe\n\turl = ../framework.git\n', 'docs/seed.md': 'seed\n' });
  g(seed, 'add', '--', 'basis-paths.tsv', '.gitmodules', 'docs/seed.md');
  g(seed, 'update-index', '--add', '--cacheinfo', `160000,${FRAMEWORK_ONE},kaninabe`);
  g(seed, 'commit', '-q', '-m', 'base');
  const base = g(seed, 'rev-parse', 'HEAD');
  const branch = (name, commits) => {
    g(seed, 'checkout', '-q', '-b', name, base);
    return commits.map(({ files = {}, gitlink }) => {
      write(files);
      if (Object.keys(files).length) g(seed, 'add', '--', ...Object.keys(files));
      if (gitlink) g(seed, 'update-index', '--add', '--cacheinfo', `160000,${gitlink},kaninabe`);
      g(seed, 'commit', '-q', '-m', `${name} commit`);
      return g(seed, 'rev-parse', 'HEAD');
    });
  };
  const ok = branch('ok', [{ files: { 'docs/ok.md': 'ok\n' } }]);
  const mixed = branch('mixed', [{ files: { 'docs/m.md': 'm\n' } }, { files: { '.github/workflows/m.yml': 'name: m\n' } }]);
  const record = branch('record', [{ files: { 'docs/r.md': 'r\n' } }, { files: { '.github/workflows/r.yml': 'name: r\n' } }]);
  const evil = branch('evil', [{ files: { 'basis-paths.tsv': 'implementation\t*\teverything is implementation\n', 'docs/e.md': 'e\n', '.github/workflows/e.yml': 'name: e\n' }, gitlink: FRAMEWORK_TWO }]);
  g(seed, 'checkout', '-q', 'main');
  const origin = path.join(root, 'origin.git');
  g(root, 'clone', '-q', '--bare', seed, origin);
  const workspace = (name, ...cloneArgs) => {
    g(root, 'clone', '-q', ...cloneArgs, `file://${origin}`, name);
    cpSync(path.join(repoRoot, 'scripts'), path.join(root, name, 'kaninabe/scripts'), { recursive: true });
    return path.join(root, name);
  };
  return {
    workAll: workspace('work-all'), workMain: workspace('work-main', '--single-branch', '--branch', 'main'),
    base, heads: { ok: ok[0], mixed: mixed[1], record: record[1], evil: evil[0] }, recordBasis: record[0],
  };
})();

const HEAD = FIX.heads.ok;
const BASE = FIX.base;
const OTHER_BASE = 'c3'.repeat(20);
const REPO = 'octo/repo';
const TITLE = 'Add a thing';
const BODY = `Plain text.\n\n## Review\n- opus: ${HEAD}\n- codex: ${HEAD}\n`;
/** The bytes the gate hashes: the title, an empty line, the body, each followed by a line feed. */
const hashedBytes = (title, body) => `${title}\n\n${body}\n`;

function event({ title = TITLE, body = BODY, number = 42, head = HEAD, repo = REPO } = {}) {
  return { pull_request: { number, title, body, head: { sha: head, repo: { full_name: repo } }, base: { sha: OTHER_BASE } } };
}

/**
 * Runs the run blocks of the template with the shared executor. Options: ev, base (GITHUB_SHA), shims, only, pre, rawEvent,
 * runnerName as there; `main` runs in the workspace that has the base's branch only (the head commits are not in its object store).
 */
function runJob({ ev = event(), base = BASE, shims = {}, only = () => true, pre = () => {}, rawEvent, runnerName = 'runner-temp', main = false, env } = {}) {
  return runJobWith({
    steps: need().steps, ev, base, repo: REPO, shims, only, pre, rawEvent, runnerName, env,
    ctx: { 'github.event.pull_request.head.sha': ev.pull_request?.head?.sha ?? '', 'github.sha': base },
    makeWork: (dir) => { const work = path.join(dir, 'work'); cpSync(main ? FIX.workMain : FIX.workAll, work, { recursive: true }); return work; },
  });
}

const isScan = (s) => s.run.includes('scan-pr-text.sh');
const isReview = (s) => s.run.includes('check-review-record.sh');
const isBasis = (s) => s.run.includes('check-basis-record.sh');

describe('the product fixture', () => {
  it('has a gitlink for the framework, a product list at the base, and heads that are not all in the single-branch workspace', () => {
    const lsTree = (cwd, rev) => gitIn(cwd, 'ls-tree', rev, 'kaninabe');
    assert.match(lsTree(FIX.workAll, BASE), /^160000 commit [0-9a-f]{40}\tkaninabe$/);
    assert.notEqual(lsTree(FIX.workAll, FIX.heads.evil), lsTree(FIX.workAll, BASE), 'the evil head moves the gitlink');
    for (const h of Object.values(FIX.heads)) assert.equal(gitIn(FIX.workAll, 'cat-file', '-t', h), 'commit');
    for (const h of Object.values(FIX.heads)) assert.throws(() => gitIn(FIX.workMain, 'cat-file', '-e', `${h}^{commit}`), /fixture: git/);
    assert.equal(readFileSync(path.join(FIX.workAll, 'basis-paths.tsv'), 'utf8'), PRODUCT_LIST);
    assert.ok(existsSync(path.join(FIX.workAll, 'kaninabe/scripts/check-basis-record.sh')));
  });
});

describe('the product template: the run blocks, executed', () => {
  // a git that records its arguments (one line per call, in RUNNER_TEMP) and then does what the real one does
  const GIT_LOG = 'echo "qjgitcall $*" >> "$RUNNER_TEMP/git-calls"';
  const recordingGit = `${GIT_LOG}; exec ${REAL.git} "$@"`;
  const calls = (r) => r.leftContents.flatMap((c) => c.split('\n')).filter((l) => l.startsWith('qjgitcall ')).map((l) => l.slice('qjgitcall '.length));
  const lastIs = (r, pred) => assert.ok(pred(r.results.at(-1).step), `the run ended in "${r.results.at(-1).name}"`);
  const REC_LINK = (id) => `https://github.com/${REPO}/pull/42#issuecomment-${id}`;
  /** The body of a pull request whose review record names `head`; with `basis`, a basis record that names it. */
  const bodyFor = (head, basis) => `Plain text.\n\n## Review\n- opus: ${head}\n- codex: ${head}\n${basis ? `- basis: ${basis}\n- basis-opus: ${basis} ${REC_LINK(101)}\n- basis-codex: ${basis} ${REC_LINK(102)}\n` : ''}`;
  const pr = (head, basis) => event({ head, body: bodyFor(head, basis) });

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

  it('a good event passes with the exact line: the right number, head, base and the hash of the same bytes, and names the pull request first', () => {
    const r = runJob();
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.out.split('\n').filter((l) => l.startsWith('pr-gate: passed')), [`pr-gate: passed pr 42 head ${HEAD} base ${BASE} text sha256 ${hexOf(hashedBytes(TITLE, BODY))}`]);
    assert.ok(r.out.startsWith('pr-gate: pr 42\n'), 'the first step names the pull request');
    assert.ok(/^basis record: /m.test(r.out), 'the basis check ran');
  });

  it('a head that is one kind of path passes; the only git call of the job is the presence check of the head commit, once, with exactly these arguments, and the passed line comes after the basis step', () => {
    const r = runJob({ shims: { git: recordingGit } });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(calls(r), [`cat-file -e ${HEAD}^{commit}`]);
    const names = r.results.map((x) => x.step);
    assert.ok(names.findIndex(isBasis) >= 0 && names.findIndex(isBasis) < names.length - 1, 'the basis step ran, and before the last step');
    assert.ok(PASSED.test(r.out));
  });

  it('hashes a title and a body with several lines, an empty body and a body without a final line feed', () => {
    for (const [title, body] of [['T', 'a\nb\n\nc'], ['T', ''], ['Ünï', 'x\n']]) {
      const r = runJob({ ev: event({ title, body: body === '' ? null : body, head: HEAD }), only: (s) => !isReview(s) && !isBasis(s) });
      assert.equal(r.status, 0, r.out);
      assert.ok(r.out.includes(`text sha256 ${hexOf(hashedBytes(title, body))}\n`), r.out);
    }
  });

  it('turns a pull request from another repository red, with no passed line, before any git call', () => {
    const r = runJob({ ev: event({ repo: 'someone/fork' }), shims: { git: recordingGit } });
    assert.equal(r.status, 1, r.out);
    assert.ok(!PASSED.test(r.out), r.out);
    assert.deepEqual(calls(r), []);
  });

  it('passes no word list to the scan, whatever the environment of the runner holds', () => {
    // the scan script is replaced by one that reports what it was given
    const stub = { pre: ({ work }) => writeFileSync(path.join(work, 'kaninabe/scripts/scan-pr-text.sh'), 'echo "words:${SCAN_WORDS_FILE-unset}:${SCAN_WORDS-unset}"\n'), only: isScan };
    const r = runJob(stub);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes('words:unset:unset'), r.out);
  });

  it('the scan of the text runs: a title with a local path shape is red (exit 1) with no passed line', () => {
    const localPath = ['', 'Users', 'someone', 'x'].join('/'); // built at run time: this file is scanned too
    const r = runJob({ ev: event({ title: `see ${localPath}` }), only: (s) => !isReview(s) && !isBasis(s) });
    assert.equal(r.status, 1, r.out);
    assert.ok(!PASSED.test(r.out), r.out);
    assert.ok(!r.out.includes('someone'), 'the matched text is not printed');
  });

  it('a finding in the BODY only (the title is clean) is red (exit 1) with no passed line, and the matched text is not printed', () => {
    const localPath = ['', 'Users', 'someone', 'x'].join('/'); // built at run time: this file is scanned too
    const r = runJob({ ev: event({ title: 'A clean title', body: `see ${localPath}\n\n## Review\n- opus: ${HEAD}\n- codex: ${HEAD}\n` }), only: (s) => !isReview(s) && !isBasis(s) });
    assert.equal(r.status, 1, r.out);
    assert.ok(!PASSED.test(r.out), r.out);
    assert.ok(!r.out.includes('someone'), 'the matched text is not printed');
    lastIs(r, isScan);
  });

  it('gives the same results with GITHUB_ACTIONS=true and CI=true in the environment as without (a good run, a mixed change without a record, a finding in the text, a fork)', () => {
    const localPath = ['', 'Users', 'someone', 'x'].join('/');
    const cases = [['good', {}], ['mixed', { ev: pr(FIX.heads.mixed) }], ['finding', { ev: event({ title: `see ${localPath}` }), only: (s) => !isReview(s) && !isBasis(s) }], ['fork', { ev: event({ repo: 'someone/fork' }) }]];
    for (const [what, opts] of cases) {
      const plain = runJob(opts);
      const ci = runJob({ ...opts, env: { GITHUB_ACTIONS: 'true', CI: 'true' } });
      assert.equal(ci.status, plain.status, `${what}: ${ci.out}`);
      assert.equal(ci.out, plain.out, what);
    }
    assert.equal(runJob({ env: { GITHUB_ACTIONS: 'true', CI: 'true' } }).status, 0);
  });

  describe('the basis step (the head commit is proved present, never fetched; the base\'s scripts and list decide)', () => {
    it('a mixed change (basis and implementation) without a record is red (exit 1) with the finding and no passed line', () => {
      const r = runJob({ ev: pr(FIX.heads.mixed) });
      assert.equal(r.status, 1, r.out);
      assert.ok(!PASSED.test(r.out), r.out);
      assert.ok(r.out.includes('basis record: record the basis'), r.out);
      lastIs(r, isBasis);
    });

    it('a mixed change with a correct record passes', () => {
      const r = runJob({ ev: pr(FIX.heads.record, FIX.recordBasis) });
      assert.equal(r.status, 0, r.out);
      assert.ok(PASSED.test(r.out), r.out);
      assert.ok(/^basis record: matches \(origin [0-9a-f]{8}, basis [0-9a-f]{8}\)$/m.test(r.out), r.out);
    });

    it('a record that names a commit that is not the pull request\'s is red', () => {
      const r = runJob({ ev: pr(FIX.heads.record, FIX.heads.ok) });
      assert.equal(r.status, 1, r.out);
      assert.ok(!PASSED.test(r.out), r.out);
    });

    it('a head that moves the gitlink and rewrites basis-paths.tsv to all-implementation is still red: the scripts and the list are the base\'s', () => {
      const r = runJob({ ev: pr(FIX.heads.evil) });
      assert.equal(r.status, 1, r.out);
      assert.ok(!PASSED.test(r.out), r.out);
      assert.ok(r.out.includes('basis record: record the basis'), r.out);
    });

    describe('what cannot be done is exit 2 with the fixed line and no passed line', () => {
      it('the head commit is not in the object store (a workspace of the base branch only): exit 2, the fixed message, and git\'s output is not printed', () => {
        const r = runJob({ main: true, shims: { git: `echo qjgitout; echo qjgiterr >&2; exec ${REAL.git} "$@"` } });
        stopsAs2Fixed(r, 'head absent');
        assert.ok(r.out.includes('pr-gate: could not run (the head commit is not in the checkout)'), r.out);
        assert.ok(!r.out.includes('qjgit'), `git's output was printed: ${r.out}`);
        lastIs(r, isBasis);
      });

      it('the head commit is not in a workspace that has every branch either (a sha that no branch holds)', () => {
        const r = runJob({ ev: pr('d4'.repeat(20)) });
        stopsAs2Fixed(r, 'head unknown');
        assert.ok(r.out.includes('(the head commit is not in the checkout)'), r.out);
      });

      const cases = {
        'git is not there': { shims: { git: 'exit 127' } },
        'git fails': { shims: { git: 'exit 1' } },
        'git fails and prints': { shims: { git: 'echo qjgitout; echo qjgiterr >&2; exit 128' } },
        'git is killed': { shims: { git: 'kill -KILL $$' } },
      };
      for (const [what, opts] of Object.entries(cases)) {
        it(`${what}: exit 2, no passed line, and git's output is not printed`, () => {
          const r = runJob(opts);
          stopsAs2Fixed(r, what);
          assert.ok(!r.out.includes('qjgit'), `${what}: git's output was printed: ${r.out}`);
          lastIs(r, isBasis);
        });
      }

      it('git says the commit is there but it is not: the basis script cannot read the history and stops with exit 2, no pass (git\'s output is not printed either)', () => {
        const r = runJob({ main: true, shims: { git: 'echo qjgitout; exit 0' } });
        assert.equal(r.status, 2, r.out);
        assert.ok(!PASSED.test(r.out), r.out);
        assert.ok(!r.out.includes('qjgit'), r.out);
        lastIs(r, isBasis);
      });

      const stub = (body, script = 'check-basis-record.sh') => ({ pre: ({ work }) => writeFileSync(path.join(work, 'kaninabe/scripts', script), `${body}\n`) });
      for (const [what, body, status, fixed] of [
        ['says could not run (exit 2)', 'echo "basis record: could not run (stub)"; exit 2', 2, false], ['exits 3', 'exit 3', 2, true], ['exits 127', 'exit 127', 2, true],
        ['is killed (a signal)', 'kill -KILL $$', 2, true], ['exits 1', 'echo "basis record: FAILED"; exit 1', 1, false],
      ]) {
        it(`the basis script ${what}: exit ${status}, no passed line`, () => {
          const r = runJob(stub(body));
          assert.equal(r.status, status, r.out);
          assert.ok(!PASSED.test(r.out), r.out);
          if (fixed) assert.ok(COULD_NOT.test(r.out), r.out);
          lastIs(r, isBasis);
        });
      }
      for (const [what, body, status, fixed] of [['exits 3', 'exit 3', 2, true], ['exits 4', 'exit 4', 2, true], ['exits 127', 'exit 127', 2, true], ['exits 143', 'exit 143', 2, true], ['is killed (a signal)', 'kill -KILL $$', 2, true], ['exits 1 (found something)', 'exit 1', 1, false], ['exits 2', 'exit 2', 2, false]]) {
        it(`the scan script ${what}: exit ${status}, no passed line`, () => {
          const r = runJob(stub(body, 'scan-pr-text.sh'));
          assert.equal(r.status, status, r.out);
          assert.ok(!PASSED.test(r.out), r.out);
          if (fixed) assert.ok(COULD_NOT.test(r.out), r.out);
          lastIs(r, isScan);
        });
      }
      it('the basis script prints nothing and succeeds: the step is as green as the script says (the script is the judge)', () => {
        assert.equal(runJob(stub('exit 0')).status, 0);
      });

      it('basis-paths.tsv is MISSING at the base (no file): exit 2, no passed line (a base without a list file is not "everything is basis")', () => {
        const r = runJob({ pre: ({ work }) => rmSync(path.join(work, 'basis-paths.tsv')) });
        stopsAs2(r, 'no list');
        lastIs(r, isBasis);
      });

      it('an EMPTY basis-paths.tsv is a valid list in which every path is basis: a mixed change needs no record and passes (deliberate; written in development-flow.md; a change to the list is reviewed as its own pull request)', () => {
        const r = runJob({ ev: pr(FIX.heads.mixed), pre: ({ work }) => writeFileSync(path.join(work, 'basis-paths.tsv'), '') });
        assert.equal(r.status, 0, r.out);
        assert.ok(r.out.includes('basis record: not needed (one kind of path)'), r.out);
        assert.ok(PASSED.test(r.out), r.out);
      });

      it('a list that holds only a comment line is not a list: exit 2, no passed line', () => {
        const r = runJob({ ev: pr(FIX.heads.mixed), pre: ({ work }) => writeFileSync(path.join(work, 'basis-paths.tsv'), '# no lines here\n') });
        stopsAs2(r, 'comment-only list');
        lastIs(r, isBasis);
      });

      it('a list with CRLF line ends is refused: exit 2, no passed line', () => {
        const r = runJob({ ev: pr(FIX.heads.mixed), pre: ({ work }) => writeFileSync(path.join(work, 'basis-paths.tsv'), PRODUCT_LIST.split('\n').join('\r\n')) });
        stopsAs2(r, 'CRLF list');
        lastIs(r, isBasis);
      });

      it('the framework is not in the checkout (the submodule was not taken: kaninabe/ is an empty directory): exit 2 with the exact message, from the first step that needs it, and no passed line', () => {
        const r = runJob({ pre: ({ work }) => { rmSync(path.join(work, 'kaninabe'), { recursive: true }); mkdirSync(path.join(work, 'kaninabe')); } });
        assert.equal(r.status, 2, r.out);
        assert.equal(r.out, 'pr-gate: pr 42\npr-gate: could not run (the framework is not in the checkout)\n');
        lastIs(r, isScan);
      });

      for (const script of ['scan-pr-text.sh', 'check-review-record.sh', 'check-basis-record.sh']) {
        it(`the framework is there but ${script} is missing: exit 2 with the exact message before any script runs, and no passed line`, () => {
          const r = runJob({ pre: ({ work }) => rmSync(path.join(work, 'kaninabe/scripts', script)) });
          assert.equal(r.status, 2, r.out);
          assert.equal(r.out, 'pr-gate: pr 42\npr-gate: could not run (the framework is not in the checkout)\n');
          lastIs(r, isScan);
        });
      }

      it('kaninabe/scripts is not there (the submodule was not checked out): the full job ends in exit 2, never a pass and never 127', () => {
        const r = runJob({ pre: ({ work }) => rmSync(path.join(work, 'kaninabe/scripts'), { recursive: true }) });
        assert.equal(r.status, 2, r.out);
        assert.ok(!PASSED.test(r.out), r.out);
      });

      it('kaninabe/scripts is not there: each step that calls a script ends non-zero and prints no passed line (sh itself ends with a status of its own, 2 or 127; the step turns neither into a pass)', () => {
        for (const only of [isScan, isReview, isBasis]) {
          const r = runJob({ only, pre: ({ work }) => rmSync(path.join(work, 'kaninabe/scripts'), { recursive: true }) });
          assert.notEqual(r.status, 0, r.out);
          assert.ok(!PASSED.test(r.out), r.out);
        }
        for (const only of [isScan, isBasis]) {
          const r = runJob({ only, pre: ({ work }) => rmSync(path.join(work, 'kaninabe/scripts'), { recursive: true }) });
          assert.equal(r.status, 2, r.out);
        }
      });

      it('kaninabe/scripts has the script but a sibling it needs is gone (classify-paths.sh): the basis check stops with exit 2', () => {
        const r = runJob({ pre: ({ work }) => rmSync(path.join(work, 'kaninabe/scripts/classify-paths.sh')) });
        assert.equal(r.status, 2, r.out);
        assert.ok(!PASSED.test(r.out), r.out);
      });
    });

    it('a head or a base that is not 40 lowercase hex characters never reaches git', () => {
      for (const opts of [{ ev: event({ head: 'xyz' }) }, { ev: event({ head: HEAD.toUpperCase() }) }, { ev: event({ head: `-${HEAD.slice(1)}` }) }, { ev: event({ head: '' }) }, { base: 'xyz' }, { base: BASE.toUpperCase() }, { base: '' }]) {
        const r = runJob({ ...opts, only: (s) => !isReview(s), shims: { git: recordingGit } });
        stopsAs2Fixed(r, JSON.stringify(Object.keys(opts)));
        assert.deepEqual(calls(r), [], 'git was called');
      }
    });

    it('a pull request whose title or body holds a marker never has it printed by the basis step', () => {
      const r = runJob({ ev: event({ head: FIX.heads.mixed, body: `qjbodymarker\n\n## Review\n- opus: ${FIX.heads.mixed}\n- codex: ${FIX.heads.mixed}\n` }), only: (s) => !isScan(s) });
      assert.equal(r.status, 1, r.out);
      assert.ok(!r.out.includes('qjbodymarker'), r.out);
    });

    it('leaves no file in RUNNER_TEMP that holds a token-shaped or credential-shaped value (nothing of the kind is ever written)', () => {
      const r = runJob({ shims: { git: recordingGit } });
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(r.leftContents.filter((c) => /token|credential|password/i.test(c)), []);
    });
  });

  describe('the steps that the framework gate has too (the same lines): what fails is exit 2, never a pass', () => {
    for (const [what, body] of [
      ['sha256sum fails and prints nothing', 'exit 1'], ['sha256sum prints nothing and succeeds', 'exit 0'], ['sha256sum prints something that is not a hash', 'echo "nothex  file"'],
      ['sha256sum prints a valid hash and a second field that is not -', `printf '%s\\n' "${'0'.repeat(64)}  file"`], ['sha256sum prints two lines', `printf '%s\\n%s\\n' "${'0'.repeat(64)}  -" "${'0'.repeat(64)}  -"`],
    ]) {
      it(`${what}: exit 2, could not run, no passed line`, () => stopsAs2Fixed(runJob({ shims: { sha256sum: body } }), what));
    }
    for (const [what, body] of [['says the files differ', 'exit 1'], ['cannot compare', 'exit 2'], ['is not there', 'exit 127']]) {
      it(`cmp ${what}: exit 2, could not run, no passed line`, () => stopsAs2Fixed(runJob({ shims: { cmp: body }, only: (s) => !isBasis(s) }), `cmp ${what}`));
    }
    it('jq fails on any one of its calls: exit 2, could not run, no passed line', () => {
      // first, an uncut good run counts the calls; then every one of them 1..count is made to fail
      const counter = mkdtempSync(path.join(tmpdir(), 'pr-gate-count-'));
      try {
        const countFile = path.join(counter, 'calls');
        writeFileSync(countFile, '');
        const good = runJob({ shims: { jq: `echo x >> "${countFile}"; exec ${REAL.jq} "$@"` } });
        assert.equal(good.status, 0, good.out);
        const count = readFileSync(countFile, 'utf8').split('\n').filter((l) => l === 'x').length;
        assert.ok(count >= need().runs.length, `a full run calls jq at least once per step (saw ${count} calls, ${need().runs.length} steps)`);
        for (let n = 1; n <= count; n++) {
          const nFile = path.join(counter, `n-${n}`);
          writeFileSync(nFile, '0');
          const r = runJob({ shims: { jq: `k=$(cat "${nFile}") || exit 3; k=$((k + 1)); echo $k > "${nFile}"; if [ $k = ${n} ]; then exit 1; fi; exec ${REAL.jq} "$@"` } });
          stopsAs2(r, `jq call ${n} of ${count} fails`);
        }
      } finally {
        rmSync(counter, { recursive: true, force: true });
      }
    });
    it('a number that is not digits, and an event file that is not JSON: exit 2, no passed line', () => {
      for (const number of [null, 'abc', '4 2', -1, 1.5, '']) stopsAs2(runJob({ ev: event({ number }), only: (s) => !isReview(s) }), `number ${JSON.stringify(number)}`);
      stopsAs2(runJob({ rawEvent: 'not json' }), 'not json');
    });
    it('a head sha that is not 40 hex characters stops the last step as well (the review and basis steps are skipped so that the last step has to decide)', () => {
      for (const head of ['xyz', HEAD.slice(0, 39), HEAD.toUpperCase(), `${HEAD}0`, null, '']) {
        stopsAs2Fixed(runJob({ ev: event({ head }), only: (s) => !isReview(s) && !isBasis(s) }), `head ${JSON.stringify(head)}`);
      }
    });
  });
});

// ---- the syntax, by actionlint where it is installed ----

describe('the product template: actionlint', () => {
  const installed = spawnSync('actionlint', ['-version'], { encoding: 'utf8' }).status === 0;
  it('passes actionlint (with its shellcheck and pyflakes integrations off, as the push gate runs it)', { skip: installed ? false : 'actionlint is not installed here (CI installs it)' }, () => {
    need();
    const r = spawnSync('actionlint', ['-no-color', '-shellcheck=', '-pyflakes=', path.join(repoRoot, TEMPLATE_PATH)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
});
