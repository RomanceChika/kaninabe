/**
 * V8 決定性チェック。
 *
 * domain-spec-writing.md の V8:「同一(状態, イベント, ロール)でガードが重複成立し
 * 行き先が異なる遷移がないか」。
 *
 * 同じイベント ID の遷移定義が複数あり、遷移元状態と実行ロールが重なり、
 * かつ 2 つのガードが同時に成立し得るなら、その状況で「どちらへ遷移するか」が
 * 仕様から決まらない。実装が任意に選ぶ余地を残さないためエラーとする。
 *
 * 反例には canCoexist が返す witness(両ガードを同時に真にする変数割当)を載せ、
 * 「state=submitted, workshop.state=accepting のとき遷移が 2 つ成立」の形で出せるようにする。
 */

import type { SpecModel, EventDef, StateMachineSpec } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier, VerifyContext } from '../../check-api/contract.js';
import type { DomainEnv, GuardExpr } from '../../guard/ast.js';
import { buildAggregateEnv } from '../../semantics/domain-env.js';

/** ガードのパース結果。パース不能なら判定を諦める(V9/V2 が別途報告する)。 */
type ParsedGuard = { readonly ok: true; readonly expr: GuardExpr | undefined } | { readonly ok: false };

/** ガード文字列(省略可)を AST にする。省略時は「常に真」を表す undefined を返す。 */
function parseGuard(ctx: VerifyContext, source: string | undefined): ParsedGuard {
  if (source === undefined) return { ok: true, expr: undefined };
  const parsed = ctx.guards.parse(source);
  return parsed.ok ? { ok: true, expr: parsed.expr } : { ok: false };
}

/** 2 つの配列の共通要素を、第 1 引数の順序で返す。 */
function intersect(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return a.filter((value) => other.has(value));
}

/** 同一 ID のイベント定義をまとめる(定義順を保つ)。 */
function groupByEventId(machine: StateMachineSpec): Map<string, EventDef[]> {
  const groups = new Map<string, EventDef[]>();
  for (const event of machine.events) {
    const bucket = groups.get(event.id);
    if (bucket === undefined) groups.set(event.id, [event]);
    else bucket.push(event);
  }
  return groups;
}

/** 反例表示用にガードを文字列化する(省略されたガードは「常に真」)。 */
function describeGuard(source: string | undefined): string {
  return source ?? '(guard なし = 常に真)';
}

/**
 * 反例に witness(両ガードを同時に真にする変数割当)を混ぜる。
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

/**
 * 同一イベントの 2 定義が非決定的かを判定し、そうなら Finding を 1 件返す。
 *
 * @returns 非決定なら Finding、そうでなければ undefined
 */
function checkPair(
  aggregate: string,
  machine: StateMachineSpec,
  a: EventDef,
  b: EventDef,
  env: DomainEnv,
  ctx: VerifyContext,
): Finding | undefined {
  if (a.to === b.to) return undefined;

  const sharedStates = intersect(a.from, b.from);
  const sharedRoles = intersect(a.by, b.by);
  const witnessState = sharedStates[0];
  const witnessRole = sharedRoles[0];
  if (witnessState === undefined || witnessRole === undefined) return undefined;

  const guardA = parseGuard(ctx, a.guard);
  const guardB = parseGuard(ctx, b.guard);
  if (!guardA.ok || !guardB.ok) return undefined;
  const coexist = ctx.guards.canCoexist(guardA.expr, guardB.expr, env);
  if (!coexist.coexists) return undefined;

  return {
    verifier: 'V8',
    severity: 'error',
    message:
      `${machine.machine}.${a.id}: 状態 ${witnessState} でロール ${witnessRole} が実行したとき、` +
      `遷移先 ${a.to} と ${b.to} の 2 定義のガードが同時に成立し得ます(非決定)`,
    location: b.location,
    suggestion:
      `ガードを排他にする(片方に not 条件を足す)か、イベントを ${a.id}_to_${a.to} / ${a.id}_to_${b.to} のように分割するか、` +
      `from の状態(${sharedStates.join(', ')})または by のロール(${sharedRoles.join(', ')})の重なりを解消してください`,
    counterexample: mergeWitness(
      {
        aggregate,
        machine: machine.machine,
        event: a.id,
        state: witnessState,
        role: witnessRole,
        to_a: a.to,
        to_b: b.to,
        guard_a: describeGuard(a.guard),
        guard_b: describeGuard(b.guard),
      },
      coexist.witness,
    ),
  };
}

/**
 * V8: 遷移の決定性を検証する。
 *
 * ガードの同時成立可否は `ctx.guards.canCoexist` に委譲する(具象を import しない)。
 */
export const determinismVerifier: Verifier = {
  id: 'V8',
  title: '決定性 — 同一(状態, イベント, ロール)で行き先の異なる遷移が同時成立しないこと',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];
    for (const [aggregate, specs] of model.aggregates) {
      const env = buildAggregateEnv(model, aggregate);
      for (const machine of specs.stateMachines) {
        for (const events of groupByEventId(machine).values()) {
          for (let i = 0; i < events.length; i += 1) {
            for (let j = i + 1; j < events.length; j += 1) {
              const a = events[i];
              const b = events[j];
              if (a === undefined || b === undefined) continue;
              const finding = checkPair(aggregate, machine, a, b, env, ctx);
              if (finding !== undefined) findings.push(finding);
            }
          }
        }
      }
    }
    return findings;
  },
};
