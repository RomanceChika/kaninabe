/**
 * 操作の索引(specs/backend/actions/README.md の `actions-index` ブロック)の生成器。
 *
 * ハンドブックの章(book/actions-page.ts)と同じ行データ(actions-view.ts)から、
 * specs 側にはリンク付きの簡潔な表だけを出す — 中身の読み物はハンドブックの役目であり、
 * ここは「どのファイルに何があるか」の索引に徹する(2 か所で別々に組み立てない)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { buildActionRows } from './actions-view.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先。索引はディレクトリガイドに置く。 */
function actionsReadme(roots: ProductRoots): string {
  return specPath(roots, 'backend/actions/README.md');
}

/** 置き場はあるが 0 件のときの表記。 */
const EMPTY = 'まだ action_spec はありません(操作を仕様化すると、ここに索引が生成されます)。';

/**
 * 読み込み済みの action_spec から索引表を生成するジェネレーター。
 * 出力は actions/README.md の `actions-index` マーカー 1 か所。
 */
export const actionsIndexGenerator: DocGenerator = {
  id: 'actions-index',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const actions = ctx.actions;
    if (actions === undefined) return [];
    const rows = buildActionRows(model, actions, ctx).map((row) => [
      cell(`\`${row.action.handles.raw}\``),
      cell(row.byRoles.join(', ')),
      `[${row.action.relPath}](./${row.action.relPath})`,
    ]);
    const content = rows.length === 0 ? EMPTY : markdownTable(['操作', '誰が実行できるか', '仕様ファイル'], rows);
    return [{ file: actionsReadme(ctx.roots), marker: 'actions-index', content }];
  },
};
