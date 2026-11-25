/**
 * T2 索引の期待値チェック(query_spec・関数の `lookup` → data_table `indexes:` の突合)。
 *
 * ARCH-SP-BE-0001 §テーブル仕様の要求(設計メモ ⑪d):
 *   - query_spec の filters(等値・in)・via のスコープ条件(自表内の列だけ)・sort から導いた索引候補と、
 *     data_table の `functions[].lookup`(トリガ関数・ジョブを取り出す関数など、本文が自表を絞り込み・
 *     並べる列の並び)が要求する索引候補(関係の層 `lib/relations/index-requirements/`。前方一致の畳み込み・
 *     PK/一意制約/FK 索引による除外を済ませた「期待索引」)が、data_table の `indexes:` に**全部宣言
 *     されている**こと(宣言漏れ = error)。
 *   - `indexes:` に宣言されているのに、期待索引にも PK/一意制約/FK 索引にも当たらない
 *     索引があれば、理由を確認できるよう指摘する(余分 = warning。削除ではなく人の判断を促す)。
 *
 * 実 DB との突合(`indexes:` と `pg_indexes` の一致)は
 * `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts` が担う(T1 と同じ分担)。
 * ここは「仕様の中で閉じた」突合であり、DB には触れない。
 */

import type { Finding } from '../../kernel/finding.js';
import type { IndexRequirement, IndexRequirementsResult } from '../../relations/index-requirements/index.js';
import { unrequestedIndexReason } from '../index-reasons.js';
import type { DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T2';

/** T2 の指摘を組み立てる。 */
function t2Finding(args: Omit<Finding, 'verifier' | 'severity'> & { severity?: Finding['severity'] }): Finding {
  return { verifier: VERIFIER_ID, severity: args.severity ?? 'error', ...args };
}

/** 列の並びが完全一致するか。 */
function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column, index) => column === b[index]);
}

/**
 * 要求の導出(関係の層)が返した期待索引が data_table の `indexes:` に全部あるか、
 * 逆に `indexes:` にあるのに根拠が無いものが無いかを検証する。
 *
 * 導出に使えなかった入力は、その分を**見ていない**(「要らない」と読まない):
 *   - `data_tables` が使えない … 何が宣言済みか言えないので、何も判定しない(この検査は data_table 側から呼ばれるので実際には起きない)。
 *   - `queries` が使えない(未選択・阻害)… 関数の `lookup` が要求する索引の宣言漏れは見る。余分(`indexes:` にあるが根拠が無い)は
 *     出さない(query 由来の索引が全部「根拠なし」に見えてしまう)。見ていないことは呼び手が報告する(`result.gaps`)。
 *
 * @param derived 関係の層(`deriveIndexRequirements`)が返した結果
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyIndexExpectations(derived: IndexRequirementsResult, dataTables: DataTableSpecModel): Finding[] {
  if (derived.gaps.some((gap) => gap.input === 'data_tables')) return [];
  const expected = derived.requirements.expected;
  const findings: Finding[] = [];
  // 阻害された query は、短い lookup と畳まれる長い要求を隠しているかもしれない。
  // そのときは既存の長い索引による充足も認め、見えていない要求の分だけ短い索引を重複要求しない。
  const queriesBlocked = derived.gaps.some((gap) => gap.input === 'queries' && gap.state === 'blocked');
  findings.push(...checkMissing(expected, dataTables, queriesBlocked));
  // 余分の判定は query_spec が使えるときだけ(使えないと query 由来の索引が全部「根拠なし」に見えてしまう)。
  if (!derived.gaps.some((gap) => gap.input === 'queries')) findings.push(...checkExtra(expected, dataTables));
  return findings;
}

/** 期待索引のうち、data_table に対応する宣言が無いものを拾う(宣言漏れ = error)。 */
function checkMissing(expected: readonly IndexRequirement[], dataTables: DataTableSpecModel, allowCoveringPrefix: boolean): Finding[] {
  const findings: Finding[] = [];
  for (const candidate of expected) {
    const spec = dataTables.tables.find((table) => table.table === candidate.table);
    if (spec === undefined) continue; // T1 が「data_table が無い」を別途指摘する
    const declared = spec.indexes.some((index) =>
      sameColumns(index.on, candidate.columns) ||
      (allowCoveringPrefix && candidate.columns.every((column, position) => index.on[position] === column)),
    );
    if (declared) continue;
    findings.push(
      t2Finding({
        message:
          `${candidate.table} に索引 (${candidate.columns.join(', ')}) がありません` +
          `(${originText(candidate)})`,
        location: { ...spec.location, pointer: 'indexes' },
        suggestion:
          `indexes: に "- name: ${suggestedName(candidate)} / on: [${candidate.columns.join(', ')}]" を足す` +
          `(導出元は query_spec の filters の等値・in・via のスコープ条件・sort と、関数の lookup。` +
          `npm run explain の seqscan 警告と対応する)`,
        counterexample: {
          table: candidate.table,
          columns: candidate.columns.join(', '),
          queries: candidate.queries.join(', '),
          lookups: candidate.lookups.join(', '),
        },
      }),
    );
  }
  return findings;
}

/** `indexes:` にあるが、期待索引にも PK/一意制約/FK 索引にも当たらないものを拾う(余分 = warning)。 */
function checkExtra(expected: readonly IndexRequirement[], dataTables: DataTableSpecModel): Finding[] {
  const findings: Finding[] = [];
  for (const spec of dataTables.tables) {
    const expectedForTable = expected.filter((candidate) => candidate.table === spec.table);
    for (const index of spec.indexes) {
      if (index.unique) continue; // 一意制約は要否を索引の導出の外(不変条件)が決める
      if (index.on.length === 1 && spec.foreignKeys.some((fk) => fk.column === index.on[0])) continue;
      if (expectedForTable.some((candidate) => sameColumns(candidate.columns, index.on))) continue;
      findings.push(
        t2Finding({
          severity: 'warning',
          message: `${spec.table} の索引 ${index.name}(${index.on.join(', ')})は、現在の query_spec・関数の lookup からは要求されていません`,
          location: { ...spec.location, pointer: `indexes.${index.name}` },
          suggestion:
            '引く者がいる索引は、app の読み取りなら query_spec に、トリガ関数・ジョブを取り出す関数など本文が自表を' +
            '引くなら functions[].lookup に書く(引く者の宣言が索引の根拠になる)。引く者がいないなら削除する' +
            '(migrations.md の「本番前に判断する」運用と同じ。適用済みは新しい連番で drop index)',
          counterexample: { table: spec.table, index: index.name, columns: index.on.join(', ') },
          reason: unrequestedIndexReason(spec),
        }),
      );
    }
  }
  return findings;
}

/** 期待索引の要求元の文面(`query: a, b` / `lookup: f` を並べる)。 */
function originText(candidate: IndexRequirement): string {
  const parts = [
    ...(candidate.queries.length === 0 ? [] : [`query: ${candidate.queries.join(', ')}`]),
    ...(candidate.lookups.length === 0 ? [] : [`lookup: ${candidate.lookups.join(', ')}`]),
  ];
  return parts.join(' / ');
}

/** 期待索引に付ける索引名の提案(命名規約: `{table}_{列を _ でつないだもの}_idx`)。 */
function suggestedName(candidate: IndexRequirement): string {
  return `${candidate.table}_${candidate.columns.join('_')}_idx`;
}
