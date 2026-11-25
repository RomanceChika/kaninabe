/**
 * 「この式は、指定した集約の状態 `state` の実体を弾かないか」を記号評価する共通モジュール。
 *
 * S13(状態×ロールの到達)の precondition・S14(状態の可視性)の query_spec `filters`・
 * S15(遷移後の着地)の着地画面の precondition が、同じ問い(「この状態を弾くか」)を
 * 別々の仕様種の式に対して立てる。判定の中身(充足性判定)を 3 回書くと、
 * 1 つを直したときに残り 2 つが古いままになる事故が起きるため、ここへ 1 箇所に集める。
 *
 * **記号評価の限界**: 式が対象の状態フィールドを 1 つも参照していなければ無条件で admit する
 * (「状態以外のパスは不明 = admit」)。参照するパスが見つかったときだけ、その式と
 * `{パス} == {state}` の共存判定(V8 の決定性チェック・U 群の状態ごとの絞り込みと同じ
 * 充足性判定の再利用)に委ねる。これは「その式が state を厳密に排他しているとまで言えるか」
 * だけを問う保守的な判定であり、判定できない(unknown)場合も admit 側に倒す
 * (見逃しより過検出を避ける ── 誤って画面を「到達できない」と指摘する方が実害が大きい)。
 *
 * **置き場は事実の層**: 式とドメインの状態の軸だけを読む判定で(画面の宣言は `preconditionExpr` が型として読むだけ)、
 * 画面・query_spec の検査と、画面の到達の判定(関係の層 `lib/relations/screen-reachability/`)が同じ答えを読む。
 * 以前は `lib/screen/state-admit.ts` にいた。
 */

import type { DomainEnv, GuardExpr, GuardServices, PathRef } from '../guard/ast.js';
import type { SpecModel } from '../model/types.js';
import { buildAggregateEnv } from './domain-env.js';
import { entityStateView } from './entity-state-axes.js';
import type { ScreenSpec } from '../model/screen/types.js';

/**
 * 式が、指定した集約の状態 `state` の実体を弾かないか(= 許容するか)を判定する。
 *
 * @param guards ガード式の共有サービス
 * @param domain ドメイン仕様全体(env の構築に使う)
 * @param expr 判定対象の式(precondition の AST、または filters を `andAll` で畳んだもの)。
 *   無ければ無条件で許容する
 * @param subjectEntity 式のパスの起点になっているエンティティ名(screen_spec の `subject.entity` /
 *   query_spec の `source`)。裸のフィールド名(`state == draft`)の解決に要る
 * @param targetAggregate 状態を固定したい集約(`SpecModel.aggregates` のキー)
 * @param targetEntity `targetAggregate` の entity 名
 * @param stateField 状態を持つフィールド名(`entityStateView` が引く軸の 1 つ)
 * @param state 固定する状態 ID
 * @returns 弾かなければ true(admit)
 */
export function admitsState(
  guards: GuardServices,
  domain: SpecModel,
  expr: GuardExpr | undefined,
  subjectEntity: string | undefined,
  targetAggregate: string,
  targetEntity: string,
  stateField: string,
  state: string,
): boolean {
  if (expr === undefined) return true;
  const matched = guards
    .collectPaths(expr)
    .find((path) => matchesStateField(path, subjectEntity, targetAggregate, targetEntity, stateField));
  if (matched === undefined) return true;

  const fixed = guards.parse(`${matched.segments.join('.')} == ${state}`);
  if (!fixed.ok) return true; // 起きないはずだが、起きても過検出には倒さない

  const env: DomainEnv = buildAggregateEnv(domain, targetAggregate);
  return guards.canCoexist(expr, fixed.expr, env).coexists;
}

/**
 * 画面の precondition を AST にする。
 *
 * パース失敗は S5 が別途落とすので、ここでは undefined(= 無条件 admit)にして黙って通す
 * (S13 / S15 / L2 網羅台帳がこの同じ変換を必要とするため、1 箇所にまとめる)。
 *
 * @param guards ガード式の共有サービス
 * @param screen 対象の画面(precondition が無ければ undefined を返す)
 */
export function preconditionExpr(guards: GuardServices, screen: ScreenSpec): GuardExpr | undefined {
  if (screen.precondition === undefined) return undefined;
  const parsed = guards.parse(screen.precondition.source);
  return parsed.ok ? parsed.expr : undefined;
}

/**
 * 複数の式を `and` で畳み込む(query_spec の `filters` はすべて AND で効くため)。
 * @param exprs 畳み込む式(0 本なら「制約なし」を表す `undefined` を返す)
 */
export function andAll(exprs: readonly GuardExpr[]): GuardExpr | undefined {
  return exprs.reduce<GuardExpr | undefined>(
    (acc, expr) => (acc === undefined ? expr : { kind: 'and', left: acc, right: expr }),
    undefined,
  );
}

/**
 * その集約でどのフィールドが指定した状態機械の値を持つか。
 *
 * 対応表そのものは `entityStateView`(lib/semantics/entity-state-axes.ts)が正であり、ここでは
 * 1 本の機械名に絞って引くだけにする(同じ対応表を 2 度書かない)。
 *
 * @param domain ドメイン仕様全体
 * @param aggregate 対象の集約(`SpecModel.aggregates` のキー)
 * @param machine 状態機械名
 * @returns 状態フィールド名。その集約にその機械の状態フィールドが無ければ `undefined`
 */
export function stateFieldOf(domain: SpecModel, aggregate: string, machine: string): string | undefined {
  return entityStateView(domain, aggregate)?.axes.find((axis) => axis.machine.machine === machine)?.stateField;
}

/**
 * パスが「対象集約の状態フィールド」を指しているか。
 *
 * 2 段(`{entity または aggregate}.{field}`)は常に対象になり得る。1 段(裸のフィールド名)は
 * `subjectEntity` が対象の entity / aggregate と一致するとき(precondition の起点そのものが
 * 対象集約であるとき)だけ対象になる —— 起点が分からなければ裸のフィールド名は
 * 「どのエンティティのものか」を機械が決められないため、無視する(admit 側に寄る)。
 */
function matchesStateField(
  path: PathRef,
  subjectEntity: string | undefined,
  aggregate: string,
  entity: string,
  field: string,
): boolean {
  const segments = path.segments;
  if (segments.length === 2) {
    const [root, leaf] = segments;
    return leaf === field && (root === entity || root === aggregate);
  }
  if (segments.length === 1 && subjectEntity !== undefined) {
    return segments[0] === field && (subjectEntity === entity || subjectEntity === aggregate);
  }
  return false;
}
