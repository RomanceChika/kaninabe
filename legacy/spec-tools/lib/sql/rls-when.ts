/**
 * `reads[].when`(**行の状態で見え方を絞る条件**)→ ポリシーの `using` の中の述語(束 §14)。
 *
 * ⑳-1 の翻訳器(`guard-to-sql.ts`)の**呼び側がもう 1 つ増えた**だけである —— 差し替えるのは
 * 「パス 1 本をどの列に落とすか」で、式の意味(3 値論理と `coalesce` の位置)は 1 行も変えない。
 *
 * | `when` に書けるパス | 届き方 |
 * |---|---|
 * | 自集約の欄(`state` / `{自集約}.{欄}`) | 対象の行の列(ポリシーの中では表名が別名) |
 * | 親の欄(`{集約}.{欄}`) | **参照の鎖をスカラー副問い合わせで辿る**(`rpc-reach.ts` と同じ手) |
 * | `actor.{欄}` | **書けない**(V2 がエラーにする)。実行者の属性で狭めるのは `filters` の役である |
 *
 * 親の欄を join ではなく副問い合わせで辿るのは、辿った先の行が無いときに「不明」を返させる
 * ためである —— join は行そのものを消すので、「条件が不明だから見せない」と「そもそも対象が
 * 無い」が区別できなくなる(`rpc-reach.ts` の同じ判断と同じ理由)。
 *
 * **`actor` を写さないのは検査の二重化である。** 仕様の側で書けなくするのは V2 であり、ここは
 * 「写せない」と報告することで二重に閉じる(`guard-to-sql.ts` が boolean の順序比較を断るのと
 * 同じ構えで、翻訳器の側が最後の砦になる)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PathRef } from '../guard/ast.js';
import { parseGuard } from '../guard/parser.js';
import type { SpecModel } from '../model/types.js';
import type { ValueKind } from '../model/field-values.js';
import { valueKindOfFieldType } from '../model/field-values.js';
import { findField } from '../semantics/domain-index.js';
import { entityOf } from '../usecase/param-source-facts.js';
import type { GuardSqlBindings } from './guard-to-sql.js';
import { guardToSql } from './guard-to-sql.js';

/** 実行者を指す予約語のルート(`when` には書けない)。 */
const ACTOR_ROOT = 'actor';

/** 全テーブルが持つ主キー列(表の規約)。 */
const KEY_COLUMN = 'id';

/** 翻訳に要る文脈(ポリシーの中での対象の行の呼び名と、親への届き方)。 */
export interface WhenSqlInput {
  /** 対象の集約。 */
  readonly entity: string;
  /** ポリシーの中で対象の行を指す名前(表名、またはマスク述語の引数名)。 */
  readonly rowAlias: string;
  readonly domain: SpecModel;
  /**
   * 親の集約への届き方(その集約の行の id を与える SQL)。
   *
   * 鎖の辿り方はポリシーの側が既に持っている(ロールの束縛が同じ鎖を使う)ので、写し方を
   * 2 本書かないために呼び側から渡す。
   */
  readonly idOf: (entity: string) => string | null;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
}

/** 翻訳の結果(写せなかったものは名前で返す。生成器は throw しない)。 */
export type WhenSqlResult =
  | { readonly ok: true; readonly sql: string }
  | { readonly ok: false; readonly reason: string };

/**
 * `reads[].when` を全域(NULL を返さない)な SQL 述語にする。
 *
 * @param source `when` の生文字列
 * @param input 対象の集約・行の呼び名・親への届き方
 * @returns 述語、または写せなかった理由
 */
export function readWhenSql(source: string, input: WhenSqlInput): WhenSqlResult {
  const parsed = parseGuard(source);
  if (!parsed.ok) return { ok: false, reason: parsed.error.message };
  const translated = guardToSql(parsed.expr, bindingsFor(input));
  if (translated.ok) return { ok: true, sql: translated.sql };
  return {
    ok: false,
    reason: [...translated.unresolved, ...translated.rejected].join(' / '),
  };
}

/** ポリシーの文脈での解決器(`contains` は宣言しない —— 集合の相手は `actor.id` しかない)。 */
function bindingsFor(input: WhenSqlInput): GuardSqlBindings {
  return {
    column: (path) => columnSql(path, input),
    valueKind: (path) => valueKindOf(path, input),
  };
}

/** パスが指す集約と欄(`state` のような 1 語は自集約の欄)。 */
function splitPath(path: PathRef, input: WhenSqlInput): { entity: string; field: string } | null {
  const segments = path.segments;
  if (segments[0] === ACTOR_ROOT) return null;
  if (segments.length === 1) {
    const field = segments[0];
    return field === undefined ? null : { entity: input.entity, field };
  }
  if (segments.length !== 2) return null;
  const [head, field] = segments;
  if (head === undefined || field === undefined) return null;
  const entity = entityOf(input.domain, head);
  return entity === null ? null : { entity, field };
}

/** パス 1 本の SQL の式(届かなければ `null`)。 */
function columnSql(path: PathRef, input: WhenSqlInput): string | null {
  const split = splitPath(path, input);
  return split === null ? null : rowFieldSql(split.entity, split.field, input);
}

/**
 * 対象の行、または参照の鎖で届く親の行の 1 欄の SQL の式。
 *
 * 状態の条件(`when`)と境界(`filters` の親の列)の**両方がこの 1 本を通る** —— 親の欄の届き方を
 * 2 本書くと、片方だけが「2 段目を辿れる」ような食い違いが静かに入る。親の行が無ければ NULL を返す
 * スカラー副問い合わせであり、呼び側が式全体を 2 値に閉じる。
 *
 * @param entity 欄を持つ集約(対象の集約か、その親)
 * @param field 欄の名前
 * @param input 対象の集約・行の呼び名・親への届き方
 * @returns SQL の式(欄が無い・届かなければ `null`)
 */
export function rowFieldSql(entity: string, field: string, input: WhenSqlInput): string | null {
  if (findField(input.domain, entity, field) === null) return null;
  if (entity === input.entity) return `${input.rowAlias}.${field}`;
  const table = input.tableOf(entity);
  const id = input.idOf(entity);
  if (table === null || id === null) return null;
  const alias = `w_${entity}`;
  return `(select ${alias}.${field} from public.${table} ${alias} where ${alias}.${KEY_COLUMN} = ${id})`;
}

/** パスが指す欄の値の種別(entity_spec の型からの写像)。 */
function valueKindOf(path: PathRef, input: WhenSqlInput): ValueKind | null {
  const split = splitPath(path, input);
  const field = split === null ? null : findField(input.domain, split.entity, split.field);
  return field === null ? null : valueKindOfFieldType(field.type);
}
