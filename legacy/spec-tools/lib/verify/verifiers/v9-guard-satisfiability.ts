/**
 * V9 ガード充足性チェック。
 *
 * domain-spec-writing.md の V9:「ガードが恒偽(書いたのに絶対成立しない)/
 * 恒真(書く意味がない)でないか」。
 *
 * 対象は `guard`(state_spec)・`when`(access_spec の creates / writes / deletes)・`binding`(role_spec)。
 * - 恒偽(unsatisfiable) = その遷移・編集は永久に実行できない → error
 * - 恒真(tautology)     = 条件を書いた意図が実現していない → warning
 * - satisfiable は報告しない。
 * - unknown = **判定できなかった** → 時間切れなら warning・**判定器の故障なら error**。
 *   充足性の判定器は Z3(既製品)であり、自作の列挙器が持つ「3 つの上限」は判定に効かない
 *   —— あれは先読みである(z3-satisfiability.ts)。判定できなかった式を黙って通すと、
 *   恒偽・恒真の見落としが緑のまま生き延びる。故障(起動できない・写像を拒まれた)を
 *   時間切れと見分けのつかない形で出すと診断が嘘になるので分ける(satisfiability-findings.ts)。
 *
 * 判定そのものは `ctx.guards.satisfiability` に委譲し、ここは
 * 「どの式を、どの変数ドメインで判定し、どう Finding に翻訳するか」だけを持つ。
 * 判定が witness(変数割当)を返した場合は反例に載せる。
 */

import type { SpecModel, SourceLocation } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier, VerifyContext } from '../../check-api/contract.js';
import type { DomainEnv, SatResult } from '../../guard/ast.js';
import { undecidedText } from '../satisfiability-findings.js';
import { ungroundedLiterals } from '../../guard/literal-grounding.js';
import { buildAggregateEnv, buildDomainEnv } from '../../semantics/domain-env.js';

/** 判定対象の式 1 件。どの構文要素かを label に持ち、メッセージに使う。 */
interface GuardTarget {
  /** 構文要素名(例: "guard" / "when" / "binding") */
  readonly label: string;
  /** 式の生文字列 */
  readonly source: string;
  /** 式が属する要素の位置 */
  readonly location: SourceLocation;
  /** 判定に使う変数ドメイン */
  readonly env: DomainEnv;
  /** 恒偽・恒真それぞれのときに提示する文脈(例: "entry.submit") */
  readonly owner: string;
}

/** モデルから判定対象の式をすべて集める。 */
function collectTargets(model: SpecModel): GuardTarget[] {
  const targets: GuardTarget[] = [];
  const globalEnv = buildDomainEnv(model);

  for (const role of model.roles.roles) {
    if (role.binding === undefined) continue;
    targets.push({
      label: 'binding',
      source: role.binding,
      location: role.location,
      env: globalEnv,
      owner: `ロール ${role.id}`,
    });
  }

  for (const [aggregate, specs] of model.aggregates) {
    const env = buildAggregateEnv(model, aggregate);
    for (const machine of specs.stateMachines) {
      for (const event of machine.events) {
        if (event.guard === undefined) continue;
        targets.push({
          label: 'guard',
          source: event.guard,
          location: event.location,
          env,
          owner: `${machine.machine}.${event.id}`,
        });
      }
    }
    for (const create of specs.access?.creates ?? []) {
      if (create.when === undefined) continue;
      targets.push({
        label: 'when',
        source: create.when,
        location: create.location,
        env,
        owner: `${aggregate} の creates(by: ${create.by})`,
      });
    }
    for (const write of specs.access?.writes ?? []) {
      if (write.when === undefined) continue;
      targets.push({
        label: 'when',
        source: write.when,
        location: write.location,
        env,
        owner: `${aggregate} の writes(by: ${write.by})`,
      });
    }
    for (const del of specs.access?.deletes ?? []) {
      if (del.when === undefined) continue;
      targets.push({
        label: 'when',
        source: del.when,
        location: del.location,
        env,
        owner: `${aggregate} の deletes(by: ${del.by})`,
      });
    }
  }
  return targets;
}

/**
 * 反例に witness(判定を実証する変数割当)を混ぜる。
 * 固定キーと衝突する割当は `witness.` を前置して両方を残す。
 */
function mergeWitness(
  base: Record<string, string>,
  witness: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (witness === undefined) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(witness)) {
    merged[key in base ? `witness.${key}` : key] = value;
  }
  return merged;
}

/** 恒偽の Finding を組み立てる。 */
function unsatisfiableFinding(target: GuardTarget, witness: Readonly<Record<string, string>> | undefined): Finding {
  return {
    verifier: 'V9',
    severity: 'error',
    message: `${target.owner} の ${target.label} "${target.source}" は充足不能(恒偽)です`,
    location: target.location,
    suggestion:
      '矛盾する条件(同じパスへの両立しない比較や、取り得ない値との比較)を取り除くか、' +
      '意図した条件へ書き直してください。起こせない遷移・編集なら定義ごと削除します',
    counterexample: mergeWitness(
      { [target.label]: target.source, satisfiability: 'unsatisfiable' },
      witness,
    ),
  };
}

/** 恒真の Finding を組み立てる。 */
function tautologyFinding(target: GuardTarget, witness: Readonly<Record<string, string>> | undefined): Finding {
  return {
    verifier: 'V9',
    severity: 'warning',
    message: `${target.owner} の ${target.label} "${target.source}" は恒真です(条件として効いていません)`,
    location: target.location,
    suggestion:
      '常に成立する条件は書く意味がありません。意図した条件へ書き直すか、' +
      `${target.label} を削除して「無条件」であることを明示してください`,
    counterexample: mergeWitness({ [target.label]: target.source, satisfiability: 'tautology' }, witness),
  };
}

/**
 * 判定できなかったことを報告する Finding(黙って通さない)。
 *
 * 文面と severity の出し分け(時間切れ = warning / 判定器の故障 = error)は V10 と共有する
 * (satisfiability-findings.ts)。
 *
 * @param target 判定対象の式
 * @param result 判定の結果(`failure` が立っていれば判定器の故障)
 * @returns warning もしくは error の Finding
 */
function undecidedFinding(target: GuardTarget, result: SatResult): Finding {
  const text = undecidedText(`${target.owner} の ${target.label} "${target.source}"`, result, {
    [target.label]: target.source,
  });
  return {
    verifier: 'V9',
    severity: text.severity,
    message: text.message,
    location: target.location,
    suggestion: text.suggestion,
    counterexample: text.counterexample,
  };
}

/**
 * V9: ガード式の充足可能性を検証する。
 *
 * パースに失敗した式・値域に無いリテラルを含む式はここでは報告しない
 * (構文エラーとリテラルの接地は V2 の担当であり、同じ違反を二重に出さないため)。
 * 綴り違いのリテラルが混じった式の「恒偽」は、書き手の意図ではなく綴り違いを写しているだけで、
 * 直すべき場所も V2 が名指ししている。
 */
export const guardSatisfiabilityVerifier: Verifier = {
  id: 'V9',
  title: 'ガード充足性 — guard / when / binding が恒偽・恒真でないこと',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];
    for (const target of collectTargets(model)) {
      const parsed = ctx.guards.parse(target.source);
      if (!parsed.ok) continue;
      if (ungroundedLiterals(parsed.expr, target.env).length > 0) continue;
      const result = ctx.guards.satisfiability(parsed.expr, target.env);
      if (result.verdict === 'unsatisfiable') findings.push(unsatisfiableFinding(target, result.witness));
      else if (result.verdict === 'tautology') findings.push(tautologyFinding(target, result.witness));
      else if (result.verdict === 'unknown') findings.push(undecidedFinding(target, result));
    }
    return findings;
  },
};
