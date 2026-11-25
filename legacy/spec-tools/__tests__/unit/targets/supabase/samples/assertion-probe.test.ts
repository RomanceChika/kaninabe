/**
 * 「assertion が 0 の it は実行時に赤」が題材の木の設定で効くことの観測(`assertion-probe.ts`。fix27 A2)のユニットテスト。
 *
 * - 題材の木で試験を実行する 2 つの設定(配線・突合の `includeVitestConfig`・実 DB の `vitestConfig`)が、同じ 1 行(`expect.requireAssertions`)を持つ
 * - assertion を 1 つも持たない it は、その設定の下で実際に赤になる(vitest を実際に起動して数える)。設定の行が無ければ緑で通ることも実測で確かめる(負例)
 * - it の外の失敗(it の後の未処理の拒否)は、it が全部通っても数えて赤にする(vitest を実際に起動する。差分点検 S27-1)。終了コードの照らしの表
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probeNoAssertion } from '../../../../../lib/targets/supabase/samples/assertion-probe.js';
import { REQUIRE_ASSERTIONS_LINE } from '../../../../../lib/targets/supabase/samples/db-places.js';
import { includeVitestConfig } from '../../../../../lib/targets/supabase/samples/db-parity-tree.js';
import { vitestConfig } from '../../../../../lib/targets/supabase/samples/db-tree.js';
import { readPassed } from '../../../../../lib/targets/supabase/samples/db-report.js';
import { exitProblems, readUnhandled, runGeneratedTests } from '../../../../../lib/targets/supabase/samples/db-tests.js';
import { TEST_LAYOUT } from '../../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** この作業木のリポジトリルート(vitest を依存として解く起点)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../../../../', import.meta.url));

let tree: string;

beforeEach(() => {
  // 設定が `vitest/config` を import するので、木の node_modules をリポジトリのものへ向ける。
  tree = mkdtempSync(path.join(tmpdir(), 'assertion-probe-'));
  symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tree, 'node_modules'));
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

describe('題材の木の vitest の設定', () => {
  it.each([
    ['配線の段・構造の突合の段(includeVitestConfig)', includeVitestConfig(['a.test.ts'])],
    ['実 DB の段(vitestConfig)', vitestConfig(TEST_LAYOUT)],
  ] as const)('%s は expect.requireAssertions を持つ', (_name, lines) => {
    expect(lines).toContain(REQUIRE_ASSERTIONS_LINE);
    expect(REQUIRE_ASSERTIONS_LINE).toContain('requireAssertions: true');
  });
});

describe('probeNoAssertion', () => {
  it('正例: assertion を 1 つも持たない it は題材の木の設定の下で赤になる(数は 1)', () => {
    expect(probeNoAssertion({ tree, repoRoot: REPO_ROOT, roots: TEST_ROOTS })).toBe(1);
  });

  it('負例: 設定から requireAssertions の行を外すと、同じ it が緑で通る(観測が空振りでない証拠)', () => {
    const app = path.join(tree, 'app');
    mkdirSync(path.join(app, 'p'), { recursive: true });
    writeFileSync(path.join(app, 'p/a.test.ts'), "import { it } from 'vitest';\nit('x', () => {});\n");
    const configFile = path.join(app, 'vitest.none.mts');
    writeFileSync(configFile, includeVitestConfig(['p/a.test.ts']).filter((line) => line !== REQUIRE_ASSERTIONS_LINE).join('\n'));
    expect(runGeneratedTests({ configFile, root: app, repoRoot: REPO_ROOT, stack: null, roots: TEST_ROOTS, reportFile: path.join(tree, 'none.json') }).ok).toBe(true);
  });
});

describe('通った件数は JSON の報告から読む(fix27 差分点検 5 回目 A5-1)', () => {
  it('負例の原因: 出力が着色されても(走り手の閉じた環境は CLAUDECODE / AI_AGENT を落とすので vitest は着色する)件数は読める・報告が無ければ null', () => {
    const app = path.join(tree, 'app');
    mkdirSync(path.join(app, 'p'), { recursive: true });
    writeFileSync(path.join(app, 'p/a.test.ts'), "import { expect, it } from 'vitest';\nit('x', () => { expect(1).toBe(1); });\nit('y', () => { expect(2).toBe(2); });\n");
    const configFile = path.join(app, 'vitest.count.mts');
    writeFileSync(configFile, includeVitestConfig(['p/a.test.ts']).join('\n'));
    // 走り手の段の子と同じ環境(エージェントの印が無い)で、着色を明示する。
    const names = ['FORCE_COLOR', 'NO_COLOR', 'CLAUDECODE', 'AI_AGENT'] as const;
    const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    process.env['FORCE_COLOR'] = '1';
    try {
      const result = runGeneratedTests({ configFile, root: app, repoRoot: REPO_ROOT, stack: null, roots: TEST_ROOTS, reportFile: path.join(tree, 'count.json') });
      expect(result.output).toMatch(/\u001b\[/u);
      expect(result.passed).toBe(2);
    } finally {
      for (const name of names) {
        const value = before[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(readPassed(path.join(tree, 'nope.json'))).toBeNull();
    writeFileSync(path.join(tree, 'bad.json'), '{"numPassedTests":"2"}');
    expect(readPassed(path.join(tree, 'bad.json'))).toBeNull();
  });
});

describe('it の外の失敗と終了コード(差分点検 S27-1)', () => {
  /** 1 本の試験を題材の木の設定で実行する。 */
  const run = (body: string): { readonly ok: boolean; readonly unhandled: number | null } => {
    const app = path.join(tree, 'app');
    mkdirSync(path.join(app, 'p'), { recursive: true });
    writeFileSync(path.join(app, 'p/a.test.ts'), body);
    const configFile = path.join(app, 'vitest.exit.mts');
    writeFileSync(configFile, includeVitestConfig(['p/a.test.ts']).join('\n'));
    const reportFile = path.join(tree, 'exit.json');
    const result = runGeneratedTests({ configFile, root: app, repoRoot: REPO_ROOT, stack: null, roots: TEST_ROOTS, reportFile });
    return { ok: result.ok, unhandled: readUnhandled(reportFile) };
  };

  it('負例: it は全部通るが、it の後に未処理の拒否が出ると、数が 1 以上で終了コードも 0 以外(JSON の報告は it の緑しか持たない)', () => {
    const outcome = run("import { expect, it } from 'vitest';\nit('x', () => {\n  expect(1).toBe(1);\n  setTimeout(() => { void Promise.reject(new Error('後で落ちる')); }, 0);\n});\nit('y', async () => {\n  await new Promise((resolve) => setTimeout(resolve, 50));\n  expect(1).toBe(1);\n});\n");
    expect(outcome.ok).toBe(false);
    expect(outcome.unhandled).toBeGreaterThan(0);
    expect(exitProblems({ ok: outcome.ok }, new Map([['k', { failed: 0, missing: [], broken: [] }]]), outcome.unhandled)[0]).toContain('[it の外の失敗]');
  });

  it('正例: 落ちるものが無ければ数は 0・終了コードも 0', () => {
    expect(run("import { expect, it } from 'vitest';\nit('x', () => {\n  expect(1).toBe(1);\n});\n")).toEqual({ ok: true, unhandled: 0 });
  });

  const NONE = { failed: 0, missing: [], broken: [] };
  it.each([
    ['緑で終わり、外の失敗も無い', true, NONE, 0, null],
    ['落ちた it で 0 以外(表の照らしが名指す)', false, { ...NONE, failed: 1 }, 0, null],
    ['読み込みの失敗で 0 以外(表の absent が名指す)', false, { ...NONE, missing: ['@/x'] }, 0, null],
    ['0 以外なのに落ちた it も読み込みの失敗も無い', false, NONE, 0, '[説明の無い赤]'],
    ['it の外の失敗がある(落ちた it が表で説明されていても)', false, { ...NONE, failed: 1 }, 2, '[it の外の失敗]'],
    ['報告者まで届かず数を読めない', true, NONE, null, '[実行の結末を読めない]'],
  ] as const)('終了コードの照らし: %s', (_name, ok, outcome, unhandled, head) => {
    const problems = exitProblems({ ok }, new Map([['k', outcome]]), unhandled);
    if (head === null) expect(problems).toEqual([]);
    else expect(problems[0]).toContain(head);
  });
});
