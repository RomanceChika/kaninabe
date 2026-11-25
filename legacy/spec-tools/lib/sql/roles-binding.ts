/**
 * 文脈依存ロールの `binding` → SQL 述語への翻訳(純関数)。
 *
 * `binding: {entity}.{field} == actor.id` はガード式と同じ文法なので、**同じ翻訳器**
 * (`guard-to-sql.ts`)に通す。ここが与えるのはその呼び側の写像だけである ——
 * 「届いた先の行の列」と「実行者 id」の 2 つに落ちる形が、この文法の全部だからである。
 *
 * `roles-to-sql.ts` と別に置くのは、**呼ぶ文脈が増えても変わらない
 * 部分**がここに閉じているからである(RPC の本文と RLS のポリシーで差し替わるのは実行者 id と
 * グローバルロールの根拠だけで、束縛の翻訳は 1 つで足りる)。
 */

import type { GuardExpr, PathRef } from '../guard/ast.js';
import type { RoleDef } from '../model/types.js';
import { parseGuard } from '../guard/parser.js';
import { pathKey } from '../guard/atoms.js';
import { collectPaths } from '../guard/services.js';
import { guardToSql } from './guard-to-sql.js';
import type { EntityReach, RoleFailures, RoleSqlBindings } from './roles-to-sql.js';

/** `binding` の右辺に書ける唯一のパス(V11)。 */
const ACTOR_ID_PATH = 'actor.id';

/** 実行者を指す予約語のルート。 */
const ACTOR_ROOT = 'actor';

/** 予約語 `now`(束縛の参照先エンティティには数えない)。 */
const NOW_ROOT = 'now';

/**
 * 対象の行との関係が根拠のロール。`binding` はガード式と同じ文法なので、同じ翻訳器に通す。
 *
 * 届き方が `join` のエンティティを参照していれば、述語ごと EXISTS の中に入れる
 * (既存の手書き RLS と同じ字面)。参照するエンティティが 2 つ以上ある binding は
 * この束では写さない —— `{entity}.{field} == actor.id` の 1 形しか仕様に現れない。
 *
 * @param role ロール定義(反例の名前に使う)
 * @param binding 束縛の生文字列
 * @param bindings 実行者 id とエンティティの届き方
 * @param failures 写せなかったものの記録先
 * @returns 全域な SQL 述語(写せなければ `false` を返し `failures` に積む)
 */
export function bindingSql(
  role: RoleDef,
  binding: string,
  bindings: RoleSqlBindings,
  failures: RoleFailures,
): string {
  const parsed = parseGuard(binding);
  if (!parsed.ok) {
    failures.unresolved.push(`binding:${role.id}`);
    return 'false';
  }
  const entities = bindingEntities(parsed.expr);
  const entity = entities.length === 1 ? entities[0] : undefined;
  const reach = entity === undefined ? null : bindings.reach(entity);
  if (reach === null) {
    failures.unresolved.push(`binding:${role.id}`);
    return 'false';
  }
  const translated = guardToSql(parsed.expr, {
    column: (path) => bindingColumn(path, reach, bindings.actorId),
    valueKind: (path) => (pathKey(path) === ACTOR_ID_PATH ? 'opaque' : bindings.valueKind(path)),
    contains: (path, ref) => containsSql(path, ref, reach, bindings.actorId),
  });
  if (!translated.ok) {
    failures.unresolved.push(...translated.unresolved.map((at) => `binding:${role.id}:${at}`));
    failures.rejected.push(...translated.rejected.map((at) => `binding:${role.id}:${at}`));
    return 'false';
  }
  if (reach.kind === 'row') return translated.sql;
  return `exists (select 1 from ${reach.table} ${reach.alias} where ${reach.on} and ${translated.sql})`;
}

/**
 * `binding: {entity}.{列} contains actor.id`(配列の列に実行者が入っているか)。
 *
 * ガード式の一般の `contains` は「呼び側が形を知っている」ので写像を受け取るが、**binding の
 * `contains` は形が 1 つに決まっている** —— 比べてよいのは `actor.id` だけ(V11)で、集合側は
 * 届いた先の行の列だからである。呼び側に口を開けても全員が同じ字面を書くことになるので、
 * ここで解決する(規約 §role_spec が正しい書き方として例示している形を、仕組みが受け取れない
 * ままにしない —— 束 ⑳-1b のレビュー 2-G)。
 *
 * @param path 集合側のパス(`{entity}.{列}`)
 * @param ref 要素側のパス(`actor.id` 以外は写せない)
 * @param reach 集合側のエンティティへの届き方
 * @param actorId 実行者 id の SQL
 * @returns 配列メンバーシップの述語。写せなければ `null`
 */
function containsSql(
  path: PathRef,
  ref: PathRef,
  reach: EntityReach,
  actorId: string,
): string | null {
  if (pathKey(ref) !== ACTOR_ID_PATH) return null;
  const column = bindingColumn(path, reach, actorId);
  return column === null || column === actorId ? null : `${actorId} = any(${column})`;
}

/**
 * 束縛が指す**唯一の**集約(参照する集約が 0 個 / 2 個以上なら写せない)。
 *
 * ロールの根拠が立つ集約であり、`reads[].scope` の宣言(`own` / `context(X)`)と突き合わせる
 * ための手がかりでもある —— どちらも「その行が見えてよい理由」を別の言い方で書いたものなので、
 * 食い違っていたら生成できる SQL が宣言より広く / 狭くなる。
 *
 * @param binding 束縛の生文字列
 * @returns 集約名。パースできない / 1 つに決まらなければ `null`
 */
export function bindingEntity(binding: string): string | null {
  const parsed = parseGuard(binding);
  if (!parsed.ok) return null;
  const entities = bindingEntities(parsed.expr);
  return entities.length === 1 ? (entities[0] ?? null) : null;
}

/** binding が参照するエンティティ(`actor` / `now` を除いたパスの根)。 */
function bindingEntities(expr: GuardExpr): readonly string[] {
  const names = new Set<string>();
  for (const path of collectPaths(expr)) {
    const root = path.segments[0];
    if (root === undefined || root === ACTOR_ROOT || root === NOW_ROOT) continue;
    names.add(root);
  }
  return [...names];
}

/**
 * binding のパス 1 本を SQL に写す(`actor.id` は実行者の引数、それ以外は届いた先の列)。
 *
 * **`actor.{id 以外の欄}` は写さない**。実行者の属性を届いた先の行の列(`d.company_id`)に
 * 落とすと、意味が別物になったまま黙って通る —— V11 が先にエラーにする形ではあるが、検査器 1 つに
 * 寄りかからない(束 ⑳-1b のレビュー 2-H)。
 */
function bindingColumn(path: PathRef, reach: EntityReach, actorId: string): string | null {
  const key = pathKey(path);
  if (key === ACTOR_ID_PATH) return actorId;
  if (path.segments[0] === ACTOR_ROOT) return null;
  if (path.segments.length !== 2) return null;
  const field = path.segments[1];
  return field === undefined ? null : `${reach.alias}.${field}`;
}
