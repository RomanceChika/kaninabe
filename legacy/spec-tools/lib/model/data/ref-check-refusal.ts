/**
 * 参照の欄が指す行を読む条件の**相手の端が断るときの文言**(`ref-check-shape.ts` の相手の端の計画から決まる)。
 *
 * 形は「{相手の集約の表示名}の{読む欄の表示名}を変えられません。この決まりに合わない{自表の集約の表示名}が N 件あります({言明})」。
 * 表示名は既存の宣言(entity_spec の `label`・`fields[].label`)だけを使い、無ければ内部名に倒す(新しい宣言の種類は足さない)。
 * **件数だけを出し、行の中身や id は出さない**(断りは画面に届く。行の中身は相手の側の権限で読める範囲を越えうる)。
 *
 * 文言は件数の前後の 2 つの字面に割って持つ —— DB の本文(`sql/ddl-ref-check-ends.ts`)は件数を挟んで `raise` の本文にし、画面
 * (生成物 `invariants.ts` の `counterpartRefusalText`)は DB の detail が運ぶ件数を挟む。どちらも同じこの 1 本を呼ぶ。
 * DB の detail は `{トリガ名}: {不変条件 ID}: {件数}`(`counterpartDetailPrefix` + 件数)で、実行時の分類(`@kaninabe/runtime` の
 * `classifyDbFailure`)がこの形だけを `edge` に写す(DB の自由な文言は画面へ運ばない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr } from '../../guard/ast.js';
import { collectPaths } from '../../guard/services.js';
import { formalExpr } from '../formal-expr.js';
import { columnsOfRoot, type RefCounterpart } from './ref-check-shape.js';

/** 件数の前後の字面。 */
export interface CounterpartRefusal {
  readonly before: string;
  readonly after: string;
}

/** 読む欄の区切り。 */
const COLUMN_SEPARATOR = '・';

/**
 * 相手の端 1 本の断りの文言。
 *
 * @param end 相手の端の計画
 * @returns 件数の前後の字面
 */
export function counterpartRefusalOf(end: RefCounterpart): CounterpartRefusal {
  const formal = end.invariant.formal;
  const parsed = formal?.kind === 'check' || formal?.kind === 'state_dependency' ? formalExpr(formal) : null;
  const expr: GuardExpr | null = parsed !== null && parsed.ok ? parsed.expr : null;
  const columns = expr === null ? [] : columnsOfRoot(collectPaths(expr), new Set([end.row.root, end.row.entity.entity]));
  const labelOf = (column: string): string => end.row.entity.fields.find((field) => field.name === column)?.label ?? column;
  const other = end.row.entity.label ?? end.row.entity.entity;
  const host = end.hostEntity.label ?? end.hostEntity.entity;
  return {
    before: `${other}の${columns.map(labelOf).join(COLUMN_SEPARATOR)}を変えられません。この決まりに合わない${host}が `,
    after: ` 件あります(${end.invariant.statement})`,
  };
}

/**
 * DB の detail の件数の前の字面(`{トリガ名}: {不変条件 ID}: `)。
 *
 * @param end 相手の端の計画
 * @returns detail の頭
 */
export function counterpartDetailPrefix(end: RefCounterpart): string {
  return `${end.name}: ${end.invariant.id}: `;
}
