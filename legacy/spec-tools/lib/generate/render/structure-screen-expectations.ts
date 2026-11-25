/**
 * 画面(screen_spec)から導く app 側の期待ファイル木。`structure-usecase-expectations.ts` が
 * 保存点の期待を出すのと同型で、画面の層の閉世界(束 画面 1「骨と口」)を宣言から導く。
 *
 * 画面の層は 2 つの置き場を持つ。
 *   - `src/app/_screens/generated/` … 生成物の置き場。**期待木は生成器が決める**(`kind: form` / `table` / `detail` の部品
 *     1 つ = `{画面名}.{部品名}.tsx` 1 本 + 既定のスタイル 1 枚 + 競合の表示の部品 1 本。生成物の部品が 1 つも無ければ空 = 置き場そのものが無い)。
 *   - `src/app/_screens/{画面名 kebab}.tsx` … 手書きの器。**名前の母集合は screen_spec の画面名**であり、
 *     仕様に無い名前の器は置けない(依存が無い画面 — 例: 入口だけの画面 — は器を持たなくてよい。
 *     母集合は「持ってよい名前」であって「持たねばならない名前」ではない)。
 *
 * 生成物の置き場は置き場の配置(`ProductLayout` の `screen-part`。アプリの枠の後段が与える)が決める(上の綴りは Next.js の配置の場合)。
 *
 * 逆方向の突合(実在・紛れ込み)はファイルシステムを読む必要があるため、生成物を消費する
 * 構造テスト(`app/src/operation/__tests__/structure/expected-files.test.ts`)が行う。
 */

import { STRUCTURE_WORDING } from '../../messages/messages-structure.js';
import type { SpecModel } from '../../model/types.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { SCREEN_DEFAULT_CSS_FILE } from './screen-default-css.js';
import { FORM_CONFLICT_EXPORT, FORM_CONFLICT_FILE } from './screen-form-conflict.js';
import { buildScreenForms } from './screen-form-plan.js';
import { buildScreenReads } from './screen-read-plan.js';
import { buildPlatformParts } from './platform-parts-plan.js';
import { screenPartExpectedFile } from './screen-part-placement.js';
import type { ExpectedFile } from './structure-usecase-expectations.js';

/** 画面の層の期待。 */
export interface ScreenExpectations {
  /** `src/app/_screens/generated/` の期待木(`event` は画面名)。 */
  readonly generated: readonly ExpectedFile[];
  /** 手書きの器 `_screens/{名前}.tsx` が持ってよい名前(画面名を kebab-case にしたもの。画面名順)。 */
  readonly containers: readonly string[];
}

/** 画面名(snake_case)を器のファイル名(kebab-case。拡張子なし)にする。 */
export function containerName(screenName: string): string {
  return screenName.split('_').join('-');
}

/**
 * 画面の層の期待を導く。
 *
 * 生成物の期待木は `kind: form` / `table` / `detail` の部品から導く(宣言が無ければ空 = **`_screens/generated/` が
 * 存在しないことが基準線**)。生成器が書くファイルとこの期待は同じ導出(screen-form-plan.ts / screen-read-plan.ts)を見る。
 *
 * @param model ドメイン仕様(フォームの操作の接地に使う)
 * @param ctx 生成の文脈(画面仕様を読めていなければ母集合は空)
 * @returns 生成物の期待木と、器の名前の母集合
 */
export function screenExpectations(model: SpecModel, ctx: GenerateContext): ScreenExpectations {
  const screens = ctx.screens;
  const names = screens === undefined || !screens.available ? [] : screens.screens.map((screen) => screen.name);
  const locations = new Map((screens?.screens ?? []).map((screen) => [screen.name, screen.location]));
  const parts = [...buildScreenForms(model, ctx), ...buildScreenReads(model, ctx), ...buildPlatformParts(ctx)];
  /** 生成物の期待(置き場は配置の `screen-part`。実装の木を持たない製品は期待も無い — 生成器と同じ線)。 */
  const expected = (file: string, what: string, screen: string | undefined, event: string, exportName: string): ExpectedFile[] => {
    const location = locations.get(screen ?? '') ?? [...locations.values()][0] ?? { file: 'screens' };
    const path = screenPartExpectedFile(ctx, file, { what, location });
    return path === null ? [] : [{ event, file: path, export: exportName }];
  };
  return {
    generated:
      parts.length === 0
        ? []
        : [
            ...parts.flatMap((plan) => expected(plan.file, `画面 ${plan.screen} の部品 ${plan.file}`, plan.screen, plan.screen, plan.exportName)),
            ...expected(SCREEN_DEFAULT_CSS_FILE, '画面の部品の既定のスタイル', undefined, STRUCTURE_WORDING.default_style(), 'default'),
            ...expected(FORM_CONFLICT_FILE, '競合の表示の部品', undefined, STRUCTURE_WORDING.form_conflict(), FORM_CONFLICT_EXPORT),
          ],
    containers: [...new Set(names.map(containerName))].sort((a, b) => a.localeCompare(b)),
  };
}
