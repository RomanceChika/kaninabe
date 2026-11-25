/**
 * 実行計画が**決まらなかったとき**の反例(3 点セット)の組み立て。
 *
 * 何が決まらないかの判断は plan-facts.ts / plan-facts-parts.ts が持ち、ここはその文面だけを
 * 持つ。**アプリの語彙は 1 語も持たない。**
 */

import type { PlanProblem, SavePlan, SaveStepPlan } from './step-plan.js';
import { at } from './param-source-facts.js';

/** 保存点の外の集約を 1 行に絞れない。 */
export function unreadable(plan: SavePlan, step: SaveStepPlan, entity: string, field: string): PlanProblem {
  return {
    message: `手順 ${step.op} の permit が要る ${entity}.${field} を読む id が決まりません`,
    suggestion:
      `${entity} を保存点の中で作るか、その id を指す入力欄(${entity}_id、または対象そのものなら id)を` +
      'その手順の action_spec の input に足す。どちらもできないなら、その条件を課す操作を保存点に置かない',
    counterexample: { ...at(plan, step), entity, field },
  };
}

/** ガード式・binding のパスがドメイン仕様に接地しない。 */
export function ungroundedPath(plan: SavePlan, step: SaveStepPlan, variable: string): PlanProblem {
  return {
    message: `手順 ${step.op} の permit が要る ${variable} の供給元が決まりません`,
    suggestion:
      'ガード式・ロールの binding に現れるパスは「保存点の中で作った集約の予測状態・入力欄」' +
      'か「保存点の外から読む集約の列」のどちらかでなければならない。仕様側(entity_spec の欄・' +
      'action_spec の input)を直すか、その条件を課す操作を保存点に置かない',
    counterexample: { ...at(plan, step), variable },
  };
}

/** その手順を認めるロールが 1 つも保存点の経路で立たない。 */
export function noResolvableRole(
  plan: SavePlan,
  step: SaveStepPlan,
  roles: readonly string[],
): PlanProblem {
  return {
    message: `手順 ${step.op} を認めるロールが保存点の経路では 1 つも立ちません`,
    suggestion:
      'セッションから立つグローバルロール(role_spec に kind を持つ)か、供給元を解決できる' +
      '文脈ロール(binding を持つ)を by に足す。行の属性が根拠のロール(kind も binding も' +
      '無いもの)しか認めていない操作は、誰も通れないので保存点に置けない',
    counterexample: { ...at(plan, step), roles: roles.join(', ') },
  };
}

/** binding の形が `{entity}.{field} == actor.id` ではない。 */
export function unsupportedBinding(plan: SavePlan, step: SaveStepPlan, role: string): PlanProblem {
  return {
    message: `手順 ${step.op} が認めるロール ${role} の binding を保存点の中で解決できません`,
    suggestion:
      '保存点の実行器が解決できる binding は `{entity}.{field} == actor.id` の形だけである。' +
      'role_spec の binding をその形にするか、そのロールを認める操作を保存点に置かない',
    counterexample: { ...at(plan, step), role },
  };
}
