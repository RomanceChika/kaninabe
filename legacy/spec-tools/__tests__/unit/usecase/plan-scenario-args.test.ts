/**
 * 場面が RPC に届くと期待する**名前つき引数**(`lib/usecase/plan-scenario-args.ts`。束 ⑰-3b)。
 *
 * 値の出どころは場面そのもの(実行者・行に載せた状態・作った入力)であり、計画から写すのは
 * 引数の名前と供給元の種別だけである。ここが固定するのはその写し方 —— 供給元の種別ごとに
 * 「どこから値を取るか」が 1 つに決まること、値が決まらない引数は持たないことである。
 */

import { describe, expect, it } from 'vitest';
import { expectedArgs } from '../../../lib/usecase/plan-scenario-args.js';
import type { ArgFacts } from '../../../lib/usecase/plan-scenario-args.js';
import type { ScenarioContext } from '../../../lib/usecase/plan-scenario-rows.js';
import type { ResolvedParam } from '../../../lib/usecase/param-source.js';

/** 遷移 1 本ぶんの最小の materials(このテストが見るのは 2 つの欄だけ)。 */
const CTX = {
  op: 'widget.send',
  event: { to: 'sent' },
  reads: [
    { entity: 'widget', table: 'widgets' },
    { entity: 'box', table: 'boxes' },
  ],
} as unknown as ScenarioContext;

/** 場面が用意した行と入力。 */
const FACTS: ArgFacts = {
  rows: [
    { table: 'widgets', id: 'w1', values: { state: 'draft' } },
    { table: 'boxes', id: 'b1', values: { state: 'open' } },
  ],
  input: { id: 'w1', note: 'めも', amount: 3 },
  actorId: 'a1',
};

/** 引数 1 本。 */
function param(name: string, source: ResolvedParam['source']): ResolvedParam {
  return { name, source };
}

describe('供給元ごとの値の取り方', () => {
  it('実行者・イベント・遷移先・副作用は場面と state_spec から決まる', () => {
    expect(
      expectedArgs(
        CTX,
        [
          param('p_actor_id', { kind: 'actor' }),
          param('p_event_id', { kind: 'event_id', event: 'widget.send' }),
          param('p_next_state', { kind: 'next_state', state: '(計画の写し)' }),
          param('p_effects', { kind: 'effects', effects: ['notify'] }),
        ],
        FACTS,
      ),
    ).toEqual({
      p_actor_id: 'a1',
      p_event_id: 'widget.send',
      // 計画が運ぶ値ではなく、state_spec のイベント宣言を読む。
      p_next_state: 'sent',
      p_effects: ['notify'],
    });
  });

  it('判断時の状態は、その集約の行に載せた値から取る(同名の列で取り違えない)', () => {
    expect(
      expectedArgs(
        CTX,
        [
          param('p_expected_state', { kind: 'expected_state', entity: 'widget', field: 'state', literal: null }),
          param('p_expected_box_state', { kind: 'expected_state', entity: 'box', field: 'state', literal: null }),
        ],
        FACTS,
      ),
    ).toEqual({ p_expected_state: 'draft', p_expected_box_state: 'open' });
  });

  it('入力から来る引数は場面の入力そのものになる', () => {
    expect(
      expectedArgs(
        CTX,
        [
          param('p_widget_id', { kind: 'input_target_id' }),
          param('p_note', { kind: 'input_field', field: 'note', type: { kind: 'string' } }),
          param('p_changes', {
            kind: 'input_changes',
            fields: [
              { name: 'amount', type: { kind: 'integer' }, label: 'a', description: 'a', location: { file: 'x', path: 'a' } },
            ],
          } as unknown as ResolvedParam['source']),
        ],
        FACTS,
      ),
    ).toEqual({ p_widget_id: 'w1', p_note: 'めも', p_changes: { amount: 3 } });
  });

  it('決めない列には空が届く', () => {
    expect(
      expectedArgs(CTX, [param('p_member_id', { kind: 'not_written', field: 'member_id', contract: 'cleared' })], FACTS),
    ).toEqual({ p_member_id: null });
  });

  it('呼び出しごとに変わる値(冪等キー・新しい id)は期待を持たない', () => {
    expect(
      expectedArgs(
        CTX,
        [param('p_id', { kind: 'new_id' }), param('p_key', { kind: 'idempotency_key' })],
        FACTS,
      ),
    ).toEqual({});
  });
});
