/**
 * T13 **`defaults` が名指す採番の器は、ちょうど 1 か所で、流せる値で宣言されている**。
 *
 * `supplied_by: db` の機構のうち「連番から作る」ものは、列の既定値に
 * `nextval('{シーケンス名}')` と書く。ところが**そのシーケンスを作る宣言がどこにも無かった** ——
 * 生成 DDL は既定値の式をそのまま出すので、空の DB に当てると
 * `relation "…_seq" does not exist` で落ちる。
 *
 * 題材の製品は連番の既定値を 1 つも持たないのでこの穴は見えず、4 題材を空の DB に当てた最初の
 * 実行が 2 題材で落ちて初めて分かった(束 ③-2 の実測。メンバーカード番号と予約番号の列)。**題材の製品だけを見ていると一生見えない形の穴**である。
 *
 * 見るのは 4 つ。
 *
 * | 何を | 重さ | なぜ |
 * |---|---|---|
 * | 名指したのに宣言が無い | error | 空の DB に当たらない(症状が「落ちる」なので直せる) |
 * | 宣言したのに誰も名指さない | warning | 落ちはしないが、誰も読まない器が DB に残る(`ddl-parity` の閉世界に載り続ける) |
 * | 同じ名前を 2 表が宣言している | error | **宣言は 1 か所**である。`create sequence if not exists` は先に当たった側が勝つので、`start` が食い違っていても後は黙って no-op になり、期待表の `start` は宣言の並び順で決まってしまう |
 * | `start` が整数でない | error | 生成 SQL(`start with 1.5`)が構文エラーになる。仕様の側で止める |
 *
 * シーケンスは**表をまたいで参照してよい**(連番を共有する列が 2 つの表にあることは起こる)ので、
 * 名指しの照合先は全 data_table の宣言の和集合である。**出す場所**は番号が最小の表のファイルで
 * あり、その規則は `lib/sql/ddl-placement.ts` が持つ。
 *
 * 名前の読み方(`nextval` の印字の揺れの吸収)は `lib/sql/sequence-names.ts` の 1 本を使う ——
 * 置き場の判定と別の正規表現を持つと「検査は通るのに出る場所が違う」が起きる。
 */

import type { Finding } from '../../kernel/finding.js';
import { nextvalNames } from '../../sql/sequence-names.js';
import type { DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T13';

/** 名指しの 1 件(どの表が、どの器を呼んでいるか)。 */
interface Reference {
  readonly table: string;
  readonly sequence: string;
}

/** 宣言の 1 件(どの表が宣言したか)。 */
interface Declaration {
  readonly table: string;
  readonly start: number | undefined;
}

/** 全 data_table の `defaults` から、器の名指しを拾う。 */
function referencesOf(dataTables: DataTableSpecModel): readonly Reference[] {
  return dataTables.tables.flatMap((table) =>
    nextvalNames(table).map((sequence) => ({ table: table.table, sequence })),
  );
}

/** その表の場所(Finding の location に使う)。 */
function locationOf(dataTables: DataTableSpecModel, table: string, pointer: string): Finding['location'] {
  const spec = dataTables.tables.find((candidate) => candidate.table === table);
  return { ...(spec?.location ?? { file: '', line: 0 }), pointer };
}

/** 名指したのに宣言が無い器(error)。 */
function ungrounded(
  dataTables: DataTableSpecModel,
  references: readonly Reference[],
  declared: ReadonlyMap<string, readonly Declaration[]>,
): Finding[] {
  return references
    .filter((reference) => !declared.has(reference.sequence))
    .map((reference) => ({
      verifier: VERIFIER_ID,
      severity: 'error' as const,
      message: `${reference.table} の既定値が採番の器 ${reference.sequence} を名指していますが、宣言がありません`,
      location: locationOf(dataTables, reference.table, 'defaults'),
      suggestion:
        `どれかの data_table に "sequences: [{ name: ${reference.sequence} }]" を足す` +
        '(足すと表の DDL の冒頭に create sequence if not exists が出て、空の DB でも当たる)。' +
        '連番で採らないなら既定値の式から nextval を外す',
      counterexample: { table: reference.table, sequence: reference.sequence },
    }));
}

/** 宣言したのに誰も名指さない器(warning)。 */
function unused(
  dataTables: DataTableSpecModel,
  references: readonly Reference[],
  declared: ReadonlyMap<string, readonly Declaration[]>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [sequence, owners] of declared) {
    if (references.some((reference) => reference.sequence === sequence)) continue;
    const table = owners[0]?.table ?? '';
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'warning',
      message: `シーケンス ${sequence} を宣言していますが、どの列の既定値も名指していません`,
      location: locationOf(dataTables, table, 'sequences'),
      suggestion:
        `${sequence} を使う列の defaults に nextval('${sequence}') を書くか、宣言を外す` +
        '(誰も読まない器が DB に残り、ddl-parity の閉世界に載り続ける)',
      counterexample: { table, sequence },
    });
  }
  return findings;
}

/** 同じ名前を 2 表以上が宣言している(error)。 */
function duplicated(
  dataTables: DataTableSpecModel,
  declared: ReadonlyMap<string, readonly Declaration[]>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [sequence, owners] of declared) {
    if (owners.length < 2) continue;
    const tables = owners.map((owner) => owner.table);
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'error',
      message: `シーケンス ${sequence} を ${owners.length} つの表が宣言しています(${tables.join(' / ')})`,
      location: locationOf(dataTables, tables[1] ?? '', 'sequences'),
      suggestion:
        `宣言は 1 か所にする(${tables[0] ?? ''} に残して他から外す)。器は表をまたいで名指してよく、` +
        '出す場所は番号が最小の表のファイルに生成器が決める —— 2 か所に書くと ' +
        'create sequence if not exists が先に当たった側で勝ち、start の食い違いが黙って no-op になる',
      counterexample: { sequence, tables: tables.join(', ') },
    });
  }
  return findings;
}

/** `start` が整数でない(error)。 */
function badValues(
  dataTables: DataTableSpecModel,
  declared: ReadonlyMap<string, readonly Declaration[]>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [sequence, owners] of declared) {
    for (const owner of owners) {
      if (owner.start !== undefined && !Number.isInteger(owner.start)) {
        findings.push({
          verifier: VERIFIER_ID,
          severity: 'error',
          message: `シーケンス ${sequence} の start が整数ではありません(${owner.start})`,
          location: locationOf(dataTables, owner.table, `sequences.${sequence}.start`),
          suggestion: 'start に整数を書く(生成 SQL の start with にそのまま出るので、非整数は構文エラーになる)',
          counterexample: { sequence, start: String(owner.start) },
        });
      }
    }
  }
  return findings;
}

/**
 * `defaults` の `nextval` と `sequences` の宣言を突き合わせる。
 *
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifySequenceGrounding(dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const declared = new Map<string, Declaration[]>();
  for (const table of dataTables.tables) {
    for (const sequence of table.sequences) {
      const owners = declared.get(sequence.name) ?? [];
      owners.push({ table: table.table, start: sequence.start });
      declared.set(sequence.name, owners);
    }
  }
  const references = referencesOf(dataTables);
  return [
    ...ungrounded(dataTables, references, declared),
    ...duplicated(dataTables, declared),
    ...badValues(dataTables, declared),
    ...unused(dataTables, references, declared),
  ];
}
