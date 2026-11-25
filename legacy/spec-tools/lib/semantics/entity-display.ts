/**
 * 集約の**表示の宣言**(entity_spec の `display_field`)を引く。
 *
 * 生成物が行の名前を出す場所(確認ダイアログの本文)と、S18 が参照の欄の選択肢の表示名の規則を見るときが、
 * 同じ導出を見る。宣言の正は entity_spec(ADR-0016)で、実在と型は V22 が見るので、ここは宣言をそのまま返す。
 * 純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';

/**
 * エンティティ(または集約)の**行の名前の欄**(entity_spec の `display_field`)を引く。
 *
 * 生成物が行の名前を出す場所(確認ダイアログの本文)と、S18 が参照の欄の選択肢の表示名の規則を見るときに使う。
 * 実在と型は V22 が見るので、ここは宣言をそのまま返す。
 *
 * @param model ドメイン仕様全体
 * @param entity エンティティ名(または集約名)
 * @returns 欄の名前。宣言が無い・エンティティが無いときは undefined
 */
export function findDisplayField(model: SpecModel, entity: string): string | undefined {
  for (const [aggregate, specs] of model.aggregates) {
    const spec = specs.entity;
    if (spec === undefined) continue;
    if (spec.entity === entity || aggregate === entity) return spec.displayField;
  }
  return undefined;
}
