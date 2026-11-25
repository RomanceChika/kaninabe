/**
 * 画面一覧表(specs/frontend/screens/README.md の `screen-list` ブロック)の生成器。
 *
 * screen_spec は 1 画面 1 ファイルなので、「アプリに画面が何枚あり、どれが何を読み、
 * 何を発火するか」は 1 件ずつ開かないと分からない。人間のレビューはこの一覧から始まる
 * (query 一覧・遷移図と同じ役割)。
 *
 * screen_spec が 1 件も無い状態でも壊れず、「まだ無い」ことを明示した表記を出す。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ScreenSpec } from '../../model/screen/types.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { declaredActionIds } from '../../model/screen/declared-actions.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先。一覧はディレクトリガイドに置く。 */
function screensReadme(roots: ProductRoots): string {
  return specPath(roots, 'frontend/screens/README.md');
}

/** 置き場はあるが 0 件のときの表記。 */
const EMPTY = 'まだ screen_spec はありません(画面を仕様化すると、ここに一覧が生成されます)。';

/** そもそも specs/frontend/screens を読めなかったときの表記。 */
const UNAVAILABLE =
  'specs/frontend/screens を読み込めなかったため、一覧を生成していません(ディレクトリの有無を確認すること)。';

/** 入口の印。エントリポイントは「どこから入るアプリか」を一覧で見せる要になる。 */
function entryText(screen: ScreenSpec): string {
  return screen.entryPoint ? '入口' : '';
}

/**
 * 入場の関門の表記。
 *
 * セッションの要否(`requires_auth`)と入場条件(`precondition`)は別の関門なので、
 * 1 セルに畳みつつ両方が見えるようにする。式そのものは長いので、条件の側は
 * 「あり」と行き先だけを出す(中身は仕様ファイルを読む)。
 */
function gateText(screen: ScreenSpec): string {
  const parts: string[] = [];
  if (screen.requiresAuth) parts.push('要ログイン');
  if (screen.precondition !== undefined) parts.push(`条件 → ${screen.onFail?.screen ?? '?'}`);
  return parts.join(' / ');
}

/**
 * この画面が発火する操作(画面の `actions` + 重ね表示の `actions`)。
 *
 * 重ね表示の分まで並べるのは、**発火するのはどこに置かれたボタンでもその画面**だからである
 * (S2 / S4 / S10 と生成物 `screens.ts` が見る母集合と同じ。V9)。重ね表示にだけ置いた操作を
 * 落とすと、一覧を見た人が「この画面は催しを中止できない」と読んでしまう。
 * 重ね表示側の操作は `{id}(overlay)` の形で出所を添える。
 */
function actionsText(screen: ScreenSpec): string {
  const owner = new Map<string, string>();
  for (const overlay of screen.overlays) {
    for (const action of overlay.actions) {
      if (!owner.has(action.id)) owner.set(action.id, overlay.id);
    }
  }
  // 母集合は検査・生成物と同じ 1 本(lookup.declaredActionIds)。ここだけが出所を添える。
  return declaredActionIds(screen)
    .map((id) => {
      const overlay = screen.actions.some((action) => action.id === id) ? undefined : owner.get(id);
      return overlay === undefined ? id : `${id}(${overlay})`;
    })
    .join(', ');
}

/**
 * 読み込み済みの screen_spec から一覧表を生成するジェネレーター。
 * 出力は screens/README.md の `screen-list` マーカー 1 か所。
 */
export const screenListGenerator: DocGenerator = {
  id: 'screen-list',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.screens;
    if (model === undefined || !model.available) {
      return [{ file: screensReadme(ctx.roots), marker: 'screen-list', content: UNAVAILABLE }];
    }
    const rows = model.screens.map((screen) => [
      cell(screen.name),
      cell(`\`${screen.route}\``),
      cell(screen.forRoles.join(', ')),
      cell(screen.reads.map((read) => read.id).join(', ')),
      cell(actionsText(screen)),
      cell(screen.chrome?.id ?? ''),
      cell(gateText(screen)),
      cell(entryText(screen)),
      cell(`\`${screen.relPath}\``),
    ]);
    const content =
      rows.length === 0
        ? EMPTY
        : markdownTable(
            ['画面', 'route', 'for', 'reads', 'actions', 'chrome', '入場の関門', '入口', '仕様ファイル'],
            rows,
          );
    return [{ file: screensReadme(ctx.roots), marker: 'screen-list', content }];
  },
};
