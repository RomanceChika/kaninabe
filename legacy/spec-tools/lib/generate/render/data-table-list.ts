/**
 * テーブル仕様一覧(specs/backend/data/README.md の `data-table-list` ブロック)の生成器。
 *
 * data_table は 1 テーブル 1 ファイルなので、全体像(何表あり、それぞれ何を宣言しているか)は
 * 一覧表を生成して 1 か所で見えるようにする(query-list と同じ流儀)。
 */

import type { SpecModel } from '../../model/types.js';
import { frameworkFunctionDecls, frameworkTriggerDecls } from '../../world/index.js';
import { ceilingDeclsOf } from '../../model/data/ceiling-plan.js';
import { refCounterpartDeclsOf } from '../../model/data/ref-check-shape.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先。一覧はディレクトリガイドに置く。 */
function dataReadme(roots: ProductRoots): string {
  return specPath(roots, 'backend/data/README.md');
}

/** 置き場はあるが 0 件のときの表記。 */
const EMPTY = 'まだ data_table はありません(テーブル仕様を書くと、ここに一覧が生成されます)。';

/**
 * 読み込み済みの data_table から一覧表を生成するジェネレーター。
 * 出力は data/README.md の `data-table-list` マーカー 1 か所。
 */
export const dataTableListGenerator: DocGenerator = {
  id: 'data-table-list',

  generate(domain: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.dataTables;
    if (model === undefined || !model.available) return [];
    const rows = model.tables.map((spec) => [
      cell(`\`${spec.table}\``),
      cell(spec.internal ? '—(内部)' : (spec.entity ?? '')),
      cell(String(spec.indexes.length)),
      cell(String(spec.foreignKeys.length)),
      // **設計図が持つ執行点も数える**(`data-table-body.ts` と同じ理由)—— 個別ファイルの
      // マトリクスがトリガ 2 行・関数 2 行を並べているのに、この一覧が 1 / 1 と数えると
      // 同じ generate で逆向きに動いたことになる(独立レビュー ③-2-b F-3)。
      // 相手の端(別の表の執行点から生成されるトリガ)も数える(同じ理由。`model/data/ref-check-shape.ts`)。
      cell(String(spec.triggers.length + frameworkTriggerDecls(spec).length + ceilingDeclsOf(spec, domain).triggers.length + refCounterpartDeclsOf(spec, domain, model.tables).triggers.length)),
      cell(String(spec.functions.length + frameworkFunctionDecls(spec).length + ceilingDeclsOf(spec, domain).functions.length + refCounterpartDeclsOf(spec, domain, model.tables).functions.length)),
      cell(String(spec.checks.length)),
      cell(`\`tables/${spec.relPath}\``),
    ]);
    const content =
      rows.length === 0
        ? EMPTY
        : markdownTable(
            ['テーブル', 'entity', 'index', 'FK', 'トリガ', '関数', 'CHECK', '仕様ファイル'],
            rows,
          );
    return [{ file: dataReadme(ctx.roots), marker: 'data-table-list', content }];
  },
};
