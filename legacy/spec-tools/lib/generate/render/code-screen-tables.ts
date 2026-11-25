/**
 * screen_spec の `kind: table` / `actions` の部品 → **画面の部品の表・ボタン列**(`app/src/app/_screens/generated/{画面}.{部品}.tsx`)。
 *
 * ADR-0015(束 画面 3a・4a の改訂)の実装である。部品 1 つ = 生成物 1 本で、列・見出し・セルの整形・空の表示は
 * 読みの projection と entity_spec から決まる(screen-read-plan.ts)。`edit` / `actions` を持つ表(編集する表・行のボタン)は
 * 操作つきの表(screen-table-ops-body.ts)・`kind: actions` は 1 行に対するボタン列(screen-actions-body.ts)になる。
 * 手書きの器(`_screens/{画面}.tsx`)が行・Server Action・`timeZone` などを渡して置く(生成物が単体で立つ)。
 * 既定のスタイル(`default.module.css`)はフォームの生成器(code-screen-forms.ts)が 1 枚だけ書く(1 ファイル 1 生成器)。
 *
 * **この生成器はアプリの語彙を 1 語も持たない**(W1)。規約どおりファイル I/O はせず、モデルから GeneratedSection を
 * 返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { specPath } from '../../model/product/paths.js';
import { screenPartFile, screenPartOriginOf } from './screen-part-placement.js';
import { renderScreenActionsBody } from './screen-actions-body.js';
import { renderScreenTableBody } from './screen-table-body.js';
import { renderScreenTableOpsBody } from './screen-table-ops-body.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import { buildScreenReads } from './screen-read-plan.js';
import type { ScreenReadPlan } from './screen-read-plan.js';

/**
 * 全画面の `kind: table` / `actions` の部品から表・ボタン列を生成するジェネレーター。
 * 出力は `_screens/generated/{画面}.{部品}.tsx`(ファイル全体)。表もボタン列も無ければ何も出さない。
 */
export const screenTablesGenerator: DocGenerator = {
  id: 'code-screen-tables',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const screens = ctx.screens;
    if (screens === undefined || !screens.available) return [];
    const files = new Map(screens.screens.map((screen) => [screen.name, screen]));
    const sections: GeneratedSection[] = [];
    for (const plan of buildScreenReads(model, ctx).filter((candidate) => candidate.part !== 'detail')) {
      const screen = files.get(plan.screen);
      const origin = screenPartOriginOf(ctx, files, plan, '部品', 'S18');
      const file = screenPartFile(ctx, plan.file, origin);
      if (file === null) continue;
      const spec = specPath(ctx.roots, `frontend/screens/${screen?.relPath ?? ''}`);
      sections.push({ file, content: renderPart(plan, spec, bodyModulesOf(ctx, origin)).join('\n'), wholeFile: true });
    }
    return sections;
  },
};

/** 部品の種類ごとの本体(ボタン列・操作つきの表・読むだけの表)。 */
function renderPart(plan: ScreenReadPlan, spec: string, modules: BodyModules): readonly string[] {
  if (plan.part === 'actions') return renderScreenActionsBody(plan, spec, modules);
  return plan.edit !== undefined || plan.buttons !== undefined
    ? renderScreenTableOpsBody(plan, spec, modules)
    : renderScreenTableBody(plan, spec, modules);
}
