/**
 * screen_spec の `kind: platform_read` / `platform_actions` と `kind: table` の `row_actions`(ADR-0019)→ **画面の部品**
 * (役割 `screen-part` の置き場の `{画面}.{部品}.tsx`)の生成器。
 *
 * 部品の形は 3 つ(`platform-parts-plan.ts`): 認証基盤の読みを表にして行のボタンを持つ `read`・行に依らないボタン列 `bar`・既存の表の行ごとの差し込み列に置く
 * 行のボタンと、確認・拒否の表示を持つ提供者 `rows`。**部品に業務の判断は 1 つも無い** —— 列・見出し・整形は宣言した対応表から、どのボタンが出るかは
 * `skip_if` から、確認の器は重ね表示から決まる。実行・確認ダイアログ・拒否の表示は共有フック `usePlatformActions`(`components/platform-actions`)が持つ。
 * 手書きの器(`_screens/{画面}.tsx`)が行・Server Action・`timeZone` を渡して置く(部品は `_actions` を import しない)。
 *
 * testid: `{部品}`(外側)/ `.row` / `.column.{欄}` / `.empty` / `.{操作の名前}`(ボタン)/ `.error`(拒否の表示)。アプリの語彙は 1 語も持たない(W1)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { specPath } from '../../model/product/paths.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import { barLines, rowsLines } from './platform-parts-bar.js';
import { readLines } from './platform-parts-read.js';
import { buildPlatformParts } from './platform-parts-plan.js';
import type { PlatformPartPlan } from './platform-parts-plan.js';
import { screenPartFile, screenPartOriginOf } from './screen-part-placement.js';

/** 認証基盤の操作の画面の部品を書くジェネレーター。宣言の無い製品・部品が無い製品は何も出さない。 */
export const platformPartsGenerator: DocGenerator = {
  id: 'code-platform-parts',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const screens = ctx.screens;
    if (screens === undefined || !screens.available || ctx.roots.app === null) return [];
    const byName = new Map(screens.screens.map((screen) => [screen.name, screen]));
    const sections: GeneratedSection[] = [];
    for (const plan of buildPlatformParts(ctx)) {
      const origin = screenPartOriginOf(ctx, byName, plan, '認証基盤の操作の部品', 'S20');
      const file = screenPartFile(ctx, plan.file, origin);
      if (file === null) continue;
      const spec = specPath(ctx.roots, `frontend/screens/${byName.get(plan.screen)?.relPath ?? ''}`);
      sections.push({ file, content: render(plan, spec, bodyModulesOf(ctx, origin)).join('\n'), wholeFile: true });
    }
    return sections;
  },
};

/** 部品 1 本(ファイル全体の行)。 */
function render(part: PlatformPartPlan, spec: string, modules: BodyModules): string[] {
  if (part.kind === 'read') return readLines(part, spec, modules);
  if (part.kind === 'bar') return barLines(part, spec, modules);
  return rowsLines(part, spec, modules);
}
