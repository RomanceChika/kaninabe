/**
 * 「書き方の例」の章の生成器が、**この回の生成結果を当てた本文**から抜粋を引く配線の固定。
 *
 * 見出しの直しが 1 回で揃うことは `examples-heading-convergence.test.ts` が部品ごとに見ている
 * (重ねの表 → 章の描画 → 適用器)。ただし部品を自分でつなぐので、**章の生成器が重ねを描画に渡す行**
 * (`examples-page.ts`)が外れても何も言わない。ここは本番の入口 `bookHtmlExamplesGenerator.generate(model, ctx)` を
 * そのまま呼び、見出しを変えた状態で、章が古い見出しのディスクに落ちず新しい見出しを抜粋することを見る。
 *
 * 章の目録は本物から保証台帳の 1 節だけ(と、章が成立するための印 1 つ)に絞る。目録の全部を当てると、
 * 使い捨ての置き場に無い実コードの印で別の理由で落ちて、配線の話が見えなくなる。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { bookHtmlExamplesGenerator } from '../../../../../lib/generate/render/book/html/examples-generator.js';
import type { ExampleCategory } from '../../../../../lib/generate/render/book/examples-page-types.js';
import { sourceRootPath } from '../../../../../lib/model/product/layout.js';
import { specPath } from '../../../../../lib/model/product/paths.js';
import type { ActionSpecModel } from '../../../../../lib/model/trace/types.js';
import { guarantee, guaranteeModel } from '../../../../helpers/guarantee-builder.js';
import { specModel, stubGuards } from '../../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../../helpers/platform.js';
import { NO_GATES } from '../../../../helpers/generate-context.js';

// 見出しの定数を、台帳に今書いてあるものとは別の綴りにする(見出しを直した回を作る)。
vi.mock('../../../../../lib/generate/render/guarantee-headings.js', () => ({
  GUARANTEE_TABLE_HEADING: '保証の全数(配線の見張りの綴り)',
}));

// 目録を絞る: 前半は空・後半は保証台帳の節(1 手目)と、章が成立するための印 1 つだけにする。
vi.mock('../../../../../lib/generate/render/book/examples-page-catalog.js', () => ({ exampleCategories: () => [] }));
vi.mock('../../../../../lib/generate/render/book/examples-page-catalog-rest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/generate/render/book/examples-page-catalog-rest.js')>();
  return {
    ...actual,
    exampleCategoriesRest: (roots: Parameters<typeof actual.exampleCategoriesRest>[0], layout: Parameters<typeof actual.exampleCategoriesRest>[1]): ExampleCategory[] => {
      const category = actual.exampleCategoriesRest(roots, layout).find((entry) => entry.title.startsWith('保証の見張りテスト'));
      const example = category?.examples[0];
      const ledger = example?.steps[0];
      if (category === undefined || example === undefined || ledger === undefined) throw new Error('目録に保証の見張りテストの節が無い');
      return [
        {
          ...category,
          examples: [
            {
              ...example,
              steps: [
                ledger,
                { label: '印', excerpt: { kind: 'code', file: `${sourceRootPath(layout, roots) ?? ''}/wiring-probe.ts`, region: 'wiring-probe', lang: 'ts' } },
              ],
            },
          ],
        },
      ];
    },
  };
});

const NEW_HEADING = '保証の全数(配線の見張りの綴り)';
const OLD_HEADING = '保証の全数(直す前の綴り)';
const GUARANTEES_FILE = specPath(TEST_ROOTS, 'backend/guarantees.md');
const PROBE_FILE = `${sourceRootPath(TEST_LAYOUT, TEST_ROOTS) ?? ''}/wiring-probe.ts`;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** 前回の生成結果(古い見出し)の台帳と、印を 1 つ持つコードが置かれた使い捨ての置き場。 */
function repoWithOldHeading(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'examples-wiring-'));
  scratch.push(root);
  mkdirSync(path.dirname(path.join(root, GUARANTEES_FILE)), { recursive: true });
  writeFileSync(
    path.join(root, GUARANTEES_FILE),
    ['# 保証台帳', '', '<!-- AUTO-GENERATED:guarantee-body -->', `### ${OLD_HEADING}`, '', '| 古い表 |', '<!-- /AUTO-GENERATED:guarantee-body -->', ''].join('\n'),
  );
  mkdirSync(path.dirname(path.join(root, PROBE_FILE)), { recursive: true });
  writeFileSync(path.join(root, PROBE_FILE), ['// #region example:wiring-probe', 'export const probe = 1;', '// #endregion', ''].join('\n'));
  return root;
}

const NO_ACTIONS: ActionSpecModel = { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] };

describe('章の生成器の入口: 見出しを直した回でも、1 回の generate で章が落ちない', () => {
  it('古い見出しのディスクに対して throw せず、新しい見出しの節を抜粋する', () => {
    const root = repoWithOldHeading();
    const guarantees = guaranteeModel([guarantee('rows_by_rls', { label: '見えてはいけない行は返らない' })]);

    const sections = bookHtmlExamplesGenerator.generate(specModel([]), {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      repoRoot: root,
      guarantees,
      actions: NO_ACTIONS,
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.content).toContain(NEW_HEADING);
    expect(sections[0]?.content).not.toContain(OLD_HEADING);
  });
});
