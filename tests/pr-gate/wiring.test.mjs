/**
 * Tests of .github/workflows/pr-gate.yml, the workflow whose shell decides whether a merge is allowed. It comes under the
 * same class rule as the scripts it calls (a step that fails must never read as "passed"):
 *   1. wiring: the triggers, the permissions, the checkout, what is read from the event, where the secret goes;
 *   2. the class rule applied mechanically to every `run:` block (the detector of no-pipes.test.mjs, plus a `$(...)` that sits
 *      directly in an argument of echo / printf, where its status is lost);
 *   3. behaviour: the `run:` blocks are executed the way Actions runs them (`bash -e`), in order, in a temp dir, against a fake
 *      event file and a private PATH, and each tool that can fail is made to fail. The job runs in a copy of a fixture base checkout
 *      (the scripts and basis-paths.tsv of this repository, committed; origin is a bare repository that serves any sha), so that the
 *      basis step really fetches the head commit and really runs scripts/check-basis-record.sh.
 * Division of roles. The syntax of the real file is checked by actionlint (with its shellcheck and pyflakes integrations off): CI
 * installs it pinned and runs scripts/push-gate.sh, whose first step runs actionlint over every workflow file of HEAD
 * (ci.yml, job with `push-gate.sh --mode general --all`); the pre-push hook runs the same script. This test does not check the
 * syntax with a standard YAML library: the repository has no YAML dependency at its root, so the workflow is read by a small
 * purpose-built reader that is the only guard of what it reads here, and it is strict on purpose: block maps and sequences,
 * `|` literal blocks, flow sequences of plain words, and plain scalars of a closed form (a small character set, no indicator
 * at the start, no `:` or ` #`, no tab); a word or number that YAML would type (true, no, null, 5 ...) is accepted only where
 * this workflow has exactly that (`persist-credentials: false`, `cancel-in-progress: true`, `timeout-minutes: 5`, the key `on`);
 * an expression is accepted only if it is one of the known four; a quoted scalar, an anchor, a tag, a folded block or a flow map
 * is refused. Anything else throws, so a new shape stops the test instead of being skipped. What this test checks: the key sets
 * of the file, its wiring, the class rule on its shell, and the behaviour of the extracted shell.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COULD_NOT, PASSED, REAL, codeLines, gitIn, hexOf, inspect, logicalLines, parseYaml, repoRoot, runJob as runJobWith, runnerFileProblems } from './harness.mjs';

// The detector, the YAML reader, the executor of run blocks and the git helpers are shared with the test of the product template: ./harness.mjs.
const workflowText = readFileSync(path.join(repoRoot, '.github/workflows/pr-gate.yml'), 'utf8');

const wf = parseYaml(workflowText);
const job = wf.jobs?.gate;
const steps = job?.steps ?? [];
const runs = steps.filter((s) => s.run !== undefined);

describe('the YAML subset parser fails loudly on what it does not understand', () => {
  it('reads the shapes it supports', () => {
    const d = parseYaml('on:\n  x: [a, b_c]\njobs:\n  g:\n    timeout-minutes: 5\n    steps:\n      - name: N (one, two)\n        run: |\n          echo "a"\n\n          echo b\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n          ref: ${{ github.sha }}\n# c\n');
    assert.deepEqual(d, { on: { x: ['a', 'b_c'] }, jobs: { g: { 'timeout-minutes': '5', steps: [{ name: 'N (one, two)', run: 'echo "a"\n\necho b\n' }, { uses: 'actions/checkout@v4', with: { 'persist-credentials': 'false', ref: '${{ github.sha }}' } }] } } });
  });
  it('throws on anchors, folded blocks, flow maps, tabs and stray indent', () => {
    for (const bad of ['a: &x b\n', 'a: >\n  x\n', 'a: {b: c}\n', 'a:\n\tb: c\n', 'a: b\n  c: d\n', 'a: b\na: c\n', 'just text\n', 'a: |-\n  x\n', 'a: |2\n  x\n']) {
      assert.throws(() => parseYaml(bad), /yaml:/, JSON.stringify(bad));
    }
  });
  describe('refuses a plain value that YAML would reject or read differently', () => {
    const refused = [
      ['a trailing comment', 'a: b # c\n'], ['a comment as the whole value', 'a: # c\n'], ['a colon and a blank inside', 'a: b: c\n'], ['a trailing colon', 'a: b:\n'],
      ['an alias', 'a: *x\n'], ['an anchor', 'a: &x b\n'], ['a tag', 'a: !!str b\n'], ['a block indicator', 'a: |\n'.replace('|', '>')],
      ['a percent', 'a: %b\n'], ['an at sign', 'a: @b\n'], ['a backtick', 'a: `b\n'], ['a question mark', 'a: ?b\n'], ['a dash and a blank', 'a: - b\n'], ['a dash', 'a: -b\n'],
      ['a single-quoted value', "a: 'b'\n"], ['a double-quoted value', 'a: "b"\n'], ['a double-quoted value with an escape', 'a: "b\\n"\n'], ['a quoted value and a comment', 'a: "b" # c\n'],
      ['a flow map', 'a: {b: c}\n'], ['a flow sequence with a quote', 'a: ["b"]\n'], ['an unclosed flow sequence', 'a: [b\n'], ['a flow sequence with a nested one', 'a: [[b]]\n'],
      ['true', 'a: true\n'], ['yes', 'a: yes\n'], ['no', 'a: no\n'], ['off', 'a: off\n'], ['null', 'a: null\n'], ['a tilde', 'a: ~\n'], ['False', 'a: False\n'], ['a number', 'a: 1\n'], ['a float', 'a: 1.5\n'], ['a hex number', 'a: 0x1f\n'],
      ['a character outside the set', 'a: b;c\n'], ['a pipe inside', 'a: b|c\n'], ['a backslash inside', 'a: b\\c\n'], ['an unknown expression', 'a: ${{ github.token }}\n'], ['an unbalanced expression', 'a: ${{ github.sha\n'], ['a bare dollar brace', 'a: x}\n'],
      ['an expression with other spacing', 'a: ${{github.sha}}\n'], ['a trailing blank', 'a: b \n'],
      ['the wrong value for a pinned key', 'timeout-minutes: 6\n'], ['a fetch depth of 1', 'fetch-depth: 1\n'], ['a fetch depth of 0 in another form', 'fetch-depth: 00\n'], ['the right word in another case for a pinned key', 'persist-credentials: False\n'], ['yes for a pinned key', 'persist-credentials: no\n'], ['quoted for a pinned key', 'cancel-in-progress: "true"\n'],
      ['a key YAML types', 'yes: b\n'], ['a numeric key', '1: b\n'], ['a null key', 'null: b\n'],
      ['a literal block header with a comment', 'a: | # c\n  x\n'],
    ];
    for (const [what, text] of refused) {
      it(`${what}`, () => { assert.throws(() => parseYaml(text), /yaml:/, JSON.stringify(text)); });
    }
    it('accepts the pinned values and the key on', () => {
      assert.deepEqual(parseYaml('on: x\ntimeout-minutes: 5\npersist-credentials: false\ncancel-in-progress: true\nfetch-depth: 0\n'), { on: 'x', 'timeout-minutes': '5', 'persist-credentials': 'false', 'cancel-in-progress': 'true', 'fetch-depth': '0' });
    });
    it('refuses the same shapes when they are put into the real workflow text', () => {
      for (const [from, to] of [['timeout-minutes: 5', 'timeout-minutes: 6'], ['runs-on: ubuntu-latest', 'runs-on: ubuntu-latest # c'], ['runs-on: ubuntu-latest', 'runs-on: "ubuntu-latest"'],
        ['persist-credentials: false', 'persist-credentials: no'], ['fetch-depth: 0', 'fetch-depth: 1'], ['ref: ${{ github.sha }}', 'ref: ${{ github.event.pull_request.head.ref }}'], ['runs-on: ubuntu-latest', 'runs-on: ubuntu: latest']]) {
        assert.ok(workflowText.includes(from), from);
        assert.throws(() => parseYaml(workflowText.replace(from, to)), /yaml:/, to);
      }
      assert.throws(() => parseYaml(workflowText.replace('runs-on: ubuntu-latest', 'runs-on:\tubuntu-latest')), /yaml:/);
    });
  });
});

// ---- 0. the shape: every key must be on a list of allowed ones (a key that changes the verdict is not on it) ----

const sameKeys = (obj, allowed, where, out) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) out.push(`${where}: key "${k}" is not allowed`);
};

/** The problems of a parsed workflow's shape. Allowed: only what is listed here; anything else (continue-on-error, if, shell, defaults, ...) is a problem. */
function shapeProblems(doc) {
  const out = [];
  const required = (obj, keys, where) => { for (const k of keys) if (!(k in obj)) out.push(`${where}: key "${k}" is missing`); };
  if (doc === null || typeof doc !== 'object') return ['the workflow is not a map'];
  sameKeys(doc, ['name', 'on', 'permissions', 'concurrency', 'jobs'], 'workflow', out);
  required(doc, ['name', 'on', 'permissions', 'concurrency', 'jobs'], 'workflow');
  const j = doc.jobs?.gate;
  if (!j || Object.keys(doc.jobs).length !== 1) { out.push('jobs: exactly one job, named gate'); return out; }
  sameKeys(j, ['runs-on', 'timeout-minutes', 'steps'], 'job gate', out);
  required(j, ['runs-on', 'timeout-minutes', 'steps'], 'job gate');
  (j.steps ?? []).forEach((st, n) => {
    const where = `step ${n + 1}`;
    if ('uses' in st) {
      sameKeys(st, ['uses', 'with'], where, out);
      sameKeys(st.with ?? {}, ['ref', 'persist-credentials', 'fetch-depth'], `${where} with`, out);
    } else {
      sameKeys(st, ['name', 'run', 'env'], where, out);
      required(st, ['name', 'run'], where);
      sameKeys(st.env ?? {}, ['SCAN_WORDS', 'HEAD_SHA'], `${where} env`, out);
    }
  });
  return out;
}

describe('pr-gate.yml: the shape is closed (only allowed keys)', () => {
  it('the workflow has only allowed keys at every level', () => {
    assert.deepEqual(shapeProblems(wf), []);
  });

  /** Each mutation edits the text of the workflow in the test (never the file) and must be seen. */
  const mutations = [
    ['continue-on-error on the job', '    timeout-minutes: 5\n', '    timeout-minutes: 5\n    continue-on-error: later\n'],
    ['continue-on-error on the scan step', '        env:\n          SCAN_WORDS:', '        continue-on-error: later\n        env:\n          SCAN_WORDS:'],
    ['if: always() on the last step', '      - name: Tie the result to what was checked\n', "      - name: Tie the result to what was checked\n        if: always()\n"],
    ['if on the first step', '      - name: Name the pull request', "      - if: later\n        name: Name the pull request"],
    ['shell on a step', '      - name: The review record names the head commit\n', '      - name: The review record names the head commit\n        shell: sh\n'],
    ['working-directory on a step', '      - name: The review record names the head commit\n', '      - name: The review record names the head commit\n        working-directory: tmp\n'],
    ['defaults at the top', 'permissions:\n  contents: read\n', 'permissions:\n  contents: read\ndefaults:\n  run:\n    shell: sh\n'],
    ['env at the top', 'permissions:\n  contents: read\n', 'permissions:\n  contents: read\nenv:\n  X: val\n'],
    ['a key nobody listed on the job', '    timeout-minutes: 5\n', '    timeout-minutes: 5\n    outputs:\n      x: val\n'],
    ['an env name that is not allowed', '          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n', '          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n          TITLE: x\n'],
    ['a with key that is not allowed', '          persist-credentials: false\n', '          persist-credentials: false\n          submodules: val\n'],
    ['a second job', 'jobs:\n', 'jobs:\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - name: x\n        run: |\n          true\n'],
  ];
  for (const [what, from, to] of mutations) {
    it(`fires on: ${what}`, () => {
      assert.ok(workflowText.includes(from), `the anchor for "${what}" is not in the workflow`);
      const problems = shapeProblems(parseYaml(workflowText.replace(from, to)));
      assert.ok(problems.length > 0, `not seen: ${what}`);
    });
  }
  it('fires on a mutated parsed structure as well', () => {
    const copy = JSON.parse(JSON.stringify(wf));
    copy.jobs.gate.steps.at(-1)['continue-on-error'] = 'true';
    assert.ok(shapeProblems(copy).length > 0);
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

  it('checks out github.sha only, with the whole history of the base, without credentials, and never the pull request', () => {
    const checkouts = steps.filter((s) => (s.uses ?? '').startsWith('actions/checkout@'));
    assert.equal(checkouts.length, 1);
    assert.deepEqual(checkouts[0].with, { ref: '${{ github.sha }}', 'persist-credentials': 'false', 'fetch-depth': '0' });
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

  it('has no expression inside any run block, and the expressions it has are exactly the known four (the head sha is read twice: by the review step and by the basis step)', () => {
    // An expression is substituted into the script text before the shell runs, so one that holds text from the pull request
    // (a branch name, a label) is script injection in a job that runs with the base repository's rights.
    for (const s of runs) assert.ok(!s.run.includes('${{'), `the run block of "${s.name}" holds an expression`);
    const code = workflowText.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const found = [...code.matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(found, ['github.event.pull_request.head.sha', 'github.event.pull_request.head.sha', 'github.event.pull_request.number', 'github.sha', 'secrets.SCAN_WORDS']);
    assert.equal(code.split('${{').length - 1, found.length, 'an expression that the pattern did not read');
  });

  it('the reader refuses a flow item that YAML would type (true, no, on, null ...), not only a typed scalar', () => {
    for (const w of ['true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', 'null']) {
      assert.throws(() => parseYaml(`name: x\njobs:\n  gate:\n    steps: [opened, ${w}]\n`), /types differently/, w);
    }
    assert.deepEqual(parseYaml('name: x\njobs:\n  gate:\n    steps: [opened, edited]\n').jobs.gate.steps, ['opened', 'edited']);
  });

  it('has the steps in this order: name, checkout, fork, scan, review, basis, tie (the passed line is printed last)', () => {
    const kinds = [
      ['name the pull request', (s) => s.run?.includes('pr-gate: pr ')],
      ['checkout', (s) => (s.uses ?? '').startsWith('actions/checkout@')],
      ['fork', (s) => s.run?.includes('head.repo.full_name')],
      ['scan', (s) => s.run?.includes('scripts/scan-pr-text.sh')],
      ['review', (s) => s.run?.includes('scripts/check-review-record.sh')],
      ['basis', (s) => s.run?.includes('scripts/check-basis-record.sh')],
      ['tie', (s) => s.run?.includes('pr-gate: passed')],
    ];
    assert.equal(steps.length, kinds.length, `${steps.length} steps`);
    kinds.forEach(([what, is], k) => {
      assert.ok(is(steps[k]), `step ${k + 1} is not the ${what} step`);
      assert.equal(steps.filter((x) => is(x)).length, 1, `the ${what} step is not the only one of its kind`);
    });
  });

  it('keeps the review step as a call with two arguments (the basis check runs the review check with --emit itself)', () => {
    const review = steps[4];
    assert.ok(review?.run, 'the fifth step is the review step');
    assert.deepEqual(logicalLines(review.run).map((l) => l.trim()).filter((l) => l.includes('check-review-record.sh')), ['sh scripts/check-review-record.sh "$body" "$HEAD_SHA"']);
    assert.ok(!review.run.includes('--emit'));
  });

  it('has a basis step whose env is HEAD_SHA only, and that calls the base\'s check with the base\'s list, the base commit, this repository and this number', () => {
    const basis = steps[5];
    assert.ok(basis?.run, 'the sixth step is the basis step');
    assert.deepEqual(basis.env, { HEAD_SHA: '${{ github.event.pull_request.head.sha }}' });
    const lines = logicalLines(basis.run).map((l) => l.trim());
    assert.deepEqual(lines.filter((l) => l.includes('check-basis-record.sh')),
      ['sh scripts/check-basis-record.sh --body "$body" --head "$HEAD_SHA" --base "$GITHUB_SHA" --repo "$GITHUB_REPOSITORY" --pr "$n" --list basis-paths.tsv || rc=$?']);
    // the body and the number are read from the event file as data; the base is the commit that is checked out and that the run reports; the head is the env value
    assert.ok(lines.some((l) => l.startsWith('jq -r \'.pull_request.body // ""\' "$GITHUB_EVENT_PATH" > "$body" ||')), 'the body is read from the event file');
    assert.ok(lines.some((l) => l.startsWith('n=$(jq -r \'.pull_request.number\' "$GITHUB_EVENT_PATH") ||')), 'the number is read from the event file');
    for (const bad of ['base.sha', 'head.sha', 'head.ref', '--emit', 'check-review-record', 'GITHUB_WORKSPACE']) assert.ok(!basis.run.includes(bad), `the basis step mentions ${bad}`);
    // scripts and list are the checked-out base's own files, by relative path: nothing is taken from a directory under RUNNER_TEMP or from the head
    assert.ok(!/RUNNER_TEMP\/[^"\s]*(scripts|basis-paths)/.test(basis.run));
    // the head and the base are checked to be 40 lowercase hex characters before the head reaches git
    const at = (re) => lines.findIndex((l) => re.test(l));
    const gitLine = at(/^git fetch /);
    assert.ok(gitLine > 0, 'the fetch line is there');
    assert.ok(at(/is_hex "\$HEAD_SHA" 40/) >= 0 && at(/is_hex "\$GITHUB_SHA" 40/) >= 0, 'both shas are validated');
    assert.ok(at(/is_hex "\$HEAD_SHA" 40/) < gitLine && at(/is_hex "\$GITHUB_SHA" 40/) < gitLine, 'the shas are validated before git runs');
  });

  it('has one git call in the whole workflow: the fetch of the head by sha as data, its output in a file that is never printed, its status checked', () => {
    const code = runs.flatMap((s) => logicalLines(s.run).map((l) => l.trim())).filter((l) => !l.startsWith('#'));
    const gits = code.filter((l) => /(^|[\s;&|(`$])git(\s|$)/.test(l));
    assert.equal(gits.length, 1, `${gits.length} lines with git: ${gits.join(' // ')}`);
    const m = /^git fetch --no-tags --no-recurse-submodules origin "\$HEAD_SHA" > "\$([a-z_]+)" 2>&1 \|\| stop "[^"$`]+"$/.exec(gits[0]);
    assert.ok(m, `the fetch line has another form: ${gits[0]}`);
    assert.equal(steps[5].run.split(`$${m[1]}`).length - 1, 1, 'the file of git\'s output is used only as the target of the redirect (never read, never printed)');
    for (const sub of ['show', 'checkout', 'switch', 'worktree', 'reset', 'merge', 'apply', 'restore', 'read-tree', 'submodule', 'clone', 'pull', 'cat-file', 'diff', 'log', 'rev-parse']) {
      assert.ok(!code.some((l) => new RegExp(`\\bgit\\s+(-\\S+\\s+)*${sub}\\b`).test(l)), `git ${sub}`);
    }
    assert.ok(!/\bgh\b|\bcurl\b|\bwget\b/.test(runs.map((s) => s.run).join('\n')), 'no other way to reach the head');
  });

  it('prints the passed line only in the last step, with its format unchanged', () => {
    assert.deepEqual(steps.filter((s) => s.run?.includes('pr-gate: passed')), [steps.at(-1)]);
    assert.ok(steps.at(-1).run.includes('printf \'pr-gate: passed pr %s head %s base %s text sha256 %s\\n\' "$n" "$head" "$GITHUB_SHA" "$hash"'));
  });

  // Only the basis step is pinned line for line. Of the other steps, the review call and the passed line are pinned as lines;
  // all of them are held by the step order, the closed key shape, the class-rule check, the one git line, the refused words and
  // the behaviour tests that run them, not line by line: a change to them stays a matter for review.
  // The specification of the basis step: its non-comment lines, exactly (the workflow is written to be this, line for line). The
  // shape is closed on purpose: a step that fetches the head commit can be made to run head code with a few more lines (an archive,
  // an extract, a call), and a list of the words that must not appear cannot name every way.
  const BASIS_STEP_LINES = [
    'stop() { echo "pr-gate: could not run ($1)"; exit 2; }',
    'is_hex() { case $1 in \'\'|*[!0-9a-f]*) return 1 ;; esac; [ "${#1}" = "$2" ]; }',
    'is_hex "$HEAD_SHA" 40 || stop "the head sha is not 40 hex characters"',
    'is_hex "$GITHUB_SHA" 40 || stop "the base sha is not 40 hex characters"',
    'body="$RUNNER_TEMP/pr-body"',
    'jq -r \'.pull_request.body // ""\' "$GITHUB_EVENT_PATH" > "$body" || stop "cannot read the body"',
    'n=$(jq -r \'.pull_request.number\' "$GITHUB_EVENT_PATH") || stop "cannot read the pull request number"',
    'case $n in \'\'|*[!0-9]*) stop "the pull request number is not a number" ;; esac',
    'fetchlog="$RUNNER_TEMP/fetch-log"',
    'git fetch --no-tags --no-recurse-submodules origin "$HEAD_SHA" > "$fetchlog" 2>&1 || stop "cannot fetch the head commit"',
    'rc=0',
    'sh scripts/check-basis-record.sh --body "$body" --head "$HEAD_SHA" --base "$GITHUB_SHA" --repo "$GITHUB_REPOSITORY" --pr "$n" --list basis-paths.tsv || rc=$?',
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
    const basis = rs.filter((s) => s.run.includes('check-basis-record'));
    if (basis.length !== 1) out.push(`${basis.length} steps run the basis check`);
    else if (JSON.stringify(codeLines(basis[0].run)) !== JSON.stringify(BASIS_STEP_LINES)) out.push('the basis step is not exactly the pinned lines');
    const gitLines = rs.flatMap((s) => codeLines(s.run)).filter((l) => /\bgit\b/.test(l));
    if (gitLines.length !== 1) out.push(`the word git is on ${gitLines.length} lines`);
    for (const s of rs) {
      for (const l of codeLines(s.run)) {
        if (/\b(tar|unzip|bash|source|eval|exec|curl|wget|gh|node|python3?|perl|ruby|xargs|nohup)\b|\/(sh|dash|zsh|ksh|busybox)(?![\w.-])/.test(l)) out.push(`a command that must not be here: ${l}`);
        if (/(^|[;&({]\s*|\bthen\s+|\bdo\s+)\.\s/.test(l)) out.push(`a dot command: ${l}`);
        for (const m of l.matchAll(/(?<![\w./$-])sh(?![\w.-])/g)) {
          if (!/^ scripts\/[a-z][a-z0-9-]*\.sh(?: |$)/.test(l.slice(m.index + 2))) out.push(`a sh that is not "sh scripts/NAME.sh": ${l}`);
        }
      }
    }
    return out;
  }
  /** The steps of the real workflow with the specified basis step in place of the basis step (or put before the last step), then `mutate(copy)`. */
  const withReference = (mutate = () => {}) => {
    const copy = JSON.parse(JSON.stringify(steps)).filter((s) => !(s.run ?? '').includes('check-basis-record'));
    copy.splice(copy.length - 1, 0, JSON.parse(JSON.stringify(BASIS_STEP)));
    mutate(copy);
    return copy;
  };
  const basisOf = (list) => list.find((s) => (s.run ?? '').includes('check-basis-record'));

  it('has run blocks of the closed shape: the basis step is exactly the pinned lines, git is on one line, and nothing unpacks or runs other code', () => {
    assert.deepEqual(runClosureProblems(steps), []);
  });

  it('the pinned lines themselves are inside that shape (so the checks below find a mutation, not the reference)', () => {
    assert.deepEqual(runClosureProblems(withReference()), []);
  });

  describe('the closed shape sees a basis step that runs code of the head', () => {
    const four = (git) => `h=$(mktemp -d) || stop "x"\n${git} archive -o "$h.tar" "$HEAD_SHA" 2> "$h.err" || stop "x"\ntar -x -f "$h.tar" -C "$h" || stop "x"\nif [ -f "$h/run-me.sh" ]; then bash "$h/run-me.sh" > "$h.out" 2>&1 || stop "x"; fi\n`;
    const inFront = (extra) => (list) => { const b = basisOf(list); b.run = b.run.replace('rc=0\n', `${extra}rc=0\n`); };
    for (const git of ['git', '"git"', '$(command -v git)', '/usr/bin/git']) {
      it(`archive, extract and run before the pinned call, git written as ${git}`, () => {
        const problems = runClosureProblems(withReference(inFront(four(git))));
        assert.ok(problems.includes('the basis step is not exactly the pinned lines'), problems.join(' // '));
      });
    }
    it('a changed message, an added line, a removed line and a reordered pair in the basis step', () => {
      const edits = [(r) => r.replace('cannot read the body', 'cannot read it'), (r) => `${r}true\n`, (r) => r.replace('rc=0\n', ''), (r) => r.replace('body="$RUNNER_TEMP/pr-body"\n', '').replace('rc=0\n', 'rc=0\nbody="$RUNNER_TEMP/pr-body"\n')];
      for (const edit of edits) assert.ok(runClosureProblems(withReference((l) => { const b = basisOf(l); b.run = edit(b.run); })).length > 0);
    });
    it('the same lines in any other step are seen as well: a second git, tar, bash, a dot command, source, another sh', () => {
      const review = (list) => list.find((s) => (s.run ?? '').includes('check-review-record'));
      const seen = [
        ['a second line with git', '/usr/bin/git archive -o "$h.tar" "$HEAD_SHA"', /word git is on 2 lines/],
        ['git inside a quote', 'x="git" y', /word git is on 2 lines/],
        ['tar', 'tar -x -f "$h.tar" -C "$h"', /must not be here/],
        ['bash', 'bash "$h/run-me.sh"', /must not be here/],
        ['source', 'source "$h/run-me.sh"', /must not be here/],
        ['a dot command', '. "$h/run-me.sh"', /a dot command/],
        ['a dot command after a semicolon', 'true; . "$h/run-me.sh"', /a dot command/],
        ['an sh with a path of the head', 'sh "$h/run-me.sh"', /a sh that is not/],
        ['an sh with another script directory', 'sh tmp/run-me.sh', /a sh that is not/],
        ['an sh by an absolute path', '/bin/sh "$h/run-me.sh"', /must not be here/],
        ['unzip', 'unzip x', /must not be here/],
      ];
      for (const [what, line, re] of seen) {
        const problems = runClosureProblems(withReference((list) => { const r = review(list); r.run = `${line}\n${r.run}`; }));
        assert.ok(problems.some((p) => re.test(p)), `${what}: ${problems.join(' // ')}`);
      }
    });
  });

  it('has a fork step that turns a pull request from another repository red', () => {
    const fork = runs.filter((s) => s.run.includes('head.repo.full_name'));
    assert.equal(fork.length, 1);
    assert.match(fork[0].run, /GITHUB_REPOSITORY/);
  });
});

// ---- 2. the class rule on every run block ----

describe('pr-gate.yml: the class rule on every run block', () => {
  it('has run blocks to look at', () => {
    assert.ok(runs.length >= 4, `${runs.length} run blocks`);
    assert.ok(inspect('x=$(a | b)').problems.length > 0 && inspect('a || true').problems.length > 0, 'the detector is live');
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

  it('names none of GITHUB_ENV, GITHUB_PATH, GITHUB_OUTPUT, GITHUB_STATE, BASH_ENV in any run block (a write there changes what a later step runs)', () => {
    assert.deepEqual(runs.flatMap((s, n) => runnerFileProblems(s.run).map((p) => `run ${n + 1}: ${p}`)), []);
  });

  it('sees each of those words in each run block, in the forms that hid them (a default, a quote split, a plain redirect)', () => {
    const forms = [
      'printf \'BASH_ENV=%s\\n\' "$text" >> "${GITHUB_ENV:-/dev/null}" || stop "x"', 'echo x >> "$GITHUB_PATH"', 'echo x >> $GITHUB_OUTPUT', 'echo x >> "${GITHUB_STATE}"',
      'BASH_ENV=/x', 'echo x >> "$GITHUB_E""NV"', "echo x >> \"$GITHUB_'P'ATH\"", 'echo x >> $GITHUB_\\ENV',
    ];
    for (const [n, s] of runs.entries()) {
      for (const form of forms) assert.ok(runnerFileProblems(`${form}\n${s.run}`).length > 0, `not seen in run ${n + 1}: ${form}`);
    }
    for (const ok of ['echo "$GITHUB_SHA"', 'echo "$GITHUB_EVENT_PATH"', 'x="$GITHUB_REPOSITORY"', 'echo MY_GITHUB_ENVIRON']) assert.deepEqual(runnerFileProblems(ok), [], ok);
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

/**
 * The fixture of the basis step: a base checkout (one commit: this repository's scripts/ and basis-paths.tsv, and a seed file) whose
 * `origin` is a bare repository that holds the base and four pull request branches and serves any sha (uploadpack.allowAnySHA1InWant).
 * The checkout has the base's history only, so the head commit has to be fetched by the step. Built once; every run gets a copy.
 *   ok      one commit: a basis path only
 *   mixed   a basis commit, then an implementation commit (a mixed change)
 *   record  the same shape as mixed; its first commit is the one a record names as `basis`
 *   evil    one commit that rewrites check-basis-record.sh to `exit 0` and the list to all-implementation, and adds a basis file
 */
const FIX = (() => {
  const root = mkdtempSync(path.join(tmpdir(), 'pr-gate-fixture-'));
  process.on('exit', () => rmSync(root, { recursive: true, force: true }));
  const g = gitIn;
  const seed = path.join(root, 'seed');
  mkdirSync(seed);
  g(seed, 'init', '-q', '-b', 'main');
  cpSync(path.join(repoRoot, 'scripts'), path.join(seed, 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, 'basis-paths.tsv'), path.join(seed, 'basis-paths.tsv'));
  mkdirSync(path.join(seed, 'docs'));
  writeFileSync(path.join(seed, 'docs/seed.md'), 'seed\n');
  g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', 'base');
  const base = g(seed, 'rev-parse', 'HEAD');
  const branch = (name, commits) => {
    g(seed, 'checkout', '-q', '-b', name, base);
    const shas = commits.map((files) => {
      for (const [f, c] of Object.entries(files)) { mkdirSync(path.dirname(path.join(seed, f)), { recursive: true }); writeFileSync(path.join(seed, f), c); }
      g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', `${name} commit`);
      return g(seed, 'rev-parse', 'HEAD');
    });
    return shas;
  };
  const ok = branch('ok', [{ 'docs/ok.md': 'ok\n' }]);
  const mixed = branch('mixed', [{ 'docs/m.md': 'm\n' }, { 'scripts/m.sh': 'echo m\n' }]);
  const record = branch('record', [{ 'docs/r.md': 'r\n' }, { 'scripts/r.sh': 'echo r\n' }]);
  const evil = branch('evil', [{ 'scripts/check-basis-record.sh': 'exit 0\n', 'basis-paths.tsv': 'implementation\t*\teverything is implementation\n', 'docs/e.md': 'e\n' }]);
  g(seed, 'checkout', '-q', 'main');
  const origin = path.join(root, 'origin.git');
  g(root, 'clone', '-q', '--bare', seed, origin);
  g(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  // the workspace has the base's history only (as the checkout with fetch-depth 0 of the base branch has), not the pull request's commits
  g(root, 'clone', '-q', '--single-branch', '--branch', 'main', `file://${origin}`, 'work');
  // a plain clone: every branch is already there before the fetch (the other shape a checkout can have)
  g(root, 'clone', '-q', `file://${origin}`, 'work-all');
  return { work: path.join(root, 'work'), workAll: path.join(root, 'work-all'), base, heads: { ok: ok[0], mixed: mixed[1], record: record[1], evil: evil[0] }, recordBasis: record[0] };
})();

const HEAD = FIX.heads.ok;
const BASE = FIX.base;
const OTHER_BASE = 'c3'.repeat(20);
const REPO = 'octo/repo';
const LIST = '# qjmarker list\nhitword\n';

const TITLE = 'Add a thing';
const BODY = `Plain text.\n\n## Review\n- opus: ${HEAD}\n- codex: ${HEAD}\n`;
/** The bytes the gate hashes: `jq -r '.title, "", (.body // "")'`: the title, an empty line, the body, each followed by a line feed. */
const hashedBytes = (title, body) => `${title}\n\n${body}\n`;

function event({ title = TITLE, body = BODY, number = 42, head = HEAD, repo = REPO } = {}) {
  return { pull_request: { number, title, body, head: { sha: head, repo: { full_name: repo } }, base: { sha: OTHER_BASE } } };
}

/**
 * Runs the run blocks of the job with the shared executor: options ev (the event), words (SCAN_WORDS), base (GITHUB_SHA), shims, only,
 * pre, rawEvent, runnerName as there. The steps run in `work`, a copy of the fixture base checkout; with `all`, a copy of a plain
 * clone that has every branch.
 */
function runJob({ ev = event(), words = LIST, base = BASE, shims = {}, only = () => true, pre = () => {}, rawEvent, runnerName = 'runner-temp', all = false } = {}) {
  return runJobWith({
    steps, ev, base, repo: REPO, shims, only, pre, rawEvent, runnerName,
    ctx: { 'secrets.SCAN_WORDS': words, 'github.event.pull_request.head.sha': ev.pull_request?.head?.sha ?? '', 'github.sha': base },
    makeWork: (dir) => { const work = path.join(dir, 'work'); cpSync(all ? FIX.workAll : FIX.work, work, { recursive: true }); return work; },
  });
}

const isScan = (s) => s.run.includes('scripts/scan-pr-text.sh');
const isReview = (s) => s.run.includes('scripts/check-review-record.sh');
const isBasis = (s) => s.run.includes('scripts/check-basis-record.sh');

describe('pr-gate.yml: the run blocks, executed', () => {
  it('a good event passes with the exact line, the right number, head, base and the hash of the same bytes', () => {
    const r = runJob();
    assert.equal(r.status, 0, r.out);
    const lines = r.out.split('\n').filter((l) => l.startsWith('pr-gate: passed'));
    assert.deepEqual(lines, [`pr-gate: passed pr 42 head ${HEAD} base ${BASE} text sha256 ${hexOf(hashedBytes(TITLE, BODY))}`]);
    assert.ok(r.out.includes('pr-gate: pr 42'), 'the first step names the pull request');
    assert.ok(!r.out.includes('qjmarker') && !r.out.includes('hitword'), 'the word list is never printed');
  });

  it('still passes with the right hash when RUNNER_TEMP has a backslash in its path (sha256sum prints a backslash before the hash for such a file name)', () => {
    const r = runJob({ runnerName: 'runner\\temp' });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes(`text sha256 ${hexOf(hashedBytes(TITLE, BODY))}\n`), r.out);
  });

  it('hashes a title and a body with several lines, an empty body and a body without a final line feed', () => {
    for (const [title, body] of [['T', 'a\nb\n\nc'], ['T', ''], ['Ünï', 'x\n']]) {
      const r = runJob({ ev: event({ title, body: body === '' ? null : body, head: HEAD }), only: (s) => !isReview(s) && !isBasis(s) });
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

  describe('the basis step (the head is fetched as data; the base\'s scripts and list decide)', () => {
    const REC_LINK = (id) => `https://github.com/${REPO}/pull/42#issuecomment-${id}`;
    /** The body of a pull request whose review record names `head`; with `basis`, a basis record that names it. */
    const bodyFor = (head, basis) => `Plain text.\n\n## Review\n- opus: ${head}\n- codex: ${head}\n${basis ? `- basis: ${basis}\n- basis-opus: ${basis} ${REC_LINK(101)}\n- basis-codex: ${basis} ${REC_LINK(102)}\n` : ''}`;
    const pr = (head, basis) => event({ head, body: bodyFor(head, basis) });
    // a git that records its arguments (one line per call, in RUNNER_TEMP) and then does what the real one does
    const GIT_LOG = `echo "qjgitcall $*" >> "$RUNNER_TEMP/git-calls"`;
    const recordingGit = `${GIT_LOG}; exec ${REAL.git} "$@"`;
    const calls = (r) => r.leftContents.flatMap((c) => c.split('\n')).filter((l) => l.startsWith('qjgitcall ')).map((l) => l.slice('qjgitcall '.length));
    const lastIs = (r, pred) => assert.ok(pred(r.results.at(-1).step), `the run ended in "${r.results.at(-1).name}"`);

    it('a head that is one kind of path passes; the head is fetched by its sha, once, with exactly these arguments, and the passed line comes after the basis step', () => {
      const r = runJob({ shims: { git: recordingGit } });
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(calls(r), [`fetch --no-tags --no-recurse-submodules origin ${HEAD}`]);
      const names = r.results.map((x) => x.step);
      assert.ok(names.findIndex(isBasis) >= 0 && names.findIndex(isBasis) < names.length - 1, 'the basis step ran, and before the last step');
      assert.ok(PASSED.test(r.out));
    });

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

    it('a head that rewrites check-basis-record.sh to `exit 0` and basis-paths.tsv to all-implementation is still red: the scripts and the list are the base\'s', () => {
      const r = runJob({ ev: pr(FIX.heads.evil) });
      assert.equal(r.status, 1, r.out);
      assert.ok(!PASSED.test(r.out), r.out);
      assert.ok(r.out.includes('basis record: record the basis'), r.out);
    });

    describe('what cannot be done is exit 2 with the fixed line and no passed line', () => {
      const cases = {
        'git is not there': { shims: { git: 'exit 127' } },
        'the fetch fails': { shims: { git: 'exit 1' } },
        'the fetch fails and prints': { shims: { git: 'echo qjgitout; echo qjgiterr >&2; exit 128' } },
        'the fetch succeeds and prints, and brings nothing': { shims: { git: 'echo qjgitout; echo qjgiterr >&2; exit 0' } },
        'the head is not in origin': { ev: pr('d4'.repeat(20)) },
      };
      for (const [what, opts] of Object.entries(cases)) {
        it(`${what}: exit 2, no passed line, and git's output is not printed`, () => {
          const r = runJob(opts);
          assert.equal(r.status, 2, `${what}: ${r.out}`);
          assert.ok(!PASSED.test(r.out), `${what}: ${r.out}`);
          assert.ok(/could not run/.test(r.out), `${what}: ${r.out}`);
          assert.ok(!r.out.includes('qjgit'), `${what}: git's output was printed: ${r.out}`);
          lastIs(r, isBasis);
        });
      }
      it('the fetch fails: the line is the fixed pr-gate line', () => {
        assert.ok(COULD_NOT.test(runJob({ shims: { git: 'exit 1' } }).out));
      });

      const stub = (body) => ({ pre: ({ work }) => writeFileSync(path.join(work, 'scripts/check-basis-record.sh'), `${body}\n`) });
      for (const [what, body, status] of [['says could not run (exit 2)', 'echo "basis record: could not run (stub)"; exit 2', 2], ['exits 3', 'exit 3', 2], ['exits 127', 'exit 127', 2], ['exits 1', 'echo "basis record: FAILED"; exit 1', 1]]) {
        it(`the basis script ${what}: exit ${status}, no passed line`, () => {
          const r = runJob(stub(body));
          assert.equal(r.status, status, r.out);
          assert.ok(!PASSED.test(r.out), r.out);
          lastIs(r, isBasis);
        });
      }
      it('the basis script is not there: exit 2, no passed line', () => {
        // sh itself says it cannot open the file and ends with a status of its own (2 or 127): the step turns neither into a pass
        const r = runJob({ pre: ({ work }) => rmSync(path.join(work, 'scripts/check-basis-record.sh')) });
        assert.ok(r.status === 2, r.out);
        assert.ok(!PASSED.test(r.out), r.out);
        lastIs(r, isBasis);
      });
      it('basis-paths.tsv is not there: exit 2, no passed line (a base without a list is not "everything is basis")', () => {
        const r = runJob({ pre: ({ work }) => rmSync(path.join(work, 'basis-paths.tsv')) });
        stopsAs2(r, 'no list');
      });
      it('the basis script prints nothing and succeeds: the step is as green as the script says (the script is the judge; its own tests pin its output)', () => {
        const r = runJob(stub('exit 0'));
        assert.equal(r.status, 0, r.out);
      });
    });

    it('a workspace that already holds every branch (a plain clone: the head and the evil branch are there before the fetch) gives the same verdicts, with one fetch of the same form', () => {
      const cases = [['one kind of path', pr(HEAD), 0], ['a mixed change without a record', pr(FIX.heads.mixed), 1], ['a mixed change with a record', pr(FIX.heads.record, FIX.recordBasis), 0], ['the head that rewrites the check and the list', pr(FIX.heads.evil), 1]];
      for (const [what, ev, status] of cases) {
        const r = runJob({ ev, all: true, shims: { git: recordingGit } });
        assert.equal(r.status, status, `${what}: ${r.out}`);
        assert.equal(PASSED.test(r.out), status === 0, `${what}: ${r.out}`);
        assert.deepEqual(calls(r), [`fetch --no-tags --no-recurse-submodules origin ${ev.pull_request.head.sha}`], what);
      }
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
  });

  describe('sha256sum', () => {
    const cases = [
      ['fails and prints nothing', 'exit 1'],
      ['prints nothing and succeeds', 'exit 0'],
      ['prints something that is not a hash', 'echo "nothex  file"'],
      ['prints a hash and fails', `echo "${'0'.repeat(64)}  file"; exit 1`],
      ['prints a short hash', `echo "${'0'.repeat(63)}  file"`],
      // a valid 64-hex first field is not enough: the whole record must be exactly `<hash>`, two blanks and `-` on one line
      ['prints a valid hash and a second field that is not -', `printf '%s\\n' "${'0'.repeat(64)}  file"`],
      ['prints a valid hash and no second field', `printf '%s\\n' "${'0'.repeat(64)}"`],
      ['prints a valid hash and one blank before -', `printf '%s\\n' "${'0'.repeat(64)} -"`],
      ['prints three fields', `printf '%s\\n' "${'0'.repeat(64)}  - extra"`],
      ['prints two lines', `printf '%s\\n%s\\n' "${'0'.repeat(64)}  -" "${'0'.repeat(64)}  -"`],
      ['prints a leading backslash', `printf '%s\\n' "\\\\${'0'.repeat(64)}  -"`],
      ['prints a leading blank', `printf '%s\\n' " ${'0'.repeat(64)}  -"`],
      ['prints no final line feed', `printf '%s' "${'0'.repeat(64)}  -"`],
      ['prints an empty line first', `printf '\\n%s\\n' "${'0'.repeat(64)}  -"`],
      // what a shell drops when it reads (trailing line feeds in a substitution, NUL bytes) is still part of the record
      ['prints an empty line after the record', `printf '%s\\n\\n' "${'0'.repeat(64)}  -"`],
      ['prints two empty lines after the record', `printf '%s\\n\\n\\n' "${'0'.repeat(64)}  -"`],
      ['prints a NUL byte after the record', `printf '%s\\n\\000' "${'0'.repeat(64)}  -"`],
      ['prints a NUL byte inside the hash', `printf '%s\\000%s  -\\n' "${'0'.repeat(32)}" "${'0'.repeat(32)}"`],
    ];
    for (const [what, body] of cases) {
      it(`${what}: exit 2, could not run, no passed line`, () => {
        stopsAs2Fixed(runJob({ shims: { sha256sum: body } }), what);
      });
    }
  });

  describe('cmp (the byte comparison of the hash record)', () => {
    for (const [what, body] of [['says the files differ', 'exit 1'], ['cannot compare', 'exit 2'], ['is not there', 'exit 127']]) {
      it(`${what}: exit 2, could not run, no passed line`, () => {
        // the basis check uses cmp too and stops on its own: the step of the hash is the one that is looked at here
        stopsAs2Fixed(runJob({ shims: { cmp: body }, only: (s) => !isBasis(s) }), what);
      });
    }
  });

  describe('jq', () => {
    it('fails on any one of its calls: exit 2, could not run, no passed line', () => {
      // first, an uncut good run counts the calls; then every one of them 1..count is made to fail
      const counter = mkdtempSync(path.join(tmpdir(), 'pr-gate-count-'));
      try {
        const countFile = path.join(counter, 'calls');
        writeFileSync(countFile, '');
        const good = runJob({ shims: { jq: `echo x >> "${countFile}"; exec ${REAL.jq} "$@"` } });
        assert.equal(good.status, 0, good.out);
        const count = readFileSync(countFile, 'utf8').split('\n').filter((l) => l === 'x').length;
        assert.ok(count >= runs.length, `a full run calls jq at least once per step (saw ${count} calls, ${runs.length} steps)`);
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
      // the review script stops it with its own message (it does not say "could not run"), so only the status and the missing passed line are asserted
      const r = runJob({ ev: event({ head: 'xyz' }) });
      assert.equal(r.status, 2, r.out);
      assert.ok(!PASSED.test(r.out), r.out);
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
