/**
 * query_spec から導いた期待索引(テーブル → 期待索引の列リスト)の生成物
 * (`app/src/domain/generated/index-expectations.ts`)の生成器。
 *
 * 設計: 設計メモ ⑪d(0-4「索引の導出」)。query_spec に加え、data_table の `functions[].lookup`(本文が自表を
 * 引くトリガ関数・ジョブを取り出す関数)が要求する索引も同じ導出に載る。導出規則そのものは
 * `legacy/spec-tools/lib/relations/index-requirements/` に 1 か所だけ持ち(T2 検証器・この生成器・
 * ハンドブックの索引節が、その入口の返す値 `IndexRequirements` を読む)、ここは「data_table の `indexes:` に既にある索引を
 * 除いた最終形」をそのまま書き出すだけである。
 *
 * この生成物自体は今のところ実装側の突合には使わない(索引の実在は data_table の
 * `indexes:` → `app/src/domain/generated/data-table-expectations.ts`(既存)→
 * data-table-parity 統合テストが担う)。ここは「なぜその索引が要るか(どの query から)」を
 * 実装側からも読めるようにするための記録である。
 */

import type { SpecModel } from '../../model/types.js';
import { indexRequirementsOfModels } from '../../relations/index-requirements/index.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 生成物の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'index-expectations.ts');

/**
 * 全 query_spec + data_table から期待索引の一覧を生成するジェネレーター。
 * 出力は `app/src/domain/generated/index-expectations.ts`(全体生成)。
 */
export const indexExpectationsGenerator: DocGenerator = {
  id: 'code-index-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const queries = ctx.queries;
    const dataTables = ctx.dataTables;
    if (queries === undefined || !queries.available) return [];
    if (dataTables === undefined || !dataTables.available) return [];

    const expected = indexRequirementsOfModels(model, ctx.guards, { queries, dataTables }).requirements.expected;
    const byTable = new Map<string, LiteralValue[]>();
    for (const candidate of expected) {
      const list = byTable.get(candidate.table) ?? [];
      list.push({ columns: [...candidate.columns], queries: [...candidate.queries], lookups: [...candidate.lookups] });
      byTable.set(candidate.table, list);
    }
    const table: Record<string, LiteralValue> = {};
    for (const name of [...byTable.keys()].sort()) table[name] = byTable.get(name) ?? [];

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(table, [
          'legacy/spec-tools/lib/relations/index-requirements/index-derivation.ts',
          ...queries.queries.map((query) => query.location.file),
          ...dataTables.tables.filter((spec) => spec.functions.some((fn) => fn.lookup !== undefined)).map((spec) => spec.location.file),
        ]),
        wholeFile: true,
      },
    ];
  },
};

/** 生成物のファイル全体を組み立てる。 */
function renderFile(table: Readonly<Record<string, LiteralValue>>, specFiles: readonly string[]): string {
  return [
    generatedHeader(specFiles),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '期待索引 1 本(query_spec の filters の等値・in・via のスコープ条件(自表内のみ)・sort と、',
      'data_table の functions[].lookup から導いた列の並び。導出規則は relations/index-requirements/index-derivation.ts。',
      'data_table が既に PK・一意制約・FK の索引で満たしている候補は含まない)。',
    ]),
    'export interface ExpectedDerivedIndex {',
    '  /** 索引の列(この順で複合索引にする)。 */',
    '  readonly columns: readonly string[];',
    '  /** この索引を要求した query_spec の名前(前方一致で畳まれた場合は複数。名前順)。 */',
    '  readonly queries: readonly string[];',
    '  /** この索引を要求した関数の名前(`functions[].lookup`。畳まれた場合は複数。名前順。無ければ空)。 */',
    '  readonly lookups: readonly string[];',
    '}',
    '',
    docComment([
      'テーブル名 → 期待索引の一覧(query_spec・関数の lookup から導いたもの。data_table の `indexes:` に',
      '全部が宣言されていることを T2 が見る)。',
    ]),
    `export const indexExpectationsByTable: Readonly<Record<string, readonly ExpectedDerivedIndex[]>> =`,
    `  ${frozen(renderLiteral(table, 1))};`,
    '',
  ].join('\n');
}
