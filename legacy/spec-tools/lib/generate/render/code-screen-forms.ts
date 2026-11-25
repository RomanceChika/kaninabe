/**
 * screen_spec の `kind: form` の部品 → **画面の部品のフォーム**(`app/src/app/_screens/generated/*.tsx`)と、
 * それらが当てる既定のスタイル(`default.module.css`)。
 *
 * ADR-0015 の実装である。部品 1 つ = 生成物 1 本(`{画面名}.{部品名}.tsx`)で、欄の集合・並び・制約・
 * 入力の種類は操作の入力スキーマ(生成 zod)と entity_spec から決まる(screen-form-plan.ts)。
 * 保存点の 1 画面フォーム(code-usecase-form.ts)と**同じ部品・同じ口**に寄せてあり、**違うのは
 * 入力の供給元と testid の根だけ**である。手で書く場所は残さない — 手書きの器(`_screens/{画面}.tsx`)が
 * Server Action を渡して置く(生成物が単体で立つ。器が無くても `page.tsx` から直接呼べる)。
 *
 * **この生成器はアプリの語彙を 1 語も持たない**(W1)。名前はすべて仕様から受ける。
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { specPath } from '../../model/product/paths.js';
import { screenPartFile, screenPartOriginOf } from './screen-part-placement.js';
import type { ScreenPartOrigin } from './screen-part-placement.js';
import { SCREEN_DEFAULT_CSS_FILE, renderScreenDefaultCss } from './screen-default-css.js';
import { FORM_CONFLICT_FILE, renderFormConflict } from './screen-form-conflict.js';
import { renderScreenFormBody } from './screen-form-body.js';
import { buildScreenForms } from './screen-form-plan.js';
import { hasGeneratedParts } from './screen-read-plan.js';
import { bodyModulesOf } from '../body-modules.js';

/**
 * 全画面の `kind: form` の部品からフォームを生成するジェネレーター。
 * 出力は `_screens/generated/{画面}.{部品}.tsx` と `_screens/generated/default.module.css` と
 * `_screens/generated/form-conflict.tsx`(競合の表示の部品。いずれもファイル全体)。
 * 画面の部品の生成物(フォーム・表・詳細)が 1 つも無ければ何も出さない(置き場そのものが存在しないのが基準線)。
 * 既定のスタイルは表・詳細(code-screen-tables.ts / code-screen-details.ts)も当てるが、**1 ファイル 1 生成器**の規約で
 * ここが 1 枚だけ書く(競合の表示の部品も同じ)。
 */
export const screenFormsGenerator: DocGenerator = {
  id: 'code-screen-forms',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const plans = buildScreenForms(model, ctx);
    const screens = ctx.screens;
    // 既定のスタイルは表・詳細も当てる。画面の部品の生成物が 1 つも無ければ何も出さない(置き場そのものが存在しないのが基準線)。
    if (!hasGeneratedParts(model, ctx) || screens === undefined || !screens.available) return [];
    const files = new Map(screens.screens.map((screen) => [screen.name, screen]));
    const sections: GeneratedSection[] = [];
    for (const plan of plans) {
      const screen = files.get(plan.screen);
      const origin = screenPartOriginOf(ctx, files, plan, 'フォーム', 'S17');
      const file = screenPartFile(ctx, plan.file, origin);
      if (file === null) continue;
      const spec = specPath(ctx.roots, `frontend/screens/${screen?.relPath ?? ''}`);
      sections.push({ file, content: renderScreenFormBody(plan, spec, bodyModulesOf(ctx, origin)).join('\n'), wholeFile: true });
    }
    // 共有のファイル(既定のスタイル・競合の表示の部品)は、特定の画面の持ち物ではない。置き場を決められないときの出どころは先頭の画面に寄せる。
    const sharedOrigin = (what: string): ScreenPartOrigin => ({ what, location: screens.screens[0]?.location ?? { file: 'screens' } });
    const css = screenPartFile(ctx, SCREEN_DEFAULT_CSS_FILE, sharedOrigin('画面の部品の既定のスタイル'));
    if (css !== null) sections.push({ file: css, content: renderScreenDefaultCss(), wholeFile: true });
    // 競合の表示の部品も、既定のスタイルと同じく 1 枚だけここが書く(編集する表の行・更新フォーム・手書きのフォームが共有する)。
    const conflict = screenPartFile(ctx, FORM_CONFLICT_FILE, sharedOrigin('競合の表示の部品'));
    if (conflict !== null) sections.push({ file: conflict, content: renderFormConflict(), wholeFile: true });
    return sections;
  },
};
