/**
 * V18 の下位検査: 作成の規則の代理の欄(access_spec の `creates[].delegate`)の接地(`verify/verifiers/v18-delegate.ts`)の規約網羅テスト。
 *
 * 点検 10 回目 A10-2: `delegate` は規則単位の 1 文字列から、名指した欄だけを解く `[{ field, reason }]` に変えた。名指しが当たらない
 * 要素は何も解かない(書いた人の意図と生成物の縛りがずれる)ので、腐った宣言として止める。ここで固定するのは、作成の input にある・
 * 実在する・`ref(実行者の集約)`・規則がもともと縛らない形ではない、の 4 つと、action_spec を読めないときに判定しないこと。
 */

import { describe, expect, it } from 'vitest';
import { delegateFindings } from '../../../../lib/verify/verifiers/v18-delegate.js';
import { computesVerifier } from '../../../../lib/verify/verifiers/v18-computes.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import type { CreateRule, SpecModel } from '../../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import { accessSpec, aggregate, create, entitySpec, field, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 代理の欄を名指した作成の規則。 */
function delegating(by: string, ...fields: string[]): CreateRule {
  return { ...create(by), delegate: fields.map((name) => ({ entity: 'doc', field: name, reason: '窓口が代わりに選ぶ', location: { file: 'access.md', pointer: `delegate.${name}` } })) };
}

/** staff(実行者・管理者の claim)/ doc(承認者・受取人・メモ)の最小ドメイン。 */
function model(creates: readonly CreateRule[]): SpecModel {
  return specModel(
    [
      aggregate('staff', {
        entity: entitySpec('staff', {
          fields: [field('id', { kind: 'uuid' }), field('name', { kind: 'string' }, { required: true, session: true }), field('is_admin', { kind: 'boolean' }, { session: true })],
        }),
      }),
      aggregate('doc', {
        entity: entitySpec('doc', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('approver_id', { kind: 'ref', entity: 'staff' }, { required: true }),
            field('payee_id', { kind: 'ref', entity: 'staff' }),
            field('memo', { kind: 'string' }),
          ],
        }),
        access: accessSpec('doc', { creates }),
      }),
    ],
    roleSpec([role('member', undefined, undefined, 'authenticated_default'), role('anonymous'), role('system'), { ...role('admin'), claim: 'staff.is_admin' }]),
  );
}

/** doc.create の action_spec(input を差し替える)。 */
function actions(input: readonly string[]): ActionSpecModel {
  return { actions: [actionSpec({ handles: 'doc.create', input: [...input] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] };
}

describe('V18 delegate の接地', () => {
  const INPUT = ['doc.approver_id', 'doc.memo'];

  it.each([
    { name: '正例: 作成の input にある実行者への参照の欄を名指す', rule: delegating('member', 'approver_id'), input: INPUT, expected: [] },
    { name: '正例: delegate の無い規則は何も言わない', rule: create('member'), input: INPUT, expected: [] },
    {
      name: '負例: 作成の input に無い欄(人が選ばない欄。後で input から外した取り残しも同じ)',
      rule: delegating('member', 'payee_id'),
      input: INPUT,
      expected: ['doc の creates[0](by: member)の delegate doc.payee_id は doc.create の action_spec の input にありません'],
    },
    {
      name: '負例: 実在しない欄',
      rule: delegating('member', 'reviewer_id'),
      input: INPUT,
      expected: ['doc の creates[0](by: member)の delegate doc.reviewer_id は entity_spec に実在しません'],
    },
    {
      name: '負例: 実行者への参照でない欄(縛りが無く、解くものも無い)',
      rule: delegating('member', 'memo'),
      input: INPUT,
      expected: ['doc の creates[0](by: member)の delegate doc.memo は ref(staff) 型ではありません'],
    },
    {
      name: '正例(境界): claim のロールの規則も delegate が解く(管理のロールの推測はしない。点検 11 回目 A11-3)',
      rule: delegating('admin', 'approver_id'),
      input: INPUT,
      expected: [],
    },
    {
      name: '負例(境界): 内部実行の規則はもともと縛らない',
      rule: delegating('system', 'approver_id'),
      input: INPUT,
      expected: ['doc の creates[0](by: system)の delegate doc.approver_id は何も解きません'],
    },
    {
      name: '要素ごとに見る(当たる要素は通り、当たらない要素だけが止まる)',
      rule: delegating('member', 'approver_id', 'payee_id'),
      input: INPUT,
      expected: ['doc の creates[0](by: member)の delegate doc.payee_id は doc.create の action_spec の input にありません'],
    },
  ])('$name', ({ rule, input, expected }) => {
    const found = delegateFindings(model([rule]), actions(input)).map((finding) => finding.message);

    expect(found.map((message) => message.slice(0, expected[0]?.length ?? 0))).toEqual(expected);
  });

  it('作成の action_spec が無ければ、名指した欄は input に無いとして止まる', () => {
    const found = delegateFindings(model([delegating('member', 'approver_id')]), { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] });

    expect(found.map((finding) => [finding.verifier, finding.severity])).toEqual([['V18', 'error']]);
    expect(found[0]?.message).toContain('doc.create の action_spec の input にありません');
  });

  it('action_spec を読めないときは判定しない(未選択)', () => {
    expect(delegateFindings(model([delegating('member', 'payee_id')]), undefined)).toEqual([]);
  });

  it('V18 の検査器から走る(読めた action_spec があるとき)', () => {
    const domain = model([delegating('member', 'payee_id')]);
    const loaded: VerifyContext = { guards: undefined as never, roots: TEST_ROOTS, actions: loadedInput(actions(INPUT)), dataTables: UNSELECTED };
    const unselected: VerifyContext = { ...loaded, actions: UNSELECTED };

    expect(computesVerifier.verify(domain, loaded).map((finding) => finding.message)).toEqual([expect.stringContaining('delegate doc.payee_id は doc.create の action_spec の input にありません')]);
    expect(computesVerifier.verify(domain, unselected)).toEqual([]);
  });
});
