/**
 * T15 の**写しの約束の 2 本**(点検 26 回目 A26-2)。本体の `t15-supplied-mechanism.ts` が表のトリガごとに呼ぶ。
 *
 * 祖先の列の写し(`ddl-copy-triggers.ts` の `select … into new.{列}`)は写し元を掴まずに読む。そこで写しが写し元と食い違わないことを、
 * 掴みではなく宣言の形で言い切る:
 *
 * | 何を | 重さ | なぜ |
 * |---|---|---|
 * | 写し元の道の列(2 段目以降の参照の欄と、最後の写し元の列)が編集・遷移で書き換えられる | error | 写し元の更新は写しの行を待たない(KEY SHARE と NO KEY UPDATE は両立する)ので、read committed でも写しが古い値でコミットされうる(点検の実測 S3)。写しは不変の祖先の列に限る |
 * | 写しのトリガが、写す列そのものの更新で発火しない | error | 写す列を直に書き換えると写し元と食い違ったまま残り、不変条件の書き込みの端が覆われない(題材 stores の 8 端を fires で閉じた形を、ここで固定する) |
 *
 * 1 段目の参照の欄(自表の列)の付け替えは本体の `checkCopyRefresh` が見る。書き換えの宣言の読みは `model/written-after-create.ts` の
 * `writtenByDeclaration` の 1 本(access_spec の writes / transition_writes・状態機械の records_time / records_actor / clears)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { AggregateSpecs, SpecModel } from '../../model/types.js';
import type { DataTableSpec, DataTriggerDecl } from '../../model/data/types.js';
import { writtenByDeclaration } from '../../model/written-after-create.js';
import { type CopiedColumn, copyDeclarationsOf } from '../../world/index.js';

/** この検証器の ID(本体と同じ)。 */
const VERIFIER_ID = 'T15';

/** 写し元の道の列 1 つ(どの集約の、どの列か)。 */
export interface CopySource {
  readonly entity: string;
  readonly column: string;
}

/**
 * 写し元の道の列(2 段目以降の参照の欄と、最後の写し元の列。1 段目の参照の欄は自表の列なので入れない)。
 *
 * @param copy 解けた写し
 * @returns 道の列(道の順)
 */
export function copySources(copy: CopiedColumn): readonly CopySource[] {
  const hops = copy.path.slice(1).map((hop, index) => ({ entity: copy.path[index]?.entity ?? '', column: hop.refColumn }));
  return [...hops, { entity: copy.fromEntity, column: copy.fromColumn }];
}

/** エンティティ名(集約ディレクトリ名でも)から集約の仕様を引く。 */
function specsOf(domain: SpecModel, entity: string): AggregateSpecs | undefined {
  return [...domain.aggregates].find(([key, specs]) => specs.entity?.entity === entity || key === entity)?.[1];
}

/** 写しのトリガが供給する、解けた写し。 */
function suppliedCopies(trigger: DataTriggerDecl, entity: string, domain: SpecModel): readonly CopiedColumn[] {
  if (trigger.derives !== undefined) return [];
  return copyDeclarationsOf(domain, entity, trigger.invariant).resolved.filter((copy) => trigger.supplies.includes(copy.column));
}

/**
 * 写し元の道の列が書き換えられる宣言を名指す(写しは不変の祖先の列に限る)。
 *
 * @param trigger トリガの宣言
 * @param table 表
 * @param entity 表の集約
 * @param domain ドメイン仕様
 * @returns 違反
 */
export function checkCopySourceFixed(trigger: DataTriggerDecl, table: DataTableSpec, entity: string, domain: SpecModel): Finding[] {
  return suppliedCopies(trigger, entity, domain).flatMap((copy) =>
    copySources(copy).flatMap(({ entity: owner, column }) => {
      const specs = specsOf(domain, owner);
      if (specs === undefined || !writtenByDeclaration(column, specs)) return [];
      return [
        {
          verifier: VERIFIER_ID,
          severity: 'error' as const,
          message:
            `${table.table} のトリガ ${trigger.name} は ${copy.column} を ${copy.fromEntity}.${copy.fromColumn} から写しますが、写し元の道の ${owner}.${column} が` +
            '編集・遷移で書き換えられます(写しのトリガは写し元を掴まないので、写し元の更新と交錯すると read committed でも古い値の写しがコミットされます)',
          location: { ...table.location, pointer: `triggers.${trigger.name}.supplies` },
          suggestion:
            `写しは書き換えられない祖先の列に限る —— ${owner} の access_spec の writes / transition_writes(と状態機械の記録)から ${column} を外す。` +
            '書き換えたい列なら写しにしない(読む側が参照を辿る)',
          counterexample: { table: table.table, trigger: trigger.name, column: copy.column, source: `${owner}.${column}` },
        },
      ];
    }),
  );
}

/**
 * 写しのトリガが写す列そのものの更新で発火しないものを名指す。
 *
 * @param trigger トリガの宣言
 * @param table 表
 * @param entity 表の集約
 * @param domain ドメイン仕様
 * @param firesOnUpdateOf `fires` がその列の更新で発火するか(読みは本体の 1 本を渡す)
 * @returns 違反
 */
export function checkCopyFiresOnOwnColumn(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  entity: string,
  domain: SpecModel,
  firesOnUpdateOf: (fires: string, column: string) => boolean,
): Finding[] {
  const fires = trigger.fires ?? '';
  return suppliedCopies(trigger, entity, domain)
    .filter((copy) => !firesOnUpdateOf(fires, copy.column))
    .map((copy) => ({
      verifier: VERIFIER_ID,
      severity: 'error' as const,
      message: `${table.table} のトリガ ${trigger.name} は ${copy.column} の写しですが、${copy.column} 自身の更新で発火しません(直に書き換えた値が写し元と食い違ったまま残ります)`,
      location: { ...table.location, pointer: `triggers.${trigger.name}.fires` },
      suggestion: `fires に "update of ${copy.column}" を足す(例: "before insert or update of {参照の列}, ${copy.column}")`,
      counterexample: { table: table.table, trigger: trigger.name, column: copy.column, fires },
    }));
}
