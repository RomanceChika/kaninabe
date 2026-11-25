/**
 * V18 の下位検査: 作成の持ち主の欄(action_spec の `owner`)の接地(`verify/verifiers/v18-owner.ts`)の規約網羅テスト。
 *
 * 点検 9 回目 A9-1: 「必須で入力に無い実行者への参照は作成者」の推測をやめ、作成者で埋める欄は `owner` で明示させる。
 * ここで固定するのは宣言の形 —— 作成の操作にだけ書ける・作る集約の欄・実在・`ref(実行者の集約)`・必須・入力にも計算値にも無い。
 */

import { describe, expect, it } from 'vitest';
import { ownerFindings } from '../../../../lib/verify/verifiers/v18-owner.js';
import { computesVerifier } from '../../../../lib/verify/verifiers/v18-computes.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** staff(実行者)/ doc(起案者・査閲者・メモ・任意の担当者)/ note(別の集約)。 */
const MODEL: SpecModel = specModel(
  [
    aggregate('staff', {
      entity: entitySpec('staff', { fields: [field('id', { kind: 'uuid' }), field('name', { kind: 'string' }, { required: true, session: true })] }),
    }),
    aggregate('doc', {
      entity: entitySpec('doc', {
        fields: [
          field('id', { kind: 'uuid' }),
          field('author_id', { kind: 'ref', entity: 'staff' }, { required: true }),
          field('reviewer_id', { kind: 'ref', entity: 'staff' }, { required: true }),
          field('assignee_id', { kind: 'ref', entity: 'staff' }),
          field('memo', { kind: 'string' }, { required: true }),
        ],
      }),
    }),
    aggregate('note', {
      entity: entitySpec('note', { fields: [field('id', { kind: 'uuid' }), field('author_id', { kind: 'ref', entity: 'staff' }, { required: true })] }),
    }),
  ],
  roleSpec([role('member'), role('anonymous'), role('system')]),
);

/** 1 本の action_spec の owner の指摘の message。 */
function messages(init: Parameters<typeof actionSpec>[0]): readonly string[] {
  return ownerFindings(MODEL, actionSpec(init)).map((finding) => finding.message);
}

describe('V18 owner の接地', () => {
  it.each([
    { name: '正例: 作成の必須の実行者参照で、入力に無い', init: { handles: 'doc.create', input: ['doc.memo', 'doc.reviewer_id'], owner: 'doc.author_id' }, expected: [] },
    { name: '正例: 宣言が無ければ何も言わない(値の出どころは実行計画が見る)', init: { handles: 'doc.create', input: ['doc.memo'] }, expected: [] },
    { name: '負例: 作成でない操作(遷移)に書いた', init: { handles: 'doc.file', input: ['doc.id'], owner: 'doc.author_id' }, expected: ['doc.file の owner doc.author_id は作成でない操作に書かれています'] },
    { name: '負例: 別の集約の欄を指す', init: { handles: 'doc.create', input: ['doc.memo'], owner: 'note.author_id' }, expected: ['doc.create の owner note.author_id は作る集約(doc)の欄を指していません'] },
    { name: '負例: 実在しない欄', init: { handles: 'doc.create', input: ['doc.memo'], owner: 'doc.writer_id' }, expected: ['doc.create の owner doc.writer_id は entity_spec に実在しません'] },
    { name: '負例: 実行者の集約への参照でない', init: { handles: 'doc.create', input: [], owner: 'doc.memo' }, expected: ['doc.create の owner doc.memo は ref(staff) 型ではありません'] },
    { name: '負例(境界): 任意の実行者参照(作成 RPC の縛りの外に落ちる)', init: { handles: 'doc.create', input: ['doc.memo'], owner: 'doc.assignee_id' }, expected: ['doc.create の owner doc.assignee_id は必須の欄ではありません'] },
    { name: '負例: 同じ操作の input にもある(人が選ぶ値と作成者は同時に成り立たない)', init: { handles: 'doc.create', input: ['doc.author_id'], owner: 'doc.author_id' }, expected: ['doc.create の owner doc.author_id は同じ操作の input にも現れます'] },
    {
      name: '負例: 同じ操作の computes にもある',
      init: { handles: 'doc.create', input: [], owner: 'doc.author_id', computes: { 'doc.author_id': 'pickAuthor' } },
      expected: ['doc.create の owner doc.author_id は同じ操作の computes にも現れます'],
    },
  ])('$name', ({ init, expected }) => {
    expect(messages(init)).toEqual(expected);
  });

  it('V18 の検査器から走る(computes の無い action_spec も見る)', () => {
    const ctx: VerifyContext = {
      guards: undefined as never,
      roots: TEST_ROOTS,
      actions: loadedInput({ actions: [actionSpec({ handles: 'doc.file', input: ['doc.id'], owner: 'doc.author_id' })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }),
      dataTables: UNSELECTED,
    };

    expect(computesVerifier.verify(MODEL, ctx).map((finding) => [finding.verifier, finding.severity, finding.message])).toEqual([
      ['V18', 'error', 'doc.file の owner doc.author_id は作成でない操作に書かれています'],
    ]);
  });
});
