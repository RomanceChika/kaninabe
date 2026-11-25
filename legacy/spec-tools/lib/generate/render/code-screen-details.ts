/**
 * screen_spec の `kind: detail` の部品 → **画面の部品の詳細**(`app/src/app/_screens/generated/{画面}.{部品}.tsx`)。
 *
 * ADR-0015(束 画面 3a の改訂)の実装である。部品 1 つ = 生成物 1 本で、項目・見出し・値の整形は
 * 読みの projection と entity_spec から決まる(screen-read-plan.ts)。手書きの器(`_screens/{画面}.tsx`)が
 * 1 件・`timeZone` を渡して置く(生成物が単体で立つ)。既定のスタイル(`default.module.css`)は
 * フォームの生成器(code-screen-forms.ts)が 1 枚だけ書く(1 ファイル 1 生成器)。
 *
 * **この生成器はアプリの語彙を 1 語も持たない**(W1)。規約どおりファイル I/O はせず、モデルから GeneratedSection を
 * 返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { specPath } from '../../model/product/paths.js';
import { screenPartFile, screenPartOriginOf } from './screen-part-placement.js';
import { renderScreenDetailBody } from './screen-detail-body.js';
import { bodyModulesOf } from '../body-modules.js';
import { buildScreenReads } from './screen-read-plan.js';

/**
 * 全画面の `kind: detail` の部品から詳細を生成するジェネレーター。
 * 出力は `_screens/generated/{画面}.{部品}.tsx`(ファイル全体)。詳細が 1 つも無ければ何も出さない。
 */
export const screenDetailsGenerator: DocGenerator = {
  id: 'code-screen-details',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const screens = ctx.screens;
    if (screens === undefined || !screens.available) return [];
    const files = new Map(screens.screens.map((screen) => [screen.name, screen]));
    const sections: GeneratedSection[] = [];
    for (const plan of buildScreenReads(model, ctx).filter((candidate) => candidate.part === 'detail')) {
      const screen = files.get(plan.screen);
      const origin = screenPartOriginOf(ctx, files, plan, '詳細', 'S18');
      const file = screenPartFile(ctx, plan.file, origin);
      if (file === null) continue;
      const spec = specPath(ctx.roots, `frontend/screens/${screen?.relPath ?? ''}`);
      sections.push({ file, content: renderScreenDetailBody(plan, spec, bodyModulesOf(ctx, origin)).join('\n'), wholeFile: true });
    }
    return sections;
  },
};
