/**
 * binding / filters の左辺パスを、起点エンティティから見た PostgREST の列パスに写す純粋関数群。
 *
 * **列パスの導出だけ**を持つ(スコープ条件の宣言表の生成器 `code-query-windows.ts` は、この結果を表に
 * 並べるだけである)。
 *
 * ## 列パスの導き方(binding → PostgREST のパス)
 *
 * binding は `{entity}.{field} == actor.id` の形をしている。起点のエンティティ E から見て、
 * 1. `{entity}` が E 自身なら、列はそのまま `{field}`(例: entry_owner → `owner_id`)
 * 2. そうでなければ E の `context` で辿る。`{field}` が相手の主キー `id` なら、辿った先を
 *    見に行く必要は無く**手前の外部キー列に畳める**(例: invitation の account_owner は
 *    `member.id == actor.id` だが `context: {member: invitation.issued_by}` なので `issued_by`)
 * 3. 畳めないなら埋め込みのパスにする(例: entry の organizer は `workshops.organizer_id`)
 * 4. **段が 2 つある**(`{起点}.{中継}.{相手}.{欄}`)なら、埋め込みを段ごとに重ねる
 *    (`{起点}.{中継}.{欄}` の形)。PostgREST は入れ子の埋め込みに対する絞り込みを
 *    同じ列パスの記法で受けるので、写しの列を増やさずに 2 段先の束縛をスコープ条件にできる(束 ⑲-2a)。
 *    最後の段が主キーなら、その段の手前の外部キー列に畳む(段が 1 つ減る)
 */

import type { EntitySpec, RoleDef, SpecModel } from '../model/types.js';
import type { GuardExpr, GuardServices, PathRef } from '../guard/ast.js';
import { pluralizeEntity } from '../model/table-name.js';
import { columnOf, contextRoute, MAX_CONTEXT_HOPS } from '../model/path-hops.js';
import { findEntitySpec, findRole } from './domain-lookup.js';

/** actor を指す予約パス。binding の右辺はこれ以外を取らない(V11 が接地を見る)。 */
const ACTOR_ID = 'actor.id';

/** `param.{name}` の起点(query-spec-writing.md の実行時入力の語彙)。 */
const PARAM_ROOT = 'param';

/** 相手の主キー(この列に対する binding は手前の外部キーに畳める)。 */
const PRIMARY_KEY = 'id';

/** エンティティ名 → テーブル名(entity_spec の `table:` があればそれが正)。 */
export function tableOf(model: SpecModel, entity: string): string {
  const spec = findEntitySpec(model, entity);
  return spec?.table ?? pluralizeEntity(spec?.entity ?? entity);
}

/**
 * 文脈依存ロールの binding を、起点エンティティから見た列パスに写す。
 *
 * @param model ドメイン仕様全体
 * @param guards ガード式のパース(binding は同じ文法)
 * @param entity 起点のエンティティ(クエリの source、または併読先)
 * @param role `via` に書かれたロール ID
 * @returns 列パス。グローバルロール(binding 無し)や解決できない形なら null
 */
export function bindingColumn(
  model: SpecModel,
  guards: GuardServices,
  entity: string,
  role: string,
): string | null {
  const def: RoleDef | null = findRole(model, role);
  if (def?.binding === undefined) return null;
  const target = actorEqualityPath(guards, def.binding);
  if (target === null) return null;
  return resolveColumn(model, entity, target);
}

/** `{path} == actor.id` 1 本だけの式なら、その左辺のパスを返す。 */
function actorEqualityPath(guards: GuardServices, source: string): PathRef | null {
  const parsed = guards.parse(source);
  if (!parsed.ok) return null;
  return actorEqualityOf(parsed.expr);
}

/** 式が `{path} == actor.id` の比較 1 本ならその左辺、そうでなければ null。 */
function actorEqualityOf(expr: GuardExpr): PathRef | null {
  if (expr.kind !== 'compare' || expr.op !== '==') return null;
  if (expr.rhs.kind !== 'path' || expr.rhs.path.segments.join('.') !== ACTOR_ID) return null;
  return expr.path;
}

/** filters 1 本が actor を参照していれば、その列パスを返す。 */
export function actorFilterColumn(
  model: SpecModel,
  guards: GuardServices,
  entity: string,
  source: string,
): string | null {
  const target = actorEqualityPath(guards, source);
  if (target === null) return null;
  return resolveColumn(model, entity, target);
}

/** 併読の filters 1 本が `== param.{name}` の形であれば、その列パスと param 名を返す。 */
export function paramFilterCondition(
  model: SpecModel,
  guards: GuardServices,
  entity: string,
  source: string,
): { readonly column: string; readonly param: string } | null {
  const parsed = guards.parse(source);
  if (!parsed.ok) return null;
  const paramRef = paramEqualityOf(parsed.expr);
  if (paramRef === null) return null;
  const column = resolveColumn(model, entity, paramRef.path);
  if (column === null) return null;
  return { column, param: paramRef.param };
}

/** 式が `{path} == param.{name}` の比較 1 本なら左辺のパスと `{name}`、そうでなければ null。 */
function paramEqualityOf(
  expr: GuardExpr,
): { readonly path: PathRef; readonly param: string } | null {
  if (expr.kind !== 'compare' || expr.op !== '==') return null;
  if (expr.rhs.kind !== 'path') return null;
  const segments = expr.rhs.path.segments;
  if (segments.length !== 2 || segments[0] !== PARAM_ROOT) return null;
  const param = segments[1];
  if (param === undefined) return null;
  return { path: expr.path, param };
}

/**
 * binding / filters の左辺パスを、起点エンティティから見た PostgREST の列パスに写す。
 *
 * @returns 列パス。context に解決先が無い(V11 が別途落とす)なら null
 */
function resolveColumn(model: SpecModel, entity: string, path: PathRef): string | null {
  const spec = findEntitySpec(model, entity);
  if (spec === null) return null;
  const segments = path.segments;
  const field = segments[segments.length - 1];
  if (field === undefined) return null;
  // 単一セグメント(`owner_id == actor.id`)は起点エンティティの裸のフィールド参照。
  if (segments.length === 1) return field;
  const head = segments[0];
  if (head === undefined) return null;
  const hops = segments.slice(isOwnName(model, spec, entity, head) ? 1 : 0, -1);
  if (hops.length === 0) return field;
  return throughContext(model, spec, hops, field);
}

/** パスの先頭が起点エンティティ自身を指しているか(集約ディレクトリ名でも書ける)。 */
function isOwnName(model: SpecModel, spec: EntitySpec, entity: string, head: string): boolean {
  if (head === spec.entity || head === entity) return true;
  return findEntitySpec(model, head) === spec;
}

/**
 * `context` を段ごとに辿って列パスにする(段は 2 つまで。V2 が深さを見ている)。
 *
 * 相手の主キーに対する binding は、辿った先を見なくても手前の外部キー列で同じ集合になるので
 * 畳む(埋め込みを 1 つ減らせる)。畳めるのは**最後の段**だけである —— 途中の段は、その先の
 * 列を読むために埋め込みが要る。
 */
function throughContext(
  model: SpecModel,
  spec: EntitySpec,
  hops: readonly string[],
  field: string,
): string | null {
  const route = expandRoute(model, spec, hops);
  if (route === null) return null;
  const tables: string[] = [];
  let current: EntitySpec | null = spec;
  for (const [index, hop] of route.entries()) {
    if (current === null) return null;
    const via: string | undefined = current.context[hop];
    if (via === undefined) return null;
    if (index === route.length - 1 && field === PRIMARY_KEY) {
      // 最後の段の相手の主キーを見るだけなら、手前の外部キー列で同じ集合になる。
      const foreignKey = columnOf(via);
      if (foreignKey === undefined) return null;
      return [...tables, foreignKey].join('.');
    }
    tables.push(tableOf(model, hop));
    current = findEntitySpec(model, hop);
  }
  return [...tables, field].join('.');
}

/**
 * パスが名指したホップを、**実際に辿る経路**へ展開する。
 *
 * 経路探索の正は `lib/model/path-hops.ts`(V2 のパス解決と同じ規則)である —— 検査が通す形と
 * 生成物が写す形が食い違うと、「verify は緑なのにスコープ条件が空で、宣言より広い集合が返る」という
 * 最も気づきにくい穴になる(束 ⑲-2a で 2 段先の `{相手}.{欄}` のスコープ条件が空になって実測した)。
 */
function expandRoute(model: SpecModel, spec: EntitySpec, hops: readonly string[]): readonly string[] | null {
  const route: string[] = [];
  let current: EntitySpec | null = spec;
  let budget = MAX_CONTEXT_HOPS;
  for (const hop of hops) {
    if (current === null) return null;
    const step = contextRoute(model, current, hop, budget);
    if (step === null) return null;
    route.push(...step);
    budget -= step.length;
    current = findEntitySpec(model, hop);
  }
  return route;
}
