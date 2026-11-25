/**
 * 状態ごとの「遷移が書き留めた欄」の姿(`eq-recorded.ts`)のユニットテスト。
 *
 * 一致の証明の置き直しは対象の行の状態を動かすので、その状態が要求する欄も一緒に置かなければ
 * 「状態 ⇔ 欄の有無」の不変条件が破れた行ができる。ここで見るのは、その材料が**宣言の写し**
 * であることである —— その状態へ入る遷移が書くなら値、空にするなら空、どちらもなければ空。
 */

import { describe, expect, it } from 'vitest';
import { RECORDED_AT, carriedStatesOf, recordedStatesOf } from '../../../lib/world/eq-recorded.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder.js';
import type { EventDef, SpecModel } from '../../../lib/model/types.js';

/** 文書(document)1 集約。`archived_at` は時刻、`archived_by` は実行者への参照である。 */
function domain(events: readonly EventDef[]): SpecModel {
  return specModel([
    aggregate('document', {
      entity: entitySpec('document', {
        label: '文書',
        context: { document: 'document.id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('state', { kind: 'state', machine: 'document' }),
          field('archived_at', { kind: 'datetime' }),
          field('archived_by', { kind: 'ref', entity: 'member' }),
        ],
      }),
      stateMachines: [
        machine('document', {
          states: ['drafting', 'circulating', 'archived'],
          initial: 'drafting',
          events,
        }),
      ],
    }),
  ]);
}

/** 保管が 2 欄を書き、復元が 2 欄を空に戻す機械。 */
const ARCHIVE_MACHINE: readonly EventDef[] = [
  event('circulate', { from: ['drafting'], to: 'circulating' }),
  event('archive', {
    from: ['circulating'],
    to: 'archived',
    recordsActor: ['archived_by'],
    recordsTime: ['archived_at'],
  }),
  event('restore', { from: ['archived'], to: 'circulating', clears: ['archived_at', 'archived_by'] }),
];

describe('状態ごとの書き留めた欄', () => {
  it('書き留める欄を 1 つも持たない機械では空である', () => {
    const plain = [event('circulate', { from: ['drafting'], to: 'circulating' })];

    expect(recordedStatesOf(domain(plain), 'document')).toEqual([]);
  });

  it('その状態へ入る遷移が書くなら、時刻は固定の値・参照は集約の名前で解決する', () => {
    const archived = recordedStatesOf(domain(ARCHIVE_MACHINE), 'document').find(
      (entry) => entry.state === 'archived',
    );

    expect(archived?.stateColumn).toBe('state');
    expect(archived?.columns).toEqual([
      { column: 'archived_by', value: null, entity: 'member' },
      { column: 'archived_at', value: RECORDED_AT, entity: null },
    ]);
  });

  it('空に戻す遷移で入る状態では空である(前の組み合わせの値を残さない)', () => {
    const circulating = recordedStatesOf(domain(ARCHIVE_MACHINE), 'document').find(
      (entry) => entry.state === 'circulating',
    );

    expect(circulating?.columns).toEqual([
      { column: 'archived_by', value: null, entity: null },
      { column: 'archived_at', value: null, entity: null },
    ]);
  });

  it('どの遷移も入らない状態(初期状態)でも列は並び、値は空である', () => {
    const drafting = recordedStatesOf(domain(ARCHIVE_MACHINE), 'document').find(
      (entry) => entry.state === 'drafting',
    );

    expect(drafting?.columns.map((column) => column.value)).toEqual([null, null]);
  });

  it('同じ状態へ入る遷移が複数あって片方だけが書くなら空に倒す', () => {
    const mixed: readonly EventDef[] = [
      event('archive', { from: ['circulating'], to: 'archived', recordsTime: ['archived_at'] }),
      // 書き留めずに同じ状態へ入る経路がある = 「その状態なら必ずある」とは言えない。
      event('import', { from: ['drafting'], to: 'archived' }),
    ];
    const archived = recordedStatesOf(domain(mixed), 'document').find((entry) => entry.state === 'archived');

    expect(archived?.columns).toEqual([{ column: 'archived_at', value: null, entity: null }]);
  });

  it('書かずに持ち越す遷移で入る状態も、遷移元が必ず持つなら値を置く(再開・完了の往復を含む)', () => {
    // 受付 → 対応中(書く)→ 完了(持ち越す)→ 対応中(持ち越す)。破棄は受付からも入る(持たない遷移元)。
    const handling: readonly EventDef[] = [
      event('start', { from: ['drafting'], to: 'circulating', recordsActor: ['archived_by'] }),
      event('finish', { from: ['circulating'], to: 'archived' }),
      event('reopen', { from: ['archived'], to: 'circulating' }),
    ];
    const byState = new Map(recordedStatesOf(domain(handling), 'document').map((entry) => [entry.state, entry.columns]));

    expect(byState.get('circulating')).toEqual([{ column: 'archived_by', value: null, entity: 'member' }]);
    expect(byState.get('archived')).toEqual([{ column: 'archived_by', value: null, entity: 'member' }]);
    expect(byState.get('drafting')).toEqual([{ column: 'archived_by', value: null, entity: null }]);
  });

  it.each([
    { label: '持たない遷移元から書かずに入る経路があれば持たない', extra: event('skip', { from: ['drafting'], to: 'archived' }), carried: ['circulating'] },
    { label: '持ち越す遷移が空にするなら持たない(その先も)', extra: event('reset', { from: ['circulating'], to: 'archived', clears: ['archived_by'] }), carried: ['circulating'] },
  ])('持ち越しの不動点: $label', ({ extra, carried }) => {
    const events: readonly EventDef[] = [
      event('start', { from: ['drafting'], to: 'circulating', recordsActor: ['archived_by'] }),
      event('finish', { from: ['circulating'], to: 'archived' }),
      extra,
    ];
    const machineSpec = domain(events).aggregates.get('document')?.stateMachines[0];
    expect(machineSpec).toBeDefined();
    if (machineSpec === undefined) return;
    expect([...carriedStatesOf(machineSpec, 'archived_by')].sort()).toEqual(carried);
  });
});
