/**
 * RLS のポリシーの `using (…)` を組み立てる写像(束 ⑳-4a)。
 *
 * ⑳-1 の翻訳器(`guard-to-sql.ts` / `roles-to-sql.ts`)の**もう 1 つの呼び側**である
 * (1 つ目は RPC の本文 = `rpc-reach.ts`)。差し替えるのは 2 つだけで、残りは同じものを使う ——
 * 束縛(`binding`)の翻訳を 2 本書くと「2 段を辿れるのは片方だけ」の食い違いが静かに入る。
 *
 * | 差し替えるもの | RPC の本文 | RLS のポリシー |
 * |---|---|---|
 * | 実行者 id | 引数 `p_actor_id` | 設定の現在の実行者の式(`(select …)` で包む) |
 * | グローバルロールの根拠 | 配列 `p_actor_roles` / 実行者の行 | 補助関数 `public.is_{role}()`・未ログインは `to anon` |
 *
 * | `reads` の形 | `using (…)` |
 * |---|---|
 * | `scope: all` | ロールの根拠だけ |
 * | `scope: own` | 対象の行の列と実行者 id の比較(束縛がそう書いてある) |
 * | `scope: context(X)` | X まで参照を辿る EXISTS(束縛が X の列を見る) |
 * | `filters: {列: actor.欄}` | 列 = **実行者の行の欄**(security definer の補助関数 `public.actor_{欄}()` を `(select …)` で 1 回だけ評価) |
 * | `filters: {親.列: actor.欄}` | 親の列(参照の鎖をスカラー副問い合わせで辿る。`when` と同じ届き方) = 同上 |
 * | `when: {ガード式}` | **行の状態の条件**(`rls-when.ts` が同じ翻訳器で写す。束 §14) |
 *
 * `own` と `context` の述語が**どちらも束縛の翻訳から出る**のは、そのロールが立つ根拠が
 * そのまま「見えてよい行」の定義だからである。したがってスコープの宣言と束縛の指す集約が
 * 食い違っていたら写さない(T7 が先に落とす)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ReadFilter } from '../model/types.js';
import { valueKindOfFieldType } from '../model/field-values.js';
import { readFilterPath, resolveReadFilter } from '../model/read-filter-path.js';
import { findField } from '../semantics/domain-index.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import { totalPredicate } from './guard-to-sql.js';
import { rolesToSql } from './roles-to-sql.js';
import { bindingEntity } from './roles-binding.js';
import type { PolicyPlan } from '../world/index.js';
import { boundaryHelperName, needsBoundaryHelper } from '../world/index.js';
import type { PolicyPredicateInput, PolicyProblem } from './rls-context.js';
import { policyIdExpression, policyRoleBindings } from './rls-context.js';
import type { WhenSqlInput } from './rls-when.js';
import { readWhenSql, rowFieldSql } from './rls-when.js';

export type { PolicyPredicateInput, PolicyProblem } from './rls-context.js';

/** 述語の組み立ての結果。 */
export type PolicyPredicateResult =
  | { readonly ok: true; readonly sql: string }
  | { readonly ok: false; readonly problems: readonly PolicyProblem[] };

/**
 * ポリシー 1 本の `using (…)` の中身を組み立てる。
 *
 * @param plan そのポリシーの計画
 * @param input 対象の集約・表・ドメイン仕様・ロール定義
 * @returns 全域(NULL を返さない)な SQL 述語、または理由つきの失敗
 */
export function policyPredicate(plan: PolicyPlan, input: PolicyPredicateInput): PolicyPredicateResult {
  const disagreement = scopeDisagreement(plan, input);
  if (disagreement !== null) return { ok: false, problems: [disagreement] };
  const translated = rolesToSql([plan.by], input.roles, policyRoleBindings(input));
  if (!translated.ok) {
    return {
      ok: false,
      problems: [
        {
          message: `ポリシー ${plan.name} の根拠(ロール ${plan.by})を SQL に写せません`,
          suggestion:
            'スコープの宣言とロールの根拠(binding)が指す集約が一致しているか、その集約へ参照を辿れるかを確かめる' +
            '(scope: own は対象の集約そのもの、scope: context(X) は X を指す)',
          counterexample: {
            policy: plan.name,
            role: plan.by,
            unresolved: translated.unresolved.join(', '),
            rejected: translated.rejected.join(', '),
          },
        },
      ],
    };
  }
  const filters: string[] = [];
  const problems: PolicyProblem[] = [];
  for (const filter of plan.filters) {
    const sql = filterSql(filter, input);
    if (sql.ok) filters.push(sql.sql);
    else problems.push(unwritableFilter(plan, filter, input, sql.reason));
  }
  // 状態の条件(`reads[].when`)は境界と同じ論理積に入る。翻訳器が既に 2 値に閉じた述語を
  // 返すので、ここで畳み直さない(原子ごとに `coalesce` すると `not` の下で意味が変わる)。
  const when = plan.when === null ? null : readWhenSql(plan.when, whenInputOf(input));
  if (when !== null && !when.ok) problems.push(unwritableWhen(plan, plan.when ?? '', when.reason));
  if (problems.length > 0) return { ok: false, problems };
  const narrowed = [...filters, ...(when?.ok === true ? [when.sql] : [])];
  // 根拠の述語も翻訳器が 2 値に閉じている。狭める句を足したときだけ、式全体を 1 回畳む
  // (原子ごとに畳むと `not` の下で意味が変わる —— ⑳-1 と同じ規約)。
  return {
    ok: true,
    sql: narrowed.length === 0 ? translated.sql : totalPredicate([translated.sql, ...narrowed].join(' and ')),
  };
}

/** 状態の条件を写すのに要る文脈(束縛と同じ参照の鎖を渡す)。 */
function whenInputOf(input: PolicyPredicateInput): WhenSqlInput {
  return {
    entity: input.entity,
    rowAlias: input.table,
    domain: input.domain,
    idOf: (entity) => policyIdExpression(entity, input),
    tableOf: input.tableOf,
  };
}

/** 状態の条件を SQL に写せないときの指摘。 */
function unwritableWhen(plan: PolicyPlan, when: string, reason: string): PolicyProblem {
  return {
    message: `ポリシー ${plan.name} の状態の条件(when "${when}")を SQL に写せません`,
    suggestion:
      'when に書けるのは対象の行の欄と、context で辿れる親の欄だけである' +
      '(実行者の属性は filters に書く)。欄が実在し、比較の型が合っているかを確かめる',
    counterexample: { policy: plan.name, when, unwritable: reason },
  };
}

/**
 * スコープの宣言とロールの根拠の食い違い。
 *
 * ポリシーの述語は**ロールの根拠から出る**ので、宣言したスコープと根拠が別のことを言っていると
 * 生成される SQL は宣言と違う行集合になる。3 つの形を落とす。
 *
 * - 対象に依らず立つロール(`kind` / `claim`)に `own` / `context(…)` —— 述語は補助関数だけに
 *   なるので、**宣言より広い**(実質 `all`)ポリシーが黙って出る。**これが一番危ない形である。**
 * - 対象の行との関係で立つロール(`binding`)に `all` —— 述語が束縛で狭まるので、宣言より狭い。
 * - `context(X)` の X と束縛が指す集約が違う —— 別の相手を辿るので、広くも狭くもなりうる。
 *
 * `own` に束縛の集約は問わない —— 「自分のもの」は対象の行そのもの(`{自集約}.{列} == actor.id`)
 * でも、参照を 1 つ辿った先(「自分が発行した招待」)でも成り立つ言い方である。届かない集約を
 * 指していたら、翻訳器が「写せない」と報告する。
 *
 * @param plan そのポリシーの計画
 * @param input 対象の集約とロール定義
 * @returns 食い違いの指摘。無ければ `null`
 */
function scopeDisagreement(plan: PolicyPlan, input: PolicyPredicateInput): PolicyProblem | null {
  const role = input.roles.find((candidate) => candidate.id === plan.by);
  if (role === undefined) return null;
  const bound = role.binding === undefined ? null : bindingEntity(role.binding);
  const scope = plan.scope.kind === 'context' ? `context(${plan.scope.entity})` : plan.scope.kind;
  const disagrees =
    role.binding === undefined
      ? plan.scope.kind !== 'all'
      : plan.scope.kind === 'all' || (plan.scope.kind === 'context' && bound !== plan.scope.entity);
  if (!disagrees) return null;
  return {
    message: `ポリシー ${plan.name} のスコープ(${scope})がロール ${plan.by} の根拠と食い違います`,
    suggestion:
      '対象に依らず立つロール(kind / claim)のスコープは all である(own / context を書いても述語は' +
      '全件になり、宣言より広いポリシーが出る)。対象の行との関係で立つロール(binding)は own か' +
      'context(束縛が指す集約)のどちらかであり、all は書けない',
    counterexample: { policy: plan.name, role: plan.by, scope, bound_to: bound ?? '' },
  };
}

/** 境界を SQL に写せないときの指摘。 */
function unwritableFilter(
  plan: PolicyPlan,
  filter: ReadFilter,
  input: PolicyPredicateInput,
  reason: string,
): PolicyProblem {
  const left = readFilterPath(filter);
  return {
    message: `ポリシー ${plan.name} の境界(${left} = actor.${filter.actorField})を SQL に写せません(${reason})`,
    suggestion:
      `${input.entity} の列か、context で 2 段まで辿れる親の列があること、実行者の集約に ${filter.actorField} が` +
      'あり両辺の値の種別が同じことを確かめる(列の正は entity_spec)',
    counterexample: { policy: plan.name, field: left, actor_field: filter.actorField, unwritable: reason },
  };
}

/** 境界 1 本の翻訳の結果。 */
type FilterSqlResult = { readonly ok: true; readonly sql: string } | { readonly ok: false; readonly reason: string };

/**
 * 境界 1 本の述語(境界の列 = 実行者の行の欄)。
 *
 * 右辺は**実行者の行**から読む(JWT の写しは使わない。`lib/world/rls-boundary.ts`)。
 * `(select …)` で包むのは、補助関数(`stable`)を行ごとに呼ばずに初期計画として 1 回だけ評価させる
 * ためである(Supabase の RLS の作法。現在の実行者の式 `(select auth.uid())` と同じ手)。
 * `actor.id` は補助関数を経ず、文脈の実行者 id の式そのものと比べる。
 *
 * 両辺の値の種別が違えば写さない(V2 と二重に閉じる)—— cast で揃えると、別の値どうしを比べる。
 */
function filterSql(filter: ReadFilter, input: PolicyPredicateInput): FilterSqlResult {
  const resolution = resolveReadFilter(input.domain, input.entity, filter);
  if (!resolution.ok) return { ok: false, reason: resolution.problem };
  const { entity, field } = resolution.resolved;
  const column = rowFieldSql(entity, field.name, whenInputOf(input));
  if (column === null) return { ok: false, reason: 'unreachable' };
  if (!needsBoundaryHelper(filter.actorField)) {
    return { ok: true, sql: `${column} = ${policyRoleBindings(input).actorId}` };
  }
  const actor = actorEntity(input.domain);
  const actorField = actor === null ? null : findField(input.domain, actor, filter.actorField);
  if (actorField === null) return { ok: false, reason: 'unknown_actor_field' };
  if (valueKindOfFieldType(actorField.type) !== valueKindOfFieldType(field.type)) {
    return { ok: false, reason: 'kind_mismatch' };
  }
  return { ok: true, sql: `${column} = (select public.${boundaryHelperName(filter.actorField)}())` };
}
