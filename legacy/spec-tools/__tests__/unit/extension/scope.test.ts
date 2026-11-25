/**
 * 絞りの鍵(`scope`)の定義のユニットテスト。
 *
 * 見るのは、鍵の全数に定義があること・鍵が見る事実(仕組みの表の名前・執行点の種類)の判定・絞りが無ければ
 * 何にでも当たること・絞りの重なりの判定。
 */

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../../lib/kernel/finding.js';
import { SCOPES, scopeAdmits, scopesOverlap } from '../../../lib/extension/scope.js';
import { EXTENSION_SCOPES } from '../../../lib/model/extension/types.js';
import { T16_REASONS, T17_REASONS } from '../../../lib/data/check-reasons.js';
import { A19_REASONS } from '../../../lib/trace/compute-reasons.js';
import { T2_REASONS } from '../../../lib/data/index-reasons.js';

/** 警告 1 件。 */
function warning(verifier: string, counterexample?: Readonly<Record<string, string>>, reason?: string): Finding {
  const base = { verifier, severity: 'warning', message: 'm', location: { file: 'f.md' }, suggestion: 's' } as const;
  const withExample = counterexample === undefined ? base : { ...base, counterexample };
  return reason === undefined ? withExample : { ...withExample, reason };
}

describe('拡張候補の絞りの鍵', () => {
  it('値域の全部の鍵に定義があり、絞れる検査と言い方を持つ', () => {
    expect(Object.keys(SCOPES).sort()).toEqual([...EXTENSION_SCOPES].sort());
    for (const scope of EXTENSION_SCOPES) {
      expect(SCOPES[scope].verifiers.length).toBeGreaterThan(0);
      expect(SCOPES[scope].meaning).not.toBe('');
    }
  });

  it('framework_tables は、理由の欄が「仕組みの表で製品が関数を宣言していない」の T2 だけに収まる(表の名前からは推定しない)', () => {
    const reasoned = (reason: string) => warning('T2', { table: 'jobs' }, reason);

    expect(scopeAdmits('framework_tables', reasoned(T2_REASONS.frameworkTableFunctionless))).toBe(true);
    // 製品がその表を持ち場とする関数を宣言していれば、製品が lookup を書けるので収まらない(未分類に落ちる)
    expect(scopeAdmits('framework_tables', reasoned(T2_REASONS.unrequested))).toBe(false);
    // 仕組みの表の名前を載せていても、理由の欄が無ければ収まらない
    expect(scopeAdmits('framework_tables', warning('T2', { table: 'jobs' }))).toBe(false);
    expect(scopeAdmits('framework_tables', warning('T2'))).toBe(false);
  });

  it('trigger_formal_inexpressible は、理由の欄がその語の警告だけに収まる(反例の欄からは推定しない)', () => {
    const reasoned = (reason: string) => warning('T16', { kind: 'trigger', formal: 'cardinality' }, reason);

    expect(scopeAdmits('trigger_formal_inexpressible', reasoned(T16_REASONS.triggerFormalInexpressible))).toBe(true);
    // 製品が直せる側・行の CHECK を反映できない側の理由は収まらない
    expect(scopeAdmits('trigger_formal_inexpressible', reasoned(T16_REASONS.enforcementUndeclared))).toBe(false);
    expect(scopeAdmits('trigger_formal_inexpressible', reasoned(T16_REASONS.checkNotReflected))).toBe(false);
    // 理由の欄が無い警告は、反例が仕組みの側に見えても収まらない(読むのは理由の欄だけ)
    expect(scopeAdmits('trigger_formal_inexpressible', warning('T16', { kind: 'trigger', formal: 'cardinality' }))).toBe(false);
    expect(scopeAdmits('trigger_formal_inexpressible', warning('T16'))).toBe(false);
  });

  it('trigger_condition_inexpressible は、形式定義が DSL の外で照らせない T17 の警告だけに収まる(製品が直せる理由は未分類。点検 21 回目 C21-4)', () => {
    const reasoned = (reason: string) => warning('T17', { reason }, reason);

    expect(scopeAdmits('trigger_condition_inexpressible', reasoned(T17_REASONS.conditionNoFormal))).toBe(true);
    // 形式定義も理由(formal_outside)も無い不変条件は受け入れない(点検 22 回目 C22-3。書けるのに書いていないと区別できない)
    for (const reason of [T17_REASONS.conditionFormalMissing, T17_REASONS.conditionMissingInvariant, T17_REASONS.conditionKindOutside, T17_REASONS.conditionUnparsable, T17_REASONS.conditionNoWords]) {
      expect(scopeAdmits('trigger_condition_inexpressible', reasoned(reason)), reason).toBe(false);
    }
    expect(scopeAdmits('trigger_condition_inexpressible', warning('T17'))).toBe(false);
    expect(SCOPES.trigger_condition_inexpressible.verifiers).toEqual(['T17']);
  });

  it('trigger_cross_aggregate は、理由の欄がその語の T16 の警告だけに収まる', () => {
    const reasoned = (reason: string) => warning('T16', { kind: 'trigger', formal: 'check' }, reason);

    expect(scopeAdmits('trigger_cross_aggregate', reasoned(T16_REASONS.crossAggregateCheck))).toBe(true);
    expect(scopeAdmits('trigger_cross_aggregate', reasoned(T16_REASONS.triggerFormalInexpressible))).toBe(false);
    expect(scopeAdmits('trigger_cross_aggregate', reasoned(T16_REASONS.enforcementUndeclared))).toBe(false);
    expect(scopeAdmits('trigger_cross_aggregate', warning('T16', { kind: 'trigger', formal: 'check' }))).toBe(false);
    // 別の鍵は、この理由を取り合わない
    expect(scopeAdmits('trigger_formal_inexpressible', reasoned(T16_REASONS.crossAggregateCheck))).toBe(false);
    expect(SCOPES.trigger_cross_aggregate.verifiers).toEqual(['T16']);
  });

  it('compute_child_set は、理由の欄が child_set_read の A19 の警告だけに収まる(宣言が無い警告には当たらない)', () => {
    expect(scopeAdmits('compute_child_set', warning('A19', undefined, A19_REASONS.childSetRead))).toBe(true);
    // 材料の宣言が 1 つも無い警告は理由の欄を持たない
    expect(scopeAdmits('compute_child_set', warning('A19'))).toBe(false);
    expect(scopeAdmits('compute_child_set', warning('A19', undefined, 'other'))).toBe(false);
    expect(SCOPES.compute_child_set.verifiers).toEqual(['A19']);
  });

  it('絞りが無ければ何にでも当たる', () => {
    expect(scopeAdmits(undefined, warning('T2'))).toBe(true);
  });

  it('絞りの重なり: 片方が絞り無しか同じ鍵なら重なり、別の鍵どうしなら重ならない', () => {
    expect(scopesOverlap(undefined, 'framework_tables')).toBe(true);
    expect(scopesOverlap('framework_tables', undefined)).toBe(true);
    expect(scopesOverlap('framework_tables', 'framework_tables')).toBe(true);
    expect(scopesOverlap('framework_tables', 'trigger_formal_inexpressible')).toBe(false);
    expect(scopesOverlap('trigger_formal_inexpressible', 'trigger_cross_aggregate')).toBe(false);
  });
});
