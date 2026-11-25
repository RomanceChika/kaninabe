/**
 * H1(サインイン分岐の全域性と接地)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §検証):
 *   - subject が実在しない状態機械なら落とすこと
 *   - 主語の軸の値が状態機械の状態でなければ落とすこと
 *   - **主語の状態が 1 つでも扱われていなければ落とすこと**(この仕様の中心)
 *   - メンバー行なしの行が無ければ落とすこと
 *   - lands の接地と、誰も落ちてこない着地を落とすこと
 *   - runs が実在し system が実行できること
 *   - `when` を宣言した軸が「その条件の行だけ」に現れること
 */

import { describe, expect, it } from 'vitest';
import { verifyBranchTotality } from '../../../../lib/auth/verifiers/h1-branch-totality.js';
import { authBranch, authLanding, authModel } from '../../../helpers/auth-builder.js';
import { event, machine, modelWithMachine } from '../../../helpers/model-builder.js';

/** メンバーの状態機械(実物と同じ 5 状態)。activate は system が実行できる。 */
const MEMBERSHIP = machine('membership', {
  states: ['guest', 'active', 'suspended', 'disabled', 'left'],
  initial: 'guest',
  final: ['left'],
  events: [event('activate', { from: ['guest'], to: 'active', by: ['staff', 'system'] })],
});

const DOMAIN = modelWithMachine(MEMBERSHIP);

/** 全状態を尽くした最小の宣言(これが「違反なし」の基準)。 */
function totalModel(extra: Parameters<typeof authModel>[0] = {}) {
  return authModel({
    landings: [authLanding('active', { screen: 'screen-workshop-list' }), authLanding('guest')],
    branches: [
      authBranch('no_member', { values: { member: 'none', invitation: 'none' }, lands: 'guest' }),
      authBranch('guest_row', { values: { member: 'guest' }, lands: 'guest' }),
      authBranch('active_row', { values: { member: 'active' } }),
      authBranch('suspended_row', { values: { member: 'suspended' } }),
      authBranch('disabled_row', { values: { member: 'disabled' }, lands: 'guest' }),
      authBranch('left_row', { values: { member: 'left' }, lands: 'guest' }),
    ],
    ...extra,
  });
}

describe('H1: サインイン分岐の全域性と接地', () => {
  it('全状態を尽くしていれば違反なし', () => {
    expect(verifyBranchTotality(DOMAIN, totalModel())).toEqual([]);
  });

  it('subject が実在しなければエラー', () => {
    const auth = authModel({ subject: 'unknown_machine' });
    const findings = verifyBranchTotality(DOMAIN, auth);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('H1');
    expect(findings[0]?.message).toContain('unknown_machine');
  });

  it('扱われていない状態があればエラー(暗黙の挙動の禁止)', () => {
    const auth = authModel({
      landings: [authLanding('active', { screen: 'screen-workshop-list' })],
      branches: [
        authBranch('no_member', { values: { member: 'none', invitation: 'none' } }),
        authBranch('active_row', { values: { member: 'active' } }),
      ],
    });
    const messages = verifyBranchTotality(DOMAIN, auth).map((finding) => finding.message);
    expect(messages.filter((message) => message.includes('サインインしたときの着地'))).toHaveLength(4);
    expect(messages.some((message) => message.includes('suspended'))).toBe(true);
  });

  it('メンバー行が無い人の行が無ければエラー', () => {
    const auth = authModel({
      landings: [authLanding('active', { screen: 'screen-workshop-list' })],
      branches: [
        authBranch('guest_row', { values: { member: 'guest' } }),
        authBranch('active_row', { values: { member: 'active' } }),
        authBranch('suspended_row', { values: { member: 'suspended' } }),
        authBranch('disabled_row', { values: { member: 'disabled' } }),
        authBranch('left_row', { values: { member: 'left' } }),
      ],
    });
    const messages = verifyBranchTotality(DOMAIN, auth).map((finding) => finding.message);
    expect(messages).toContain(
      'メンバー行の状態が無い人(member: none)がサインインしたときの着地が宣言されていません',
    );
  });

  it('member が主語の状態でなければエラー', () => {
    const findings = verifyBranchTotality(
      DOMAIN,
      totalModel({ branches: [...totalModel().flow!.branches, authBranch('bogus', { values: { member: 'zombie' } })] }),
    );
    expect(findings.some((finding) => finding.message.includes('zombie'))).toBe(true);
  });

  it('lands が実在しなければエラー / 誰も落ちてこない着地もエラー', () => {
    const dangling = verifyBranchTotality(
      DOMAIN,
      totalModel({
        branches: [...totalModel().flow!.branches, authBranch('bad_landing', { lands: 'nowhere' })],
      }),
    );
    expect(dangling.some((finding) => finding.message.includes('nowhere'))).toBe(true);

    const unused = verifyBranchTotality(
      DOMAIN,
      totalModel({
        landings: [
          authLanding('active', { screen: 'screen-workshop-list' }),
          authLanding('guest'),
          authLanding('orphan'),
        ],
      }),
    );
    expect(unused).toHaveLength(1);
    expect(unused[0]?.message).toBe('着地 orphan へ落ちる分岐がありません');
  });

  it('runs が実在しなければエラー / 人しか実行できないイベントもエラー', () => {
    const missing = verifyBranchTotality(
      DOMAIN,
      totalModel({
        branches: [...totalModel().flow!.branches, authBranch('r1', { runs: ['membership.nope'] })],
      }),
    );
    expect(missing.some((finding) => finding.message.includes('membership.nope'))).toBe(true);

    const humanOnly = modelWithMachine(
      machine('membership', {
        states: ['guest', 'active', 'suspended', 'disabled', 'left'],
        initial: 'guest',
        events: [event('activate', { from: ['guest'], to: 'active', by: ['staff'] })],
      }),
    );
    const findings = verifyBranchTotality(
      humanOnly,
      totalModel({
        branches: [...totalModel().flow!.branches, authBranch('r2', { runs: ['membership.activate'] })],
      }),
    );
    expect(findings.some((finding) => finding.message.includes('内部実行(role_spec の kind: system)が実行できません'))).toBe(
      true,
    );
  });

  it('invitation はメンバー行が無い行だけが持つ', () => {
    const onMember = verifyBranchTotality(
      DOMAIN,
      totalModel({
        branches: totalModel().flow!.branches.map((branch) =>
          branch.values.member === 'active'
            ? { ...branch, values: { ...branch.values, invitation: 'accepted' } }
            : branch,
        ),
      }),
    );
    expect(onMember.some((finding) => finding.message.includes('の行ではないのに invitation'))).toBe(true);

    const missing = verifyBranchTotality(
      DOMAIN,
      totalModel({
        branches: totalModel().flow!.branches.map((branch) =>
          branch.values.member === 'none'
            ? authBranch(branch.id, { values: { member: 'none' }, lands: 'guest' })
            : branch,
        ),
      }),
    );
    expect(missing.some((finding) => finding.message.includes('invitation を宣言していません'))).toBe(true);
  });
});
