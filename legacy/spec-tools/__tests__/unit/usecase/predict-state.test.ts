/**
 * 状態の予測(`predictState` / `finalStateOf`)の規約網羅テスト。
 *
 * 対象の要求: usecase-spec-writing.md §同じ集約を複数の手順で作るとき / ADR-0011 §4
 * (「1 保存 = 1 トランザクション」の予測と楽観的並行制御)。
 *
 * **予測は集約ではなく行に対して行う**(束⑯g)。別名(`as`)で同じ集約を複数の手順が作れる
 * ので、集約の名前だけで走査すると「別の行の作成」で予測が初期状態に戻り、実際には
 * 動かし終わっている行に対して古い状態を期待してしまう(複合 RPC の `where state = expected`
 * が 0 行を返し、正しい申し込みが競合として拒まれる)。
 *
 * 組み立ては生成器・検査と同じ入口(`buildSavePlans`)を通す —— ここだけ別経路で確かめると、
 * 実際に生成される SQL とずれた安心を作ってしまう。
 */

import { describe, expect, it } from 'vitest';
import { buildSavePlans } from '../../../lib/usecase/plan-build.js';
import { createGuardServices } from '../../../lib/guard/services.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import type { UsecaseStepDecl } from '../../../lib/model/usecase/types.js';

/** 手順の並びから 1 保存点のユースケースを組み立てる。 */
function build(steps: readonly UsecaseStepDecl[]) {
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave('register', [...steps], {
        migration: '20260909000050_usecase_demo_register.sql',
        name: 'demo',
      }),
    ],
  });
  return buildSavePlans({
    domain: rpcDomain({ itemOwner: true }),
    guards: createGuardServices(),
    // item.owner_id(実行者への参照・任意)は input に宣言する —— 保存点でも宣言の無い欄は入力に落とさない(A7-2)。
    actions: rpcActions({ itemOwner: true }),
    dataTables: rpcDataTables(true),
    usecases: { available: true, usecases: [usecase] },
  });
}

/** その手順の「遷移元の状態」の供給元(実行計画が運ぶもの)。 */
function stateFromOf(built: ReturnType<typeof build>, index: number) {
  return built.saves[0]?.facts.steps[index]?.stateFrom ?? null;
}

/** その手順の `p_expected_state`(複合 SQL に出るリテラル)。 */
function expectedLiteral(built: ReturnType<typeof build>, index: number): string | null | undefined {
  const param = built.saves[0]?.params[index]?.find((entry) => entry.source.kind === 'expected_state');
  return param?.source.kind === 'expected_state' ? param.source.literal : undefined;
}

describe('predictState —— 予測は「その手順が指している行」に対して行う', () => {
  it('保存点の中で作った行は initial から予測する', () => {
    const built = build([
      usecaseStep('container.create'),
      usecaseStep('item.create'),
      usecaseStep('item.submit'),
    ]);

    expect(built.problems).toEqual([]);
    expect(stateFromOf(built, 2)).toEqual({ kind: 'predicted', value: 'draft' });
    expect(expectedLiteral(built, 2)).toBe('draft');
  });

  it('別の行を作る手順が間に挟まっても、その行に起きた遷移の to を答える', () => {
    // 自分の行を作って動かし、その後に繰り返しで別の行を作り、また自分の行を動かす。
    // 集約の名前で走査すると手順 4 の作成が予測を initial に戻し、手順 5 が古い状態を期待する。
    const built = build([
      usecaseStep('container.create'),
      usecaseStep('item.create', { as: 'mine', defaultsSelf: true }),
      usecaseStep('item.submit', { as: 'submit_mine' }),
      usecaseStep('item.create', { as: 'rest', repeat: true }),
      usecaseStep('item.submit', { as: 'submit_again' }),
    ]);

    expect(built.problems).toEqual([]);
    expect(stateFromOf(built, 2)).toEqual({ kind: 'predicted', value: 'draft' });
    // 手順 5 が指すのは「直前の、繰り返さない作成」= mine の行であり、それは既に submitted。
    expect(stateFromOf(built, 4)).toEqual({ kind: 'predicted', value: 'submitted' });
    expect(expectedLiteral(built, 4)).toBe('submitted');
  });

  it('保存点の外から来た行は、中で動かしていなければ呼び側が読んだ値を使う', () => {
    const built = build([usecaseStep('item.submit')]);

    expect(built.problems).toEqual([]);
    // 予測しない = リテラルを持たない(複合 RPC は p_expected の値を使う)。
    expect(expectedLiteral(built, 0)).toBeNull();
    expect(stateFromOf(built, 0)).toEqual({ kind: 'external', ref: 'item.state' });
  });
});

describe('finalStateOf —— 結末の状態も同じ規則で決まる', () => {
  it('作った行を動かし終えた状態を返す', () => {
    const built = build([
      usecaseStep('container.create'),
      usecaseStep('item.create'),
      usecaseStep('item.submit'),
    ]);

    // 結末になるのは最初の手順の集約(container。状態フィールドを持たない)。
    expect(built.saves[0]?.facts.result.entity).toBe('container');
    expect(built.saves[0]?.facts.result.state).toBeNull();
  });

  it('最初の手順が状態機械を持つ集約なら、最後の遷移先を返す', () => {
    const built = build([usecaseStep('item.create'), usecaseStep('item.submit')]);

    expect(built.problems).toEqual([]);
    expect(built.saves[0]?.facts.result.entity).toBe('item');
    expect(built.saves[0]?.facts.result.state).toBe('submitted');
  });
});
