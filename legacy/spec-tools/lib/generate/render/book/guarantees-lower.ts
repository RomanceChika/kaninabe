/**
 * 保証の章の下段(導出): 性質 → 執行者 → 見張りテストの対応・執行者の語・テスト・変異の目録。
 *
 * すべて折りたたむ。件数は表の行の数(構造テストが一致を見る)。変異の目録は実測であり、仕様の宣言を機械で壊して
 * どの検査が赤くなるかを見た表なので導出である。「宣言された例外」は操作・表の仕様に書かれた理由を引いたもので、
 * 受け入れは集約の章が数える(同じ理由を二度必読に数えない)。
 */

import type { GuaranteeCatalogSpec } from '../../../model/guarantee/types.js';
import { cell, withLabel } from '../../../gen-kit/state-machine-table.js';
import type { FoldProps } from './face-html.js';

/** 執行者の表示名の索引。 */
function enforcerLabels(catalog: GuaranteeCatalogSpec): ReadonlyMap<string, string> {
  return new Map(catalog.vocabulary.enforcer.flatMap((term) => (term.label === undefined ? [] : [[term.id, term.label] as const])));
}

/** 下段の表 1 つ(共有の行。`html/guarantees-chapter.ts` が読む)。 */
export interface GuaranteeLowerTable {
  readonly fold: FoldProps;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * 保証の章の下段の表(変異の目録を除く。並びは章に出る順)。
 *
 * @param catalog 保証台帳
 */
export function guaranteeLowerTables(catalog: GuaranteeCatalogSpec): GuaranteeLowerTable[] {
  const labels = enforcerLabels(catalog);
  const mapRows = catalog.guarantees.map((decl) => [
    cell(`\`${decl.id}\``),
    cell(decl.enforcedBy.map((id) => withLabel(id, labels.get(id))).join(', ')),
    cell((decl.canaries ?? []).map((id) => `\`${id}\``).join(', ') || '—'),
  ]);
  const termRows = catalog.vocabulary.enforcer.map((term) => [
    cell(`\`${term.id}\``),
    cell(term.label ?? '—'),
    cell(String(catalog.guarantees.filter((decl) => decl.enforcedBy.includes(term.id)).length)),
  ]);
  const testRows = catalog.testCases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    cell(`\`${testCase.implementation.raw}\``),
    cell(
      catalog.guarantees
        .filter((decl) => decl.canaries?.includes(testCase.id) === true)
        .map((decl) => `\`${decl.id}\``)
        .join(', ') || '—',
    ),
  ]);
  return [
    {
      fold: {
        kind: 'table',
        title: '性質から執行者と見張りテストへ(保証ごと)',
        count: mapRows.length,
        hint: 'Z0 が、見張りテストの無い保証を落とす',
        element: 'guarantee.enforcer',
      },
      headers: ['保証', '誰が守っているか', '見張りテスト'],
      rows: mapRows,
    },
    {
      fold: {
        kind: 'table',
        title: '執行者の語',
        count: termRows.length,
        hint: '台帳が宣言する語。検査器は語で分岐しない',
        element: 'guarantee.enforcer',
      },
      headers: ['執行者', '何か', '守っている保証の本数'],
      rows: termRows,
    },
    {
      fold: {
        kind: 'table',
        title: 'テスト(見張りテストの実装)',
        count: testRows.length,
        hint: '仕様の test_cases の行数',
        element: 'guarantee.tests',
      },
      headers: ['ID', 'type', '実装', '守る保証'],
      rows: testRows,
    },
  ];
}

