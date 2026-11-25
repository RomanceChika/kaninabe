/**
 * ドメイン仕様の識別子(集約名・状態 ID・イベント ID)の恒等表
 * (`app/src/domain/generated/vocabulary-ids.ts`)の生成器。
 *
 * `{ workshop: 'workshop' }` のように**キーも値も同じ id**の対応表を出す一見奇妙な生成物だが、
 * 狙いは値そのものではなく**参照の形**にある —— `AGGREGATE_IDS.workshop` はプロパティアクセス
 * であり文字列リテラルではないので、参照する側のソースに `'workshop'` という文字列が残らない
 * (W1 が仕組み側コードの文字列リテラルを見て閉世界を検査するため)。加えて、仕様側で id を
 * リネームすればこのオブジェクトのキーも変わり、参照側は**コンパイルエラーで気づく** ——
 * 生の文字列比較のまま放置していたら黙って通っていたズレを機械的に検出できるようになる。
 *
 * 主な利用者はウォーカーのオラクル(`app/e2e/walker*.mts`)。DB の実データを仕様と突き合わせる
 * 都合上、集約名・状態を具体的な語として持たざるを得ないが、その語を生の文字列リテラルとして
 * 書くのではなく、この生成物を経由させる。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import { allMachines, type SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 生成物の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'vocabulary-ids.ts');

/** id の配列から `{ id: id }` の恒等表を作る(重複は 1 つにまとめ、宣言順を保つ)。 */
function identityTable(ids: Iterable<string>): Record<string, string> {
  const table: Record<string, string> = {};
  for (const id of ids) table[id] = id;
  return table;
}

/**
 * ドメイン仕様の識別子の恒等表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/vocabulary-ids.ts`(全体生成)。
 */
export const vocabularyIdsGenerator: DocGenerator = {
  id: 'code-vocabulary-ids',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const aggregateIds = identityTable(model.aggregates.keys());
    const states: string[] = [];
    const events: string[] = [];
    for (const { machine } of allMachines(model)) {
      states.push(...machine.states);
      events.push(...machine.events.map((event) => event.id));
    }
    const stateIds = identityTable(states);
    const eventIds = identityTable(events);
    const specFiles = [...model.aggregates.values()]
      .map((specs) => specs.entity?.location.file)
      .filter((file): file is string => file !== undefined)
      .sort((a, b) => a.localeCompare(b));

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(aggregateIds, stateIds, eventIds, specFiles),
        wholeFile: true,
      },
    ];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(
  aggregateIds: Record<string, string>,
  stateIds: Record<string, string>,
  eventIds: Record<string, string>,
  specFiles: readonly string[],
): string {
  return [
    generatedHeader(specFiles),
    '',
    docComment([
      '集約名(entity_spec の `entity`)の恒等表。仕組み側のコードは集約名を',
      '文字列リテラルとして持たず、この表のプロパティアクセスとして参照する。',
    ]),
    `export const AGGREGATE_IDS = ${renderLiteral(aggregateIds)} as const;`,
    '',
    docComment(['状態 ID(state_spec の `states[]`。全状態機械の合併)の恒等表。']),
    `export const STATE_IDS = ${renderLiteral(stateIds)} as const;`,
    '',
    docComment(['イベント ID(state_spec の `events[].id`。全状態機械の合併)の恒等表。']),
    `export const EVENT_IDS = ${renderLiteral(eventIds)} as const;`,
    '',
  ].join('\n');
}
