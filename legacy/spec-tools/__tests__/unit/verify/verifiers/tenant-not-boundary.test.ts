/**
 * `not_boundary` の置き場と矛盾の検査・受け入れた危険としての名指し(点検 6 回目 A6-3。V20 の一部)のユニットテスト。
 *
 * 表: 実行者の集約(`session: true` の欄を持つ staff_member)と、そうでない store に `not_boundary` を置き、
 * `session: true` の併記・`actor.{欄}` の使用(reads の filters / 作成の when)の有無で、error / warning(受け入れた危険)/ 何もなし を固定する。
 */

import { describe, expect, it } from 'vitest';
import { tenantBoundaryVerifier } from '../../../../lib/verify/verifiers/v20-tenant-boundary.js';
import { notBoundaryAcceptances } from '../../../../lib/verify/verifiers/tenant-not-boundary.js';
import { accessSpec, aggregate, createRule, entitySpec, field, readRule, role, specModel, stubContext } from '../../../helpers/model-builder-v8plus.js';
import type { FieldDef, ReadRule } from '../../../../lib/model/types.js';

/** 差し替えのつまみ。 */
interface Init {
  /** 実行者の集約の会社の欄に足す属性。 */
  readonly actorField?: Partial<FieldDef>;
  /** 店舗の会社の欄に足す属性。 */
  readonly storeField?: Partial<FieldDef>;
  /** 店舗の読み取りに actor.company_id の filters を書くか。 */
  readonly storeFilter?: boolean;
  /** 店舗の作成の when。 */
  readonly storeWhen?: string;
}

function model(init: Init) {
  const read: ReadRule = init.storeFilter === true
    ? { ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }
    : readRule('staff_member', { kind: 'all' });
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff_member')],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [
          field('display_name', { kind: 'string' }, { session: true }),
          field('company_id', { kind: 'ref', entity: 'company' }, { required: true, ...init.actorField }),
        ]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec('store', [field('company_id', { kind: 'ref', entity: 'company' }, { required: true, ...init.storeField })]),
        access: accessSpec('store', { reads: [read], creates: [createRule('staff_member', init.storeWhen)] }),
      }),
    ],
  });
}

/** not_boundary に関する指摘だけ(`重さ 集約.欄 種類`)。 */
function notBoundaryLines(init: Init): string[] {
  const { ctx } = stubContext({});
  return tenantBoundaryVerifier
    .verify(model(init), ctx)
    .filter((finding) => String(finding.counterexample?.['kind'] ?? '').startsWith('not_boundary'))
    .map((finding) => `${finding.severity} ${String(finding.counterexample?.['entity'])}.${String(finding.counterexample?.['field'])} ${String(finding.counterexample?.['kind'])}`);
}

const REASON = '所属の印で、見える行を狭めない';

describe('V20: not_boundary の置き場と矛盾(A6-3)', () => {
  it.each([
    ['宣言なし → 何も言わない', {}, []],
    ['実行者の集約の、境界でない参照の欄 → 受け入れた危険の warning', { actorField: { notBoundary: REASON } }, ['warning staff_member.company_id not_boundary']],
    // 探り台本 probe1 L4 の形: session: true を残したまま not_boundary を足す。
    ['同じ欄に session: true(境界として使われ続ける)→ error', { actorField: { notBoundary: REASON, session: true } }, ['error staff_member.company_id not_boundary_misplaced']],
    ['reads の filters で actor.company_id に結んでいる → error', { actorField: { notBoundary: REASON }, storeFilter: true }, ['error staff_member.company_id not_boundary_misplaced']],
    ['作成の when で actor.company_id に結んでいる → error', { actorField: { notBoundary: REASON }, storeWhen: 'store.company_id == actor.company_id' }, ['error staff_member.company_id not_boundary_misplaced']],
    ['実行者の集約でない集約の欄 → error(死んだ宣言)', { storeField: { notBoundary: REASON } }, ['error store.company_id not_boundary_misplaced']],
    [
      '境界: 実行者の集約の欄は受け入れ・ほかの集約の欄は error(両方を 1 件ずつ)',
      { actorField: { notBoundary: REASON }, storeField: { notBoundary: REASON } },
      ['warning staff_member.company_id not_boundary', 'error store.company_id not_boundary_misplaced'],
    ],
  ] as const)('%s', (_title, init, expected) => {
    expect(notBoundaryLines(init)).toEqual(expected);
  });

  it('受け入れた危険の warning は acceptance に宣言(理由と欄の位置)を載せ、組み立ての根が W5 へ渡す宣言と同じものである', () => {
    const { ctx } = stubContext({});
    const built = model({ actorField: { notBoundary: REASON } });
    const [warning] = tenantBoundaryVerifier.verify(built, ctx).filter((finding) => finding.counterexample?.['kind'] === 'not_boundary');
    expect(warning?.acceptance?.reason).toBe(REASON);
    expect(notBoundaryAcceptances(built)).toEqual([warning?.acceptance]);
    expect(warning?.message).toContain('テナントの境界ではないと宣言して外しています');
  });

  it('error の文は矛盾の中身と直し方を言う(session: true の併記)', () => {
    const { ctx } = stubContext({});
    const [error] = tenantBoundaryVerifier
      .verify(model({ actorField: { notBoundary: REASON, session: true } }), ctx)
      .filter((finding) => finding.counterexample?.['kind'] === 'not_boundary_misplaced');
    expect(error?.message).toContain('session: true があり');
    expect(error?.suggestion).toContain('境界の欄なら not_boundary を消す');
    expect(error?.acceptance).toBeUndefined();
  });

  it('宣言の無い製品は受け入れの宣言も 0 件', () => {
    expect(notBoundaryAcceptances(model({}))).toEqual([]);
  });
});
