/**
 * ガード式のパスを「どのエンティティのどのフィールドを指すか」まで解決する純粋モジュール。
 *
 * 解決規則の正は domain-spec-writing.md §ガード式の文法であり、起点のエンティティ
 * (query_spec なら `source`、screen_spec なら `subject`)から見て次の 4 つが解決できる。
 *
 * - `actor.{欄}` / `now` … 予約語。解決対象を持たないが、**書ける形は閉じている**
 *                          (`actor` は `.id` と**セッションに載る欄**だけ、`now` は単独だけ)
 * - `{field}`            … 起点自身のフィールド(裸のフィールド名)
 * - `{起点}.{field}`     … 起点自身のフィールド(完全形)
 * - `{other}.{field}`    … 起点の entity_spec の `context` で解決できるエンティティのフィールド
 * - `{a}.{b}.{field}`    … **`context` の連鎖を 2 段まで**辿ったフィールド(束 ⑲-2a)。
 *                          各段は「手前のエンティティの `context` に宣言があり、その参照パスが
 *                          `ref(次のエンティティ)` の欄である」ことを要求する ——
 *                          `{起点}.{中継}.{相手}.{欄}` は `{起点} → {中継} → {相手}`
 *                          の 2 ホップである。1 段しか辿れなかったあいだ、木の各段に
 *                          写しの列(`{起点}.{相手}_id`)とそれを埋めるトリガと一致を守る
 *                          不変条件が要った(束 ⑱ の題材 B / D が実測)
 *
 * ここに置いてあるのは**仕様種に依らない部分**だけである。仕様種ごとの追加の語彙
 * (query_spec の `param.{name}` など)は各仕様種のモジュールが前段で処理し、
 * 残りをこの関数に渡す。同じ解決規則を 2 つ書くと、片方だけが直る事故が起きるため。
 *
 * このファイルの責務は**欄の解決**(予約語・自身の欄・`context` の連鎖の終点の欄)である。連鎖を
 * 何段で辿れるかの探索は `path-hops.ts` が持ち、ここはそれを読む(経路探索だけを使う別の使い手が
 * いるので、探索は別の部品になっている)。
 */

import type { PathRef } from '../guard/ast.js';
import type { EntitySpec, SpecModel } from './types.js';
import { MAX_CONTEXT_HOPS, walkHops } from './path-hops.js';

export { contextRoute } from './path-hops.js';

/** 式のどこからでも参照できる予約語のルート。 */
export const RESERVED_ROOTS: ReadonlySet<string> = new Set(['actor', 'now']);

/** 予約語 `actor` のルート名。 */
const ACTOR_ROOT = 'actor';

/** 予約語 `now` のルート名。 */
const NOW_ROOT = 'now';

/**
 * 予約語 `actor` の後ろに**常に**書けるフィールド(同一性)。
 *
 * これ以外に書けるのは、**セッションに載る欄**(`session: true`)だけである。閉じていなかった
 * 頃は `actor.idd` も `actor.role` も黙って通り、「実行者の属性で条件を書いたつもりが、何とも
 * 突き合わされない不透明値のまま」という最も危険な型の穴になっていた(元の製品 v2 第 2 版の
 * 変異 #11 で実測)。だから**開くのは宣言がある範囲だけ**にする。
 */
const ACTOR_FIELDS: ReadonlySet<string> = new Set(['id']);

/**
 * 実行者の属性として書ける欄の全体(`id` ∪ `session: true` の欄)。
 *
 * `session: true` は「この列の値をログインセッション(`app_metadata.profile`)に載せる」という
 * 宣言であり(V13 が 1 集約に閉じていることを見る)、その欄なら**DB を読まずに**実行者の属性
 * として引ける。`claim`(`{entity}.{field}` の boolean を根拠にロールを立てる)がこの機構を
 * 1 つの用途だけに使っていたのを、**式の語彙として一般化**したものである(束 ⑲-2a)。
 *
 * @param model ドメイン仕様全体
 * @returns 書ける欄の名前
 */
export function actorFields(model: SpecModel): ReadonlySet<string> {
  const fields = new Set<string>(ACTOR_FIELDS);
  for (const specs of model.aggregates.values()) {
    for (const field of specs.entity?.fields ?? []) {
      if (field.session) fields.add(field.name);
    }
  }
  return fields;
}

/**
 * 予約語 `actor` から始まるパスを解決する。
 *
 * @param path 解決するパス(先頭が `actor` であること)
 * @param model ドメイン仕様全体(セッションに載る欄の集合を引く)
 * @returns `actor.id` / `actor.{session の欄}` なら reserved、それ以外は理由付きの error
 */
export function resolveActorPath(path: PathRef, model: SpecModel): ResolvedPath {
  const second = path.segments[1];
  if (second === undefined) {
    return { kind: 'error', reason: '予約語 actor は単独では使えません(actor.id と書きます)' };
  }
  const allowed = actorFields(model);
  if (allowed.has(second) && path.segments.length === 2) return { kind: 'reserved' };
  return {
    kind: 'error',
    reason:
      `予約語 actor に ${second} はありません` +
      `(書けるのは id と session: true を宣言した欄だけ: ${[...allowed].join(' / ')})`,
  };
}

/**
 * 予約語 `now` から始まるパスを解決する。
 *
 * `now` は**単独でしか書けない**(現在時刻という 1 つの値であって、フィールドを持つ
 * オブジェクトではない)。`now.foo` のような書き方はどの宣言にも接地しないため、
 * actor と同じく閉じておく — 閉じていなければ `now.date` も `now.year` も黙って通り、
 * 「時刻の何かで条件を書いたつもりが、何とも突き合わされない不透明値のまま」になる。
 * 時刻の部分(日付だけ・時刻だけ)で条件を書きたくなったら、その値を持つフィールドを
 * エンティティ側に宣言して `{entity}.{field}` で参照する。
 *
 * @param path 解決するパス(先頭が `now` であること)
 * @returns `now` 単独なら reserved、後ろに何か付いていれば理由付きの error
 */
export function resolveNowPath(path: PathRef): ResolvedPath {
  const second = path.segments[1];
  if (second === undefined) return { kind: 'reserved' };
  return {
    kind: 'error',
    reason: `予約語 now に ${second} はありません(now は単独でしか書けません)`,
  };
}

/** パスに書ける最大のセグメント数(`{起点}.{ホップ}.{ホップ}.{フィールド}`)。 */
export const MAX_PATH_SEGMENTS = MAX_CONTEXT_HOPS + 2;

/** 上限を超えたパスを断る理由。 */
const TOO_DEEP_REASON =
  `パスは context を ${MAX_CONTEXT_HOPS} 段まで辿れます` +
  `(${MAX_PATH_SEGMENTS} セグメントを超えると解決できません)`;

/** パス 1 本の解決結果。 */
export type ResolvedPath =
  /** エンティティのフィールドを指すことが分かった。 */
  | { readonly kind: 'field'; readonly entity: string; readonly field: string }
  /** 予約語・実行時入力。フィールドを指さないので後続の検査対象にならない。 */
  | { readonly kind: 'reserved' }
  /** 解決できない。reason は「なぜ解決できないか」(そのまま Finding のメッセージに載る)。 */
  | { readonly kind: 'error'; readonly reason: string };

/**
 * 起点エンティティから見たパス 1 本を解決する。
 *
 * @param model ドメイン仕様全体(context の解決に使う)
 * @param origin 起点のエンティティ名(または集約ディレクトリ名)
 * @param path 解決するパス
 * @param originLabel 起点を人間に示すときの呼び名(例: "source" / "subject")
 * @returns 解決結果
 */
export function resolveEntityPath(
  model: SpecModel,
  origin: string,
  path: PathRef,
  originLabel: string,
): ResolvedPath {
  const root = path.segments[0];
  if (root === undefined) return { kind: 'error', reason: '空のパスです' };
  if (path.segments.length > MAX_PATH_SEGMENTS) return { kind: 'error', reason: TOO_DEEP_REASON };
  if (root === ACTOR_ROOT) return resolveActorPath(path, model);
  if (root === NOW_ROOT) return resolveNowPath(path);
  if (RESERVED_ROOTS.has(root)) return { kind: 'reserved' };

  const source = findEntity(model, origin);
  if (source === null) return { kind: 'error', reason: `${originLabel} ${origin} が未定義です` };

  if (path.segments.length === 1) {
    return hasField(model, origin, root)
      ? { kind: 'field', entity: source.entity, field: root }
      : { kind: 'error', reason: `${source.entity} にフィールド ${root} がありません` };
  }

  const field = path.segments[path.segments.length - 1];
  if (field === undefined) return { kind: 'error', reason: `${path.segments.join('.')} が読めません` };
  // 先頭が起点自身を指しているなら、それはホップではない(`{起点}.{field}` の完全形)。
  const selfPrefixed = root === source.entity || root === origin;
  const hops = path.segments.slice(selfPrefixed ? 1 : 0, -1);
  if (hops.length > MAX_CONTEXT_HOPS) return { kind: 'error', reason: TOO_DEEP_REASON };

  const walked = walkHops(model, source, hops, originLabel);
  if (walked.kind === 'error') return walked;
  const target = walked.entity;
  return hasField(model, target.entity, field)
    ? { kind: 'field', entity: target.entity, field }
    : { kind: 'error', reason: `${target.entity} にフィールド ${field} がありません` };
}

/**
 * エンティティ名(または集約ディレクトリ名)から entity_spec を引く。
 *
 * lib/semantics/domain-lookup.ts の findEntitySpec と同じ規則だが、そちらを import すると
 * model 層が query 層に依存してしまうため、ここでは同じ規則を最小の形で持つ。
 */
function findEntity(model: SpecModel, entity: string): EntitySpec | null {
  for (const [aggregate, specs] of model.aggregates) {
    const spec = specs.entity;
    if (spec === undefined) continue;
    if (spec.entity === entity || aggregate === entity) return spec;
  }
  return null;
}

/** そのエンティティにフィールドがあるか。 */
function hasField(model: SpecModel, entity: string, field: string): boolean {
  return findEntity(model, entity)?.fields.some((candidate) => candidate.name === field) ?? false;
}
