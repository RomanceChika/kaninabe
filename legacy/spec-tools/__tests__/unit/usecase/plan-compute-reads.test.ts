/**
 * `computes[].reads`(計算が読む事実)が実行計画の読み取りに積まれること(束 ㉒)。
 *
 * 宣言が無かったあいだ、計画が読む欄は**ガード式・ロールの binding・予測状態・結果の id** が
 * 要求したものだけだった。純関数に渡るのは「その計画が読んだ事実」と「入力」なので、
 * 計算の材料は 1 欄も届かず、しかもどの検査も黙っていた(`lib/trace/verifiers/a19-*.ts` の注)。
 *
 * ここで固定するのは 3 つである。
 *   - 自分の集約の欄が積まれる(既に読んでいる器に欄が足される)
 *   - **別の集約**の欄も積まれる(`context` で 1 段辿れる相手)
 *   - **読めない集約は計画を止めない**(黙って積まないだけ。報告するのは A19)
 */

import { describe, expect, it } from 'vitest';
import { buildOperationPlans } from '../../../lib/usecase/operation-plan.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import type { ActionSpec, ActionSpecModel } from '../../../lib/model/trace/types.js';

/** widget(遷移を持つ対象)と gadget(1 段先の相手)と、どこからも辿れない orphan。 */
const MODEL = specModel({
  roles: [role('anonymous'), role('member'), role('system')],
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec(
        'widget',
        [
          field('state', { kind: 'state', machine: 'widget' }, { required: true }),
          field('gadget_id', { kind: 'ref', entity: 'gadget' }, { required: true }),
          field('amount', { kind: 'integer' }),
          field('score', { kind: 'integer' }),
        ],
        { gadget: 'widget.gadget_id' },
      ),
      stateMachines: [
        machine({
          machine: 'widget',
          states: ['draft', 'sent'],
          initial: 'draft',
          events: [event({ id: 'send', from: ['draft'], to: 'sent', by: ['member'] })],
        }),
      ],
      access: accessSpec('widget', { writes: [writeRule('system', ['amount'])] }),
    }),
    aggregate({
      name: 'gadget',
      entity: entitySpec('gadget', [field('label', { kind: 'string' })]),
    }),
    aggregate({
      name: 'orphan',
      entity: entitySpec('orphan', [field('note', { kind: 'string' })]),
    }),
  ],
});

/** 遷移 RPC 1 本(規約に載る引数 + 計算値を受け取る `p_amount`)。 */
const TABLES = dataTableModel([
  dataTable('widgets', {
    entity: 'widget',
    functions: [
      {
        name: 'apply_widget_transition',
        args: ['text', 'text', 'text', 'text', 'text', 'text', 'text'],
        params: [
          'p_widget_id',
          'p_expected_state',
          'p_next_state',
          'p_effects',
          'p_event_id',
          'p_actor_id',
          'p_amount',
        ],
        kind: 'rpc',
        shape: 'transition',
        alsoWrites: [],
      },
    ],
  }),
  dataTable('gadgets', { entity: 'gadget', functions: [] }),
  dataTable('orphans', { entity: 'orphan', functions: [] }),
]);

/** action_spec 1 本だけを持つモデル。 */
function actions(spec: ActionSpec): ActionSpecModel {
  return { actions: [spec], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] };
}

/** `computes` の `reads` を宣言した widget.send の計画を組み立てる。 */
function build(reads: readonly string[]) {
  const { guards } = stubContext();
  return buildOperationPlans({
    domain: MODEL,
    guards,
    actions: actions(
      actionSpec({
        handles: 'widget.send',
        input: ['widget.id'],
        computes: { 'widget.amount': 'computeAmount' },
        computeReads: { 'widget.amount': reads },
      }),
    ),
    dataTables: TABLES,
    jobs: undefined,
  });
}

/** その集約の読み取りが並べている欄。 */
function fieldsOf(built: ReturnType<typeof build>, entity: string): readonly string[] {
  return built.operations[0]?.facts.reads.find((read) => read.entity === entity)?.fields ?? [];
}

describe('computes[].reads が実行計画の読み取りに積まれる', () => {
  it('宣言が無ければ計算の材料は 1 欄も積まれない(穴そのものの再現)', () => {
    const built = build([]);

    expect(built.problems).toEqual([]);
    // ガードもロールも無いので、読むのは遷移元の状態だけである。
    expect(fieldsOf(built, 'widget')).toEqual(['state']);
  });

  it('自分の集約の欄は、既に読んでいる器に足される(読み取りは 1 集約 1 回)', () => {
    const built = build(['widget.score']);

    expect(built.problems).toEqual([]);
    expect(built.operations[0]?.facts.reads).toHaveLength(1);
    expect(fieldsOf(built, 'widget')).toEqual(['score', 'state']);
  });

  it('別の集約の欄も積まれる(context で 1 段辿れる相手)', () => {
    const built = build(['gadget.label']);

    expect(built.problems).toEqual([]);
    expect(fieldsOf(built, 'gadget')).toEqual(['label']);
    expect(built.operations[0]?.facts.reads.find((read) => read.entity === 'gadget')?.idFrom).toEqual({
      kind: 'context',
      ref: 'widget.gadget_id',
    });
  });

  it('読めない集約を宣言しても計画は止まらない(黙って積まないだけ。報告するのは A19)', () => {
    const built = build(['orphan.note']);

    expect(built.problems).toEqual([]);
    expect(built.operations).toHaveLength(1);
    expect(fieldsOf(built, 'orphan')).toEqual([]);
  });
});
