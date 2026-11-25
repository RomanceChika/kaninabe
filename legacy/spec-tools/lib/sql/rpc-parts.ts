/**
 * 定型 RPC の本文の**共通の断片**(値の取り出し・ガードの鎖・監査ログ・副作用の積み方)。
 *
 * 5 形のどれもがこの 4 つを同じ形で持つ。形ごとの骨格は `rpc-body.ts` が、断片はここが持つ。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findEntityFields } from '../semantics/domain-index.js';
import { sqlLiteral } from './guard-to-sql.js';
import { columnExpression, JSON_TEXT_TYPE } from './sql-types.js';
import type { RpcBodyProblem, RpcParam } from './rpc-params.js';

/** 書き込む対象の行に付ける別名(本文の中で固定)。 */
export const TARGET_ALIAS = 't';

/**
 * 本文が**行ロックの後に 1 度だけ**取る時刻の変数(`clock_timestamp()`)。
 *
 * 時刻のガード(予約語 `now`)と `records_time` の書き込みはこの 1 つを使う。`now()` は
 * トランザクションの開始時刻なので、行ロックの待ちが締切をまたぐと「期限切れの後に通る」。
 */
export const CLOCK_VAR = 'v_now';

/** ガードのために引き当てる他の集約の行に付ける別名の前置(`g0` / `g1` …)。 */
const GUARD_ALIAS_PREFIX = 'g';

/** 監査ログの表(内部テーブル。data_table では internal: true)。 */
export const AUDIT_TABLE = 'domain_events';

/** 副作用(outbox)の表。 */
export const JOB_TABLE = 'jobs';

/**
 * jsonb から 1 欄を取り出す式(型どおりに cast する)。
 *
 * @param root 取り出し元(`p_values` / `p_changes`)
 * @param field その欄
 * @returns SQL の式
 */
export function jsonField(root: string, field: FieldDef): string {
  return columnExpression(`${root} ->> ${sqlLiteral(field.name)}`, JSON_TEXT_TYPE, field.type);
}

/**
 * 編集の本文が列に入れる値(変更集合に鍵があればその値、無ければ `fallback`)。本文の代入(`rpc-body-shapes.ts` の `updateBlock`)と、
 * 書き換えた参照の欄が指す親を先に掴む文(`rpc-closure-locks.ts`)が同じ字面を使う(掴む順の見張りが 2 つを同じ値と読む。fix25s)。
 *
 * @param field 列の欄
 * @param fallback 鍵が無いときの値の式
 * @returns 値の式
 */
export function changedValue(field: FieldDef, fallback: string): string {
  return `case when p_changes ? ${sqlLiteral(field.name)} then ${jsonField('p_changes', field)} else ${fallback} end`;
}

/**
 * 作成のときに 1 列へ入れる式(列の既定値が宣言されていれば `coalesce` で受ける)。
 *
 * jsonb は「鍵が無い」と「値が空」を区別しないので、`->>` は鍵が無ければ空を返す。
 * NOT NULL の列に既定値がある(= data_table の `defaults` が宣言している)なら、その既定値へ
 * 倒すのが列の宣言どおりの振る舞いである。
 *
 * @param root 取り出し元
 * @param field その欄
 * @param defaults 列の既定値(data_table の `defaults`)
 * @returns SQL の式
 */
export function insertValue(root: string, field: FieldDef, defaults: Readonly<Record<string, string>>): string {
  const expression = jsonField(root, field);
  const fallback = defaults[field.name];
  return fallback === undefined ? expression : `coalesce(${expression}, ${fallback})`;
}

/** ガードのために引き当てる 1 集約(別名・表・条件)。 */
export interface GuardRow {
  readonly alias: string;
  readonly table: string;
  /** その行を 1 行に定める条件(`{別名}.id = …`)。 */
  readonly anchors: readonly string[];
  /** 根の錨にした自分の側の参照列(この行の id はその列の値。掴んだ行の照合 `rpc-fk-check-order.ts` が読む)。 */
  readonly ownColumns: readonly string[];
  /** 状態の条件(ガードされている集約だけが持つ)。 */
  readonly state: string | null;
}

/** ガードの組み立ての結果。 */
export type GuardResult =
  | { readonly ok: true; readonly rows: readonly GuardRow[] }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] };

/** ガードの組み立てに要る文脈。 */
export interface GuardContext {
  readonly fn: string;
  readonly entity: string;
  readonly domain: SpecModel;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
  /**
   * 自分の側から他の集約を指す列の**値の出どころ**(列名 → SQL の式)。
   * 作成は引数(`p_{列名}`)、編集・削除・遷移は対象の行(`{対象の別名}.{列名}`)である。
   */
  readonly ownRefs: ReadonlyMap<string, string>;
}

/**
 * `p_expected_{集約}_{列}` が要求するガードを、**参照の鎖**として組み立てる。
 *
 * 自分の側が持つ参照列を根に、`ref(...)` の辺をたどって条件にすべき集約まで届かせる。
 * 根に無い集約(作成の時点では値が無い列の先)は、途中の集約を経由して辿る ——
 * 子の集約が持つ祖父への参照列が `supplied_by: db` のときは、親の集約を 1 段挟まないと
 * 届かない(その列の値は DB が決めるので、作成の引数には現れない)。
 *
 * @param guards 条件にする集約と状態列(引数の宣言順)
 * @param ctx 自集約・参照の根・テーブル名の引き当て
 * @returns 引き当てる行の並び(FROM に並べる順)、または理由つきの失敗
 */
export function buildGuardRows(
  guards: readonly { readonly entity: string; readonly column: string; readonly param: string }[],
  ctx: GuardContext,
): GuardResult {
  if (guards.length === 0) return { ok: true, rows: [] };
  const roots = rootAnchors(ctx);
  const problems: RpcBodyProblem[] = [];
  const included: string[] = [];
  for (const guard of guards) {
    const path = pathTo(guard.entity, roots, ctx);
    if (path === null) {
      problems.push({
        message: `${ctx.fn} の引数 ${guard.param} が条件にする ${guard.entity} まで参照が辿れません`,
        suggestion:
          `${ctx.entity} から ${guard.entity} へ届く ref(...) の列を entity_spec に持たせるか、` +
          'その列の値を受け取る引数を RPC に足す(辿れない条件は本文に書けない)',
        counterexample: { function: ctx.fn, param: guard.param, from: ctx.entity, to: guard.entity },
      });
      continue;
    }
    for (const entity of path) if (!included.includes(entity)) included.push(entity);
  }
  if (problems.length > 0) return { ok: false, problems };
  const rows = rowsOf(included, guards, roots, ctx, problems);
  return rows === null ? { ok: false, problems } : { ok: true, rows };
}

/** 自分の側の参照列から直に届く集約(集約名 → その id を与える式の並び)。 */
function rootAnchors(ctx: GuardContext): ReadonlyMap<string, readonly string[]> {
  const roots = new Map<string, string[]>();
  for (const field of findEntityFields(ctx.domain, ctx.entity) ?? []) {
    if (field.type.kind !== 'ref') continue;
    const expression = ctx.ownRefs.get(field.name);
    if (expression === undefined) continue;
    roots.set(field.type.entity, [...(roots.get(field.type.entity) ?? []), expression]);
  }
  return roots;
}

/** 根から目的の集約まで辿る道(通る集約を順に並べたもの)。届かなければ null。 */
function pathTo(
  target: string,
  roots: ReadonlyMap<string, readonly string[]>,
  ctx: GuardContext,
): readonly string[] | null {
  if (roots.has(target)) return [target];
  const previous = new Map<string, string>();
  const queue = [...roots.keys()];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const field of findEntityFields(ctx.domain, current) ?? []) {
      if (field.type.kind !== 'ref' || seen.has(field.type.entity)) continue;
      previous.set(field.type.entity, current);
      if (field.type.entity === target) return backtrack(target, previous);
      seen.add(field.type.entity);
      queue.push(field.type.entity);
    }
  }
  return null;
}

/** 直前の集約の表を辿って道に直す(根から目的地の順)。 */
function backtrack(target: string, previous: ReadonlyMap<string, string>): readonly string[] {
  const path = [target];
  let current = previous.get(target);
  while (current !== undefined) {
    path.unshift(current);
    current = previous.get(current);
  }
  return path;
}

/** 引き当てる行を組み立てる(別名の採番と条件の収集)。 */
function rowsOf(
  included: readonly string[],
  guards: readonly { readonly entity: string; readonly column: string; readonly param: string }[],
  roots: ReadonlyMap<string, readonly string[]>,
  ctx: GuardContext,
  problems: RpcBodyProblem[],
): readonly GuardRow[] | null {
  const aliases = new Map(included.map((entity, index) => [entity, `${GUARD_ALIAS_PREFIX}${index}`]));
  const rows: GuardRow[] = [];
  for (const entity of included) {
    const alias = aliases.get(entity) ?? GUARD_ALIAS_PREFIX;
    const table = ctx.tableOf(entity);
    if (table === null) {
      problems.push({
        message: `${ctx.fn} が条件にする ${entity} に対応する data_table がありません`,
        suggestion: `${entity} の data_table を書く(条件にする集約の表名は宣言からしか引けない)`,
        counterexample: { function: ctx.fn, entity },
      });
      continue;
    }
    const guard = guards.find((candidate) => candidate.entity === entity);
    rows.push({
      alias,
      table,
      anchors: anchorsOf(entity, alias, included, aliases, roots, ctx),
      ownColumns: (findEntityFields(ctx.domain, ctx.entity) ?? []).filter((own) => own.type.kind === 'ref' && own.type.entity === entity && ctx.ownRefs.has(own.name)).map((own) => own.name),
      state: guard === undefined ? null : `${alias}.${guard.column} = ${guard.param}`,
    });
  }
  return problems.length > 0 ? null : rows;
}

/** その集約の行を 1 行に定める条件(根からの直参照と、引き当て済みの行からの参照の全部)。 */
function anchorsOf(
  entity: string,
  alias: string,
  included: readonly string[],
  aliases: ReadonlyMap<string, string>,
  roots: ReadonlyMap<string, readonly string[]>,
  ctx: GuardContext,
): readonly string[] {
  const anchors = (roots.get(entity) ?? []).map((expression) => `${alias}.id = ${expression}`);
  for (const other of included) {
    if (other === entity) continue;
    const otherAlias = aliases.get(other);
    if (otherAlias === undefined) continue;
    for (const field of findEntityFields(ctx.domain, other) ?? []) {
      if (field.type.kind !== 'ref' || field.type.entity !== entity) continue;
      anchors.push(`${alias}.id = ${otherAlias}.${field.name}`);
    }
  }
  return anchors;
}

/**
 * 監査ログに載せる値(`personal: true` の欄は値を落として列名だけ `redacted` に残す)。
 *
 * @param root 元の jsonb(`p_values` / `p_changes`)
 * @param personal その jsonb に現れうる `personal: true` の欄
 * @returns SQL の式
 */
export function redactedPayload(root: string, personal: readonly string[]): string {
  if (personal.length === 0) return root;
  const list = `array[${personal.map(sqlLiteral).join(', ')}]::text[]`;
  return [
    `(${root} - ${list})`,
    `            || jsonb_build_object('redacted', (`,
    `                select coalesce(jsonb_agg(k), '[]'::jsonb)`,
    `                from unnest(${list}) as k`,
    `                where ${root} ? k`,
    '            ))',
  ].join('\n');
}

/**
 * 副作用(outbox)を積むループ。
 *
 * 遷移も編集も同じ形である —— 渡された効果 ID を 1 件ずつジョブにし、冪等キーをその場で作る。
 *
 * @param entity 自集約(ジョブの payload が持つ鍵)
 * @param idExpression その行の id を与える式
 * @param indent 行頭の字下げ
 * @returns plpgsql の断片
 */
export function effectsLoop(entity: string, idExpression: string, indent: string): string {
  return [
    `${indent}foreach v_effect in array coalesce(p_effects, array[]::text[]) loop`,
    `${indent}    v_job_id := gen_random_uuid();`,
    `${indent}    insert into public.${JOB_TABLE} (id, type, payload, idempotency_key)`,
    `${indent}    values (`,
    `${indent}        v_job_id,`,
    `${indent}        v_effect,`,
    `${indent}        jsonb_build_object(${sqlLiteral(`${entity}_id`)}, ${idExpression}),`,
    `${indent}        v_effect || ':' || v_job_id::text`,
    `${indent}    );`,
    `${indent}end loop;`,
  ].join('\n');
}

/** 引数の並びから、役目で 1 本を引く。 */
export function paramOf(params: readonly RpcParam[], kind: RpcParam['role']['kind']): RpcParam | null {
  return params.find((param) => param.role.kind === kind) ?? null;
}
