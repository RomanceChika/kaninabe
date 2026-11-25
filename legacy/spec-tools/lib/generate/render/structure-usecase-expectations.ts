/**
 * 保存点(usecase_spec)から導く app 側の期待ファイル。`code-structure-expectations.ts` が
 * 単発の操作の期待を出すのに対し、ここは保存点の期待を出す(どちらも「宣言 → 実在すべき
 * ファイルの一覧」という写像である)。
 */

import type { SpecModel } from '../../model/types.js';
import { buildSavePlans, stopOnBuildProblems } from '../../usecase/plan-build.js';
import {
  formFilePathOf,
  hooksExportName,
  hooksFilePathOf,
  saveActionFileOf,
  saveBase,
  saveCompositionFileOf,
  saveKeyOf,
  savePascal,
} from './usecase-app-names.js';
import { specPath } from '../../model/product/paths.js';
import type { GenerateContext } from '../../gen-kit/generator.js';

/** ファイル 1 件の期待(パスと主 export 名)。 */
export interface ExpectedFile {
  /** `{aggregate}.{event}` 形式のドメインイベント ID、または保存点の鍵。 */
  readonly event: string;
  /** app/ からの相対パス。 */
  readonly file: string;
  /** 期待する主 export 名。 */
  readonly export: string;
}

/**
 * usecase_spec の保存点 → app 側の 3 種のファイルの期待(束⑯c)。
 *
 * `event` にはドメインイベント ID ではなく**保存点の鍵**(`{ユースケース名}.{保存点 ID}`)が入る
 * —— 保存点は 1 つのドメインイベントに対応しないからである。Server Action・composition・
 * 1 画面フォームは生成物、hooks は手書きであり、**hooks は要るときだけ**期待に載る
 * (application 執行の不変条件を持たない保存点にはファイルそのものが無い)。
 *
 * Server Action・composition・1 画面フォームの置き場は**置き場の配置の役割**(`save-entry` / `save-composition` / `ui-component`)から引く
 * (部品化 ③-c4b。**製品の根からの相対**で引く — 期待ファイル木は製品の根の外を知らない)。hooks の置き場は置き場の配置が宣言する土台 `operation/usecase`(手書き)から
 * 引く(部品化 ③-c5。役割ではなく土台の表の行)。実装の木を持たない製品は期待が無い。
 *
 * @param model ドメイン仕様モデル
 * @param ctx 生成の文脈(ガード解析・action_spec・data_table・usecase_spec)
 * @returns 期待ファイル(パス順)
 */
export function usecaseExpectations(model: SpecModel, ctx: GenerateContext): ExpectedFile[] {
  const built = buildSavePlans({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions ?? null,
    dataTables: ctx.dataTables,
    usecases: ctx.usecases,
  });
  if (built.problems.length > 0) stopOnBuildProblems(built.problems);
  if (ctx.roots.app === null) return [];
  const files: ExpectedFile[] = [];
  const base = { app: '' };
  for (const save of built.saves) {
    const key = saveKeyOf(save);
    const location = { file: specPath(ctx.roots, `frontend/usecases/${save.usecase.relPath}`) };
    files.push({ event: key, file: saveActionFileOf(save, ctx.layout, base, location), export: `${saveBase(save)}Action` });
    files.push({ event: key, file: saveCompositionFileOf(save, ctx.layout, base, location), export: `create${savePascal(save)}` });
    files.push({ event: key, file: formFilePathOf(save, ctx.layout, base, location), export: `${savePascal(save)}Form` });
    if (save.facts.invariantHooks.length > 0) {
      files.push({ event: key, file: hooksFilePathOf(save, ctx.layout, base, location), export: hooksExportName(save) });
    }
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}
