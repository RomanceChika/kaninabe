/**
 * 不変条件が「どのエンティティのどのフィールドを見ているか」の抽出。
 *
 * A7 の編集(`{entity}.update`)の導出が使う。編集で不変条件が破れうるかは、
 * **その不変条件が参照するフィールドと、`writes[].fields` が交わるか**で決まる
 * (action-spec-writing.md §A7 の導出規則)。
 *
 * 抽出は形式定義(`formal`)からのみ行う。`statement`(人間可読の文)は読まない —
 * 機械が数えてよいのは形式定義だけであり、文章から推測を始めると導出が再現しなくなる。
 * `formal` を持たない不変条件(集計を含む制約など)はここでは「参照フィールド不明」であり、
 * 交わり判定に現れない(その場合の宿題は `application` 執行の宣言とレビューが持つ)。
 */

import { parseFormalGuard } from '../guard/parser.js';
import { collectPaths } from '../guard/services.js';
import type { InvariantDef, InvariantFormal } from '../model/types.js';

/**
 * 参照されたフィールド 1 つ。`{entity}.{field}` の形に正規化して持つ。
 *
 * 裸のフィールド名(`workshop_id`)は**その不変条件を宣言した集約のエンティティ**のものとして
 * 解決する。ガード式の中では `entry.state` のように修飾されることが多いが、`uniqueness` の
 * `keys` のように裸で書ける欄があるためである。
 */
export type FieldRef = string;

/** 式に現れないパスの先頭(ガード式の予約語)。フィールド参照ではないので落とす。 */
const RESERVED_HEADS = new Set(['now', 'actor']);

/**
 * 形式定義が参照するフィールドを列挙する。
 *
 * @param formal 不変条件の形式定義
 * @param ownEntity 裸のフィールド名の解決先(その不変条件を宣言した集約のエンティティ名)
 * @returns `{entity}.{field}` に正規化した参照の集合
 */
function fieldsOfFormal(formal: InvariantFormal, ownEntity: string): Set<FieldRef> {
  const found = new Set<FieldRef>();
  const addBare = (name: string): void => {
    found.add(`${ownEntity}.${name}`);
  };
  const addExpr = (source: string): void => {
    for (const ref of fieldsOfExpr(source, ownEntity)) found.add(ref);
  };

  switch (formal.kind) {
    case 'check':
      addExpr(formal.expr);
      return found;
    case 'uniqueness':
      formal.keys.forEach(addBare);
      if (formal.where !== undefined) addExpr(formal.where);
      return found;
    case 'exclusion':
      formal.keys.forEach(addBare);
      // 期間の 2 フィールドも「この不変条件が見ている欄」である(鍵と同じ裸の名前)。
      formal.range.forEach(addBare);
      if (formal.where !== undefined) addExpr(formal.where);
      return found;
    case 'cardinality':
      formal.keys.forEach(addBare);
      // 上限は数値リテラルか親フィールドの参照(`workshop.capacity`)。後者は**編集で動く値**である。
      // ここはガード式ではなく**パス単体**なので、式としてではなくパスとして読む。
      if (typeof formal.max === 'string') found.add(normalizePath(formal.max, ownEntity));
      if (formal.where !== undefined) addExpr(formal.where);
      return found;
    case 'state_dependency':
      addExpr(formal.if);
      addExpr(formal.then);
      return found;
  }
}

/**
 * パス表記 1 つを `{entity}.{field}` に正規化する。
 *
 * 裸の名前(`capacity`)はその不変条件を宣言した集約のエンティティのものとして解決する。
 *
 * @param source パス表記(`workshop.capacity` / `capacity`)
 * @param ownEntity 裸のパスの解決先エンティティ名
 * @returns 正規化した参照
 */
function normalizePath(source: string, ownEntity: string): FieldRef {
  const segments = source.trim().split('.');
  const head = segments[0] ?? '';
  const second = segments[1];
  return second === undefined ? `${ownEntity}.${head}` : `${head}.${second}`;
}

/**
 * ガード式の中のフィールド参照を列挙する。
 *
 * パースできない式は**空**として扱う(式が壊れていること自体は V 群が別にエラーにするので、
 * ここで宿題を増やしても診断が重複するだけである)。
 *
 * @param source ガード式の生文字列
 * @param ownEntity 裸のパスの解決先エンティティ名
 * @returns `{entity}.{field}` に正規化した参照
 */
function fieldsOfExpr(source: string, ownEntity: string): FieldRef[] {
  const parsed = parseFormalGuard(source);
  if (!parsed.ok) return [];
  const refs: FieldRef[] = [];
  for (const path of collectPaths(parsed.expr)) {
    const head = path.segments[0];
    if (head === undefined || RESERVED_HEADS.has(head)) continue;
    refs.push(normalizePath(path.segments.join('.'), ownEntity));
  }
  return refs;
}

/**
 * その不変条件が、指定したエンティティの指定したフィールドのどれかを参照しているか。
 *
 * @param invariant 対象の不変条件
 * @param ownEntity その不変条件を宣言した集約のエンティティ名(裸のフィールド名の解決先)
 * @param entity 交わりを調べる相手のエンティティ名
 * @param fields 交わりを調べるフィールド名(`writes[].fields` など)
 * @returns 1 つでも交われば true。`formal` が無い不変条件は常に false
 */
export function touchesFields(
  invariant: InvariantDef,
  ownEntity: string,
  entity: string,
  fields: readonly string[],
): boolean {
  if (invariant.formal === undefined) return false;
  const referenced = fieldsOfFormal(invariant.formal, ownEntity);
  return fields.some((field) => referenced.has(`${entity}.${field}`));
}
