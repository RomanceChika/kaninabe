/**
 * world の設計図が運ぶ**読み取り規則**(access_spec の `reads` の写し。オラクルが可視集合を計算する材料)。
 *
 * `rls-world.ts` が呼ぶ下位の部品で、責務は「読み取り規則を、実行する側が読む形にする」こと
 * だけである —— 状態の条件はエンジンの AST に開き、境界(`filters`)は対象の行から境界の列を持つ行へ
 * 辿る参照列の鎖(`via`)にする。鎖はポリシーの述語と同じ解決(`resolveReadFilter`)から出す。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, SpecModel } from '../model/types.js';
import { parseGuard } from '../guard/parser.js';
import type { GuardExprData } from '@kaninabe/runtime/engine';
import { guardExprData } from '../guard/expr-data.js';
import { resolveReadFilter } from '../model/read-filter-path.js';

/** 読み取り規則 1 本(オラクルが可視集合を計算する材料)。 */
export interface RlsWorldRead {
  readonly by: string;
  readonly scope: 'own' | 'all' | 'none' | 'context';
  /**
   * 境界(`filters`)。`via` は対象の行から境界の列を持つ行へ辿る参照列の並び(根から順。自集約の列なら空)。
   * オラクルは実 DB の行でこの鎖を辿る —— ポリシーが辿るのと同じ列である(`resolveReadFilter`)。
   */
  readonly filters: readonly { readonly field: string; readonly actorField: string; readonly via: readonly string[] }[];
  /**
   * 行の状態で絞る条件を**エンジンが読む形**にしたもの(無ければ `null`。束 §14)。
   *
   * オラクルはこれを app の評価器(`domain/engine/guard.ts`)に掛ける —— SQL の翻訳器とは
   * 別の写像であり、しかも**意味の正そのもの**である(同じ式を DB 用に写したのがポリシー側)。
   * 式の生文字列ではなく AST を渡すのは、実行する側にパーサーを置かないためである。
   */
  readonly when: GuardExprData | null;
}

/**
 * 読み取り規則を設計図の形に写す。
 *
 * 状態の条件はここで AST に開く —— パースできない式は `null` に倒すが、その式は V2 が既に
 * error で報告しているので、設計図が黙って緩むことはない(生成そのものが止まる)。
 *
 * @param domain ドメイン仕様(境界の鎖を解決する)
 * @param entity 対象の集約
 * @param rule 読み取り規則 1 本
 * @returns 設計図の読み取り規則
 */
export function readOf(domain: SpecModel, entity: string, rule: AccessSpec['reads'][number]): RlsWorldRead {
  const parsed = rule.when === undefined ? null : parseGuard(rule.when);
  return {
    by: rule.by,
    scope: rule.scope.kind,
    // 届かない境界は world そのものを作らない(`unresolvedFilterEntity`)ので、ここでは解決済みである。
    filters: (rule.filters ?? []).map((filter) => {
      const resolution = resolveReadFilter(domain, entity, filter);
      return { field: filter.field, actorField: filter.actorField, via: resolution.ok ? resolution.resolved.via : [] };
    }),
    when: parsed?.ok === true ? guardExprData(parsed.expr) : null,
  };
}

/**
 * 境界の左辺が解決できない読み取り規則があれば、その集約(V2 が error で報告している形)。
 *
 * 解決できない境界のまま world を作ると、オラクルが別の列を比べて期待が黙ってずれる ——
 * 作らずに理由を返す(T8 の報告に載る)。
 *
 * @param domain ドメイン仕様
 * @param access 対象の集約のアクセス宣言
 * @returns 解決できない境界の集約(無ければ null)
 */
export function unresolvedFilterEntity(domain: SpecModel, access: AccessSpec): string | null {
  for (const rule of access.reads) {
    for (const filter of rule.filters ?? []) {
      if (!resolveReadFilter(domain, access.entity, filter).ok) return filter.entity ?? access.entity;
    }
  }
  return null;
}
