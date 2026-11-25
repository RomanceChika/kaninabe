/**
 * 定型 RPC の本文に組み込む **`by`(ロール)とガードの述語**(束 ⑳-3)。
 *
 * ADR-0012 ⑤ の核心である —— ここまで(⑳-2)の本文は「誰が実行してもよい」ので、規則を守って
 * いたのは TS の engine だけだった。engine を通らない経路(複合 RPC の外・将来の別クライアント・
 * 管理スクリプト)からは、同じ RPC が素通しで書けてしまう。本文に述語を入れれば、**どの経路
 * からでも DB が規則を守る**。
 *
 * ## 述語は 3 本に分かれる
 *
 * engine が拒否を 3 つに分類する(`role_forbidden` / `invalid_from`(状態)/ `guard_unsatisfied`)
 * のと同じ粒度で、SQL 側も 3 本を別々に持つ。書き込みの `where` に入るのは 3 本の積だが、
 * **0 行になったときの「なぜ」を答えるには 1 本ずつ評価できなければならない**(`refusal-codes.ts`)。
 *
 * | 述語 | 何を見るか | engine の対応 |
 * |---|---|---|
 * | `role` | `by` のロールのどれかが実行者に立つか | `hasAllowedRole` / `rulesFor` |
 * | `state` | (遷移)宣言された `from` → `to` の組か | `firableFrom` |
 * | `guard` | ロールが立つ規則のガードが成立するか | `decideByGuard` / `evaluateGuard` |
 *
 * ## 規則の重ね方は engine の写し
 *
 * `creates` / `deletes` / `writes` は**規則ごとに**(ロール, ガード)の組であり、engine は
 * 「実行者のロールに一致する規則のどれか 1 本でもガードが成立すれば許可」と読む。したがって
 * SQL も `or` の和であり、**ロールとガードは規則の中で対になっていなければならない**(ロールの
 * 和とガードの和を別々に取ると、A の権限で B の条件を使う人が通る)。
 *
 * 遷移だけは形が違う。1 本の RPC が全イベントを受け持つので、**(イベント × 遷移元)で分岐**する `case` になる
 * (engine の `transitionsOf` → `firableFrom` → 先頭 1 本と同じ選び方)。作成の規則の縛りはロールの述語との積である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { EventDef, SpecModel, StateMachineSpec } from '../model/types.js';
import type { CreateRule, DeleteRule, WriteRule } from '../model/types.js';
import { parseGuard } from '../guard/parser.js';
import { guardToSql, sqlLiteral, totalPredicate } from './guard-to-sql.js';
import { rolesToSql } from './roles-to-sql.js';
import type { RpcSqlBindings } from './rpc-reach.js';

/**
 * 常に成立する述語(ガードを持たない規則)。
 *
 * **この字面を「述語を持たない」の合図として読む側がいる** —— 書き込みの `where` に積まない
 * (`authzConditions`)・0 行の分類でその段を作らない(`rpc-body-refusal.ts`)。判定の有無を
 * 2 か所で別々に決めないよう、語はここ 1 つに置く。
 */
export const ALWAYS = 'true';

/** 決して成立しない述語(規則が 1 本も無い)。 */
const NEVER = 'false';

/** 3 本の述語(どれも全域 = NULL を返さない)。 */
export interface AuthzPredicates {
  /** `by` のロールのどれかが立つか。 */
  readonly role: string;
  /** 宣言された状態の組か(遷移だけが持つ。それ以外は `true`)。 */
  readonly state: string;
  /** ロールが立つ規則のガードが成立するか(= 書き込んでよいか)。 */
  readonly guard: string;
}

/** 写せなかったもの(ガード式の翻訳器と同じ 2 本立て)。 */
export interface AuthzFailure {
  readonly unresolved: readonly string[];
  readonly rejected: readonly string[];
}

/** 組み立ての結果。 */
export type AuthzResult =
  | { readonly ok: true; readonly predicates: AuthzPredicates }
  | ({ readonly ok: false } & AuthzFailure);

/** 組み立ての途中で積む失敗。 */
interface Failures {
  readonly unresolved: string[];
  readonly rejected: string[];
}

/** ロールとガードの組を 1 本の規則として扱うための最小形。 */
interface RuleLike {
  readonly by: readonly string[];
  readonly when: string | undefined;
  /** 反例に載せる名前。 */
  readonly at: string;
  /** `by` の段に足す縛りの条件(実行者の参照の欄 = 実行者。engine の `self` と同じ位置。`rpc-actor-binding.ts`)。 */
  readonly bound?: string;
}

/**
 * 規則の並びから 2 本の述語を組み立てる(作成・削除・編集のひとかたまり)。
 *
 * **条件を 1 本も持たない規則の集まりでは、ガードの述語を `true` にする** —— ロールの述語と
 * 同じ字面をもう一度書くことになり、読む人にとって意味の無い行が増えるだけだからである
 * (許可は「ロール ∧ ガード」なので、ガードが恒真なら積はロールそのもの)。
 */
function fromRules(
  rules: readonly RuleLike[],
  domain: SpecModel,
  bindings: RpcSqlBindings,
  failures: Failures,
): { readonly role: string; readonly guard: string } {
  if (rules.length === 0) return { role: NEVER, guard: NEVER };
  const roleTerms: string[] = [];
  const guardTerms: string[] = [];
  let guarded = false;
  for (const rule of rules) {
    const bare = roleSql(rule, domain, bindings, failures);
    const role = rule.bound === undefined ? bare : `(${bare} and ${rule.bound})`;
    const guard = guardSql(rule, bindings, failures);
    if (guard !== ALWAYS) guarded = true;
    roleTerms.push(role);
    guardTerms.push(guard === ALWAYS ? role : `(${role} and ${guard})`);
  }
  return { role: orOf(roleTerms), guard: guarded ? orOf(guardTerms) : ALWAYS };
}

/** 述語の和(1 本なら括弧を足さない)。 */
function orOf(terms: readonly string[]): string {
  if (terms.length === 0) return NEVER;
  return terms.length === 1 ? (terms[0] ?? NEVER) : `(${terms.join('\n           or ')})`;
}

/** 述語の積(1 本なら括弧を足さない)。 */
function andOf(terms: readonly string[]): string {
  if (terms.length === 0) return ALWAYS;
  return terms.length === 1 ? (terms[0] ?? ALWAYS) : `(${terms.join('\n          and ')})`;
}

/** 規則 1 本の `by` を述語にする。 */
function roleSql(rule: RuleLike, domain: SpecModel, bindings: RpcSqlBindings, failures: Failures): string {
  const translated = rolesToSql(rule.by, domain.roles.roles, bindings.role);
  if (translated.ok) return translated.sql;
  failures.unresolved.push(...translated.unresolved.map((at) => `${rule.at}:${at}`));
  failures.rejected.push(...translated.rejected.map((at) => `${rule.at}:${at}`));
  return NEVER;
}

/** 規則 1 本の条件式を述語にする(条件が無ければ常に成立)。 */
function guardSql(rule: RuleLike, bindings: RpcSqlBindings, failures: Failures): string {
  const source = rule.when;
  if (source === undefined) return ALWAYS;
  const parsed = parseGuard(source);
  if (!parsed.ok) {
    failures.unresolved.push(`${rule.at}:guard`);
    return NEVER;
  }
  const translated = guardToSql(parsed.expr, bindings.guard);
  if (translated.ok) return translated.sql;
  failures.unresolved.push(...translated.unresolved.map((at) => `${rule.at}:${at}`));
  failures.rejected.push(...translated.rejected.map((at) => `${rule.at}:${at}`));
  return NEVER;
}

/** 失敗を結果に畳む。 */
function resultOf(predicates: AuthzPredicates, failures: Failures): AuthzResult {
  if (failures.unresolved.length > 0 || failures.rejected.length > 0) {
    return { ok: false, unresolved: failures.unresolved, rejected: failures.rejected };
  }
  return { ok: true, predicates };
}

/** 作成の述語(`creates` の規則の和。`bound` は規則ごとに `by` の段へ足す縛り。null は縛り無し)。 */
export function createAuthz(
  rules: readonly CreateRule[],
  domain: SpecModel,
  bindings: RpcSqlBindings,
  bound: readonly (string | null)[] = [],
): AuthzResult {
  const failures: Failures = { unresolved: [], rejected: [] };
  const built = fromRules(
    rules.map((rule, index) => ({ by: [rule.by], when: rule.when, at: `creates:${rule.by}`, ...(typeof bound[index] === 'string' ? { bound: bound[index] } : {}) })),
    domain,
    bindings,
    failures,
  );
  return resultOf({ role: built.role, state: ALWAYS, guard: built.guard }, failures);
}

/** 削除の述語(`deletes` の規則の和)。 */
export function deleteAuthz(
  rules: readonly DeleteRule[],
  domain: SpecModel,
  bindings: RpcSqlBindings,
): AuthzResult {
  const failures: Failures = { unresolved: [], rejected: [] };
  const built = fromRules(
    rules.map((rule) => ({ by: [rule.by], when: rule.when, at: `deletes:${rule.by}` })),
    domain,
    bindings,
    failures,
  );
  return resultOf({ role: built.role, state: ALWAYS, guard: built.guard }, failures);
}

/**
 * 編集の述語(**変更される欄ごと**に照会する)。
 *
 * engine は `p_changes` に載った欄 1 つずつ `canWrite` を回し、1 つでも許されなければ全体を
 * 拒否する。SQL でも同じ形にする —— 「その欄が送られてきたなら、その欄の規則が許すこと」の積
 * である(送られていない欄の規則は見ない)。
 *
 * @param rules access_spec の `writes`
 * @param columns この RPC が書き換えてよい列(`rpc-facts` の `writeColumns`)
 * @param changes 変更集合の引数名(`p_changes`)
 * @param domain ドメイン仕様
 * @param bindings 届き方の解決器
 * @returns 3 本の述語、または写せなかったものの名前
 */
export function updateAuthz(
  rules: readonly WriteRule[],
  columns: readonly string[],
  changes: string,
  domain: SpecModel,
  bindings: RpcSqlBindings,
): AuthzResult {
  const failures: Failures = { unresolved: [], rejected: [] };
  const roleTerms: string[] = [];
  const guardTerms: string[] = [];
  for (const column of columns) {
    const covering = rules.filter((rule) => rule.fields.includes(column));
    const built = fromRules(
      covering.map((rule) => ({ by: [rule.by], when: rule.when, at: `writes:${rule.by}:${column}` })),
      domain,
      bindings,
      failures,
    );
    const sent = `${changes} ? ${sqlLiteral(column)}`;
    roleTerms.push(`(not (${sent}) or ${built.role})`);
    if (built.guard !== ALWAYS) guardTerms.push(`(not (${sent}) or ${built.guard})`);
  }
  return resultOf({ role: andOf(roleTerms), state: ALWAYS, guard: andOf(guardTerms) }, failures);
}

/** 遷移 1 本を選ぶ鍵(イベント ID と遷移元の状態)。 */
interface TransitionKey {
  readonly event: string;
  readonly from: string;
}

/**
 * 遷移の述語(**イベント × 遷移元**で分岐する `case`)。
 *
 * engine の選び方(`transitionsOf` → `firableFrom` → 先頭 1 本)をそのまま写す —— 同じ
 * (イベント, 遷移元)に 2 本ある表は非決定的であり、それは V8 が止める仕様の誤りである。
 *
 * `state` の述語だけは**遷移先**まで見る。呼び側は「宣言された `to`」を渡す契約なので、
 * 違う値が来たらそれは宣言に無い遷移であり、状態違いとして落とすのが正しい。
 *
 * @param machine 状態機械
 * @param domain ドメイン仕様
 * @param bindings 届き方の解決器
 * @param params 分岐に使う引数名(イベント ID・遷移元・遷移先)
 * @returns 3 本の述語、または写せなかったものの名前
 */
export function transitionAuthz(
  machine: StateMachineSpec,
  domain: SpecModel,
  bindings: RpcSqlBindings,
  params: { readonly event: string; readonly from: string; readonly to: string },
): AuthzResult {
  const failures: Failures = { unresolved: [], rejected: [] };
  const chosen = new Map<string, { key: TransitionKey; event: EventDef }>();
  for (const event of machine.events) {
    for (const from of event.from) {
      const key = `${event.id}\u0000${from}`;
      if (chosen.has(key)) continue;
      chosen.set(key, { key: { event: event.id, from }, event });
    }
  }
  const stateArms: string[] = [];
  const roleArms: string[] = [];
  const guardArms: string[] = [];
  let guarded = false;
  for (const { key, event } of chosen.values()) {
    if (event.guard !== undefined) guarded = true;
    const eventId = `${machine.machine}.${key.event}`;
    const match =
      `${params.event} = ${sqlLiteral(eventId)} and ${params.from} = ${sqlLiteral(key.from)}`;
    stateArms.push(`when ${match} and ${params.to} = ${sqlLiteral(event.to)} then true`);
    const rule: RuleLike = { by: event.by, when: event.guard, at: `${eventId}:${key.from}` };
    roleArms.push(`when ${match} then ${roleSql(rule, domain, bindings, failures)}`);
    guardArms.push(`when ${match} then ${guardSql(rule, bindings, failures)}`);
  }
  return resultOf(
    {
      role: caseOf(roleArms),
      state: caseOf(stateArms),
      guard: guarded ? caseOf(guardArms) : ALWAYS,
    },
    failures,
  );
}

/** `case when … then … else false end`(腕が 1 本も無ければ `false`)。 */
function caseOf(arms: readonly string[]): string {
  if (arms.length === 0) return NEVER;
  return totalPredicate(`case\n            ${arms.join('\n            ')}\n            else false\n        end`);
}
