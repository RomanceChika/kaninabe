/**
 * 定型 RPC の本文の中で、**パス 1 本を SQL の式に届かせる**写像(束 ⑳-3)。
 *
 * ⑳-1 の翻訳器(`guard-to-sql.ts` / `roles-to-sql.ts`)は「列参照は呼び側が与える」という
 * 構えで書かれている —— どの表のどの別名に落ちるかは呼ぶ文脈ごとに違うからである。
 * ここがその**呼び側の 1 つ**(RPC の本文)であり、次の 3 種の届き方を持つ。
 *
 * | パス | 届き方 |
 * |---|---|
 * | 自集約の欄(`state` / `{自集約}.{欄}`) | 対象の行の列(作成では insert に書く式) |
 * | 他集約の欄(`{集約}.{欄}`) | **参照の鎖をスカラー副問い合わせで辿る** |
 * | 実行者の欄(`actor.id` / `actor.{欄}`) | 引数、または実行者自身の行を引く副問い合わせ |
 *
 * **なぜ join ではなく副問い合わせなのか。** 辿った先の行が無いとき、join は行そのものを消す
 * (= その条件が「不明」ではなく「対象が無い」になる)。TS の評価器は読めなかった事実を
 * `null` として env に置き、`unknown → 不成立` に畳む —— 同じ意味になるのはスカラー副問い合わせ
 * (行が無ければ NULL)の方である。既存の `p_expected_{集約}_{列}` の鎖(`rpc-parts.ts` の
 * `buildGuardRows`)が join なのは、あれが**楽観的並行制御の条件**であって事実の読み取りでは
 * ないためで、意味が違うものを 1 つの形に寄せない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PathRef } from '../guard/ast.js';
import type { SpecModel } from '../model/types.js';
import type { ValueKind } from '../model/field-values.js';
import { valueKindOfFieldType } from '../model/field-values.js';
import { pathKey } from '../guard/atoms.js';
import { findField } from '../semantics/domain-index.js';
import { refColumn, refPathTo } from '../model/ref-path.js';
import { actorEntity, entityOf } from '../usecase/param-source-facts.js';
import type { EntityReach, RoleSqlBindings } from './roles-to-sql.js';
import { authenticatedDefaultSql } from './rpc-reach-login.js';
import type { GuardSqlBindings } from './guard-to-sql.js';
import { CLOCK_VAR } from './rpc-parts.js';

/** 実行者を指す予約語のルート。 */
const ACTOR_ROOT = 'actor';

/** 実行者の同一性を指す 1 語(行を読まずに引数で埋まる)。 */
const ACTOR_ID_FIELD = 'id';

/** 実行者 id の引数名。 */
export const ACTOR_ID_PARAM = 'p_actor_id';

/** 実行者のグローバルロール配列の引数名(束 ⑳-3 で足した 1 本)。 */
export const ACTOR_ROLES_PARAM = 'p_actor_roles';

/** 辿った先の行に付ける別名の前置(深さごとに採番する)。 */
const REACH_ALIAS_PREFIX = 'r';

/** ロールの束縛が辿った先の行に付ける別名。 */
const ROLE_ALIAS = 'b';

/** 全テーブルが持つ主キー列(表の規約)。 */
const KEY_COLUMN = 'id';

/** 届き方の解決に要る入力。 */
export interface ReachInput {
  /** 自集約(エンティティ名)。 */
  readonly entity: string;
  readonly domain: SpecModel;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
  /**
   * 自集約の 1 欄の SQL の式。
   *
   * 編集・削除・遷移は対象の行の列(`t.{欄}`)、作成は insert に書く式(引数や `p_values`)である。
   * 決まらなければ `null`(翻訳器が「呼び側の写像が足りない」として返す)。
   */
  readonly ownColumn: (field: string) => string | null;
  /**
   * 自集約が他の集約を指す列の**値の出どころ**(列名 → SQL の式)。
   * `rpc-facts.ts` の `ownRefs` と同じもの。
   */
  readonly ownRefs: ReadonlyMap<string, string>;
}

/** 解決器の一式(ガード式用とロール用)。 */
export interface RpcSqlBindings {
  readonly guard: GuardSqlBindings;
  readonly role: RoleSqlBindings;
}

/**
 * RPC の本文の文脈での解決器を作る。
 *
 * @param input 自集約・ドメイン仕様・自分の列と参照の出どころ
 * @returns ガード式とロールの翻訳器に渡す解決器
 */
export function createRpcBindings(input: ReachInput): RpcSqlBindings {
  const guard: GuardSqlBindings = {
    now: CLOCK_VAR,
    column: (path) => columnSql(path, input),
    valueKind: (path) => valueKindOf(path, input),
    // 配列の列に実行者が入っているか。集合側の列に届けばそのまま写せる。
    contains: (path, ref) => containsSql(path, ref, input),
  };
  return {
    guard,
    role: {
      actorId: ACTOR_ID_PARAM,
      actorRoles: ACTOR_ROLES_PARAM,
      reach: (entity) => reachOf(entity, input),
      globalRole: (role) =>
        authenticatedDefaultSql(role, input.domain, input.tableOf, {
          actorId: ACTOR_ID_PARAM,
          actorRoles: ACTOR_ROLES_PARAM,
        }),
      actorRow: (entity) => {
        const table = input.tableOf(entity);
        return table === null ? null : { table: `public.${table}` };
      },
      valueKind: (path) => valueKindOf(path, input),
    },
  };
}

/** パスが指す集約と欄(`state` のような 1 語は自集約の欄)。 */
function splitPath(path: PathRef, input: ReachInput): { entity: string; field: string } | null {
  const segments = path.segments;
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

/** パス 1 本の SQL の式(届かなければ null)。 */
function columnSql(path: PathRef, input: ReachInput): string | null {
  if (path.segments[0] === ACTOR_ROOT) return actorSql(path, input);
  const split = splitPath(path, input);
  if (split === null) return null;
  if (split.entity === input.entity) return input.ownColumn(split.field);
  return externalSql(split.entity, split.field, input);
}

/**
 * 実行者を指すパス。
 *
 * `actor.id` は引数そのもの。それ以外は**実行者自身の行**を引く —— app 側の先読みは
 * セッション(`app_metadata.profile`)から読むが、DB を権威にする以上、DB は自分の行を見る
 * (セッションが古ければ先読みだけが外れ、DB が正しく落とす)。
 */
function actorSql(path: PathRef, input: ReachInput): string | null {
  const field = path.segments[1];
  if (path.segments.length === 1) return null;
  if (field === undefined || path.segments.length !== 2) return null;
  if (field === ACTOR_ID_FIELD) return ACTOR_ID_PARAM;
  const entity = actorEntity(input.domain);
  const table = entity === null ? null : input.tableOf(entity);
  if (entity === null || table === null || findField(input.domain, entity, field) === null) return null;
  const alias = `${REACH_ALIAS_PREFIX}${ACTOR_ROOT}`;
  return `(select ${alias}.${field} from public.${table} ${alias} where ${alias}.${KEY_COLUMN} = ${ACTOR_ID_PARAM})`;
}

/** 他集約の 1 欄(参照の鎖をスカラー副問い合わせで辿る)。 */
function externalSql(entity: string, field: string, input: ReachInput): string | null {
  const table = input.tableOf(entity);
  const id = idExpression(entity, input);
  if (table === null || id === null || findField(input.domain, entity, field) === null) return null;
  const alias = aliasFor(entity, input);
  return `(select ${alias}.${field} from public.${table} ${alias} where ${alias}.${KEY_COLUMN} = ${id})`;
}

/** その集約の行に付ける別名(鎖の深さで採番する。入れ子の中で衝突しない)。 */
function aliasFor(entity: string, input: ReachInput): string {
  const path = pathTo(entity, input);
  return `${REACH_ALIAS_PREFIX}${path === null ? 0 : path.length}`;
}

/**
 * その集約の行の id を与える式(参照の鎖を 1 段ずつ入れ子にする)。
 *
 * 根は自集約が直に指す参照列(`ownRefs`)であり、そこから `ref(...)` の辺を辿る。
 * 辿れなければ null —— 黙って別の行を指すより、写せないと報告する。
 * **ガードが読む行を掴む側(`rpc-guard-locks.ts`)も同じ鎖を使う** —— 読む先と掴む先が
 * ずれたら、掴んでいない行の状態でガードを判定することになる。
 *
 * @param entity 辿り着きたい集約
 * @param input 自集約・ドメイン仕様・表名の引き当て・参照の出どころ
 * @returns id を与える SQL の式。辿れなければ null
 */
export function idExpression(entity: string, input: ReachInput): string | null {
  const path = pathTo(entity, input);
  if (path === null) return null;
  let current: string | null = rootExpression(path[0] ?? '', input);
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1] ?? '';
    const to = path[index] ?? '';
    const column = refColumn(input.domain, from, to);
    const table = input.tableOf(from);
    if (current === null || column === null || table === null) return null;
    const alias = `${REACH_ALIAS_PREFIX}${index}`;
    current = `(select ${alias}.${column} from public.${table} ${alias} where ${alias}.${KEY_COLUMN} = ${current})`;
  }
  return current;
}

/**
 * 自集約から直に指す参照列の値(根)。
 *
 * どの列で辿るかは `context:` の宣言が決める(`refColumn`)—— 同じ相手を指す参照欄が 2 本ある形で
 * 「値の出どころが分かっている方」を勝手に選ぶと、道の探索(`refPathTo`)と根が食い違う。
 */
function rootExpression(entity: string, input: ReachInput): string | null {
  const column = refColumn(input.domain, input.entity, entity);
  return column === null ? null : (input.ownRefs.get(column) ?? null);
}

/** 自集約が直に指す参照のうち、値の出どころが分かっている列だけを道の根にする。 */
function pathTo(target: string, input: ReachInput): readonly string[] | null {
  return refPathTo(input.domain, input.entity, target, (field) => input.ownRefs.has(field.name));
}

/** パスが指す欄の値の種別(entity_spec の型からの写像)。 */
function valueKindOf(path: PathRef, input: ReachInput): ValueKind | null {
  if (path.segments[0] === ACTOR_ROOT) {
    if (pathKey(path) === `${ACTOR_ROOT}.${ACTOR_ID_FIELD}`) return 'opaque';
    const entity = actorEntity(input.domain);
    const field = entity === null ? null : findField(input.domain, entity, path.segments[1] ?? '');
    return field === null ? null : valueKindOfFieldType(field.type);
  }
  const split = splitPath(path, input);
  const field = split === null ? null : findField(input.domain, split.entity, split.field);
  return field === null ? null : valueKindOfFieldType(field.type);
}

/** `{集約}.{配列の列} contains actor.id`(集合側の列に届けば写せる)。 */
function containsSql(path: PathRef, ref: PathRef, input: ReachInput): string | null {
  if (pathKey(ref) !== `${ACTOR_ROOT}.${ACTOR_ID_FIELD}`) return null;
  const column = columnSql(path, input);
  return column === null ? null : `${ACTOR_ID_PARAM} = any(${column})`;
}

/**
 * ロールの束縛(`binding`)が指す集約への届き方。
 *
 * 自集約は対象の行そのもの、他集約は「鎖で求めた id と結ぶ 1 段」に畳む —— `EntityReach` は
 * 表と別名と結合条件の 3 つしか運ばないが、**結合条件の側に鎖を入れれば 2 段以上も 1 段で書ける**。
 */
function reachOf(entity: string, input: ReachInput): EntityReach | null {
  if (entity === input.entity) {
    const row = input.ownColumn(KEY_COLUMN);
    // 作成では対象の行がまだ無いので、自集約への束縛は写せない(仕様にも現れない)。
    return row === `${OWN_ALIAS}.${KEY_COLUMN}` ? { kind: 'row', alias: OWN_ALIAS } : null;
  }
  const table = input.tableOf(entity);
  const id = idExpression(entity, input);
  if (table === null || id === null) return null;
  return {
    kind: 'join',
    table: `public.${table}`,
    alias: ROLE_ALIAS,
    on: `${ROLE_ALIAS}.${KEY_COLUMN} = ${id}`,
  };
}

/** 書き込む対象の行に付ける別名(本文の中で固定。`rpc-parts.ts` と同じ字面)。 */
const OWN_ALIAS = 't';
