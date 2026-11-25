/**
 * 宣言した不変条件の条件を本文と照らせる語に割る(`trigger-condition-words.ts`。点検 20 回目の後の P3)のユニットテスト。
 *
 * 固定するのは: 前提と課す条件の分け方(state_dependency / cardinality / check)・列挙と状態の欄と比べた記号だけを拾うこと
 * (真偽・数・null・欄どうしの比較は拾わない)・参照の欄を辿ること・範囲の語(表の集約・参照先・不変条件の集約)・
 * 真偽・数・null・欄どうしの比較の欄は名前を列として運ぶこと(点検 21 回目 C21-4)・照らせない場合は理由つきで返すこと
 * (不変条件を名指さないトリガだけが null)。
 */

import { describe, expect, it } from 'vitest';
import { conditionWordsOf, type TriggerConditionWords } from '../../../lib/sql/trigger-condition-words.js';
import { T17_REASONS } from '../../../lib/data/check-reasons.js';
import type { DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, machine, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 題材: 催し(状態)・枠(状態と種別。催しを参照)・演目(枠と催しを参照)・関係の無い集約(メンバー)。 */
/** 題材(`formal` が文字列なら形式定義の代わりに DSL の外である理由 `formal_outside` を書く)。 */
function domain(formal: InvariantFormal | string | undefined, entities: readonly string[] = ['item', 'slot']): SpecModel {
  return specModel([
    aggregate('show', {
      entity: entitySpec('show', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'show' })] }),
      stateMachines: [machine('show', { states: ['planning', 'published'], initial: 'planning' })],
    }),
    aggregate('slot', {
      entity: entitySpec('slot', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('state', { kind: 'state', machine: 'slot' }),
          field('kind', { kind: 'enum', values: ['play', 'listen'] }),
          field('paid', { kind: 'boolean' }),
          field('show_id', { kind: 'ref', entity: 'show' }),
        ],
      }),
      stateMachines: [machine('slot', { states: ['draft', 'confirmed'], initial: 'draft' })],
    }),
    aggregate('person', {
      entity: entitySpec('person', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('role', { kind: 'enum', values: ['guest', 'host'] })] }),
    }),
    aggregate('item', {
      entity: entitySpec('item', {
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('slot_id', { kind: 'ref', entity: 'slot' }), field('show_id', { kind: 'ref', entity: 'show' }), field('count', { kind: 'integer' })],
      }),
      invariants: invariantSpec([invariant({ id: 'INV-ITEM-001', entities, ...(formal === undefined ? {} : typeof formal === 'string' ? { formalOutside: formal } : { formal }) })]),
    }),
  ]);
}

function trigger(invariantId: string | null = 'INV-ITEM-001'): DataTriggerDecl {
  return { name: 'check_item', functionName: 'check_item', fires: 'before insert on items', deferred: false, supplies: [], params: {}, ...(invariantId === null ? {} : { invariant: invariantId }) };
}

const TABLE = dataTable('items', { entity: 'item', triggers: [trigger()] });

/** 範囲(表の集約 item・参照先 slot と show・不変条件の集約。メンバーは入らない)。 */
const VOCABULARY = ['confirmed', 'draft', 'listen', 'planning', 'play', 'published'];

/** 読めた結果だけを取り出す(照らせない・名指さないなら失敗)。 */
function read(result: ReturnType<typeof conditionWordsOf>): TriggerConditionWords {
  if (result === null || result.unreadable !== null) throw new Error(`読めない: ${JSON.stringify(result)}`);
  return result;
}

describe('conditionWordsOf', () => {
  it('state_dependency: 前提は if、課す条件は then', () => {
    expect(conditionWordsOf(trigger(), TABLE, domain({ kind: 'state_dependency', if: 'show.state == published', then: 'slot.state == confirmed' }))).toEqual({
      invariant: 'INV-ITEM-001',
      unreadable: null,
      premiseColumns: [],
      requiresColumns: [],
      // 催しの状態は値が 2 つなので言い換え(補集合)を持つ。
      premise: [['published', 'planning']],
      requires: [['confirmed', 'draft']],
      vocabulary: VOCABULARY,
    });
  });

  it('check: 前提なし、課す条件は expr(状態と列挙。in と not と or も辿る)', () => {
    const words = read(conditionWordsOf(trigger(), TABLE, domain({ kind: 'check', expr: 'not slot.kind == listen or slot.state in [draft, confirmed]' })));
    expect(words.premise).toEqual([]);
    expect(words.requires).toEqual([['confirmed', 'draft'], ['draft', 'confirmed'], ['listen', 'play']]);
    expect(words.requiresColumns).toEqual([]);
  });

  it('cardinality: 前提は where、課す条件の列は数える鍵と上限の欄', () => {
    const words = read(conditionWordsOf(trigger(), TABLE, domain({ kind: 'cardinality', keys: ['slot_id'], max: 'slot.capacity', where: 'slot.kind == listen' })));
    expect(words.premise).toEqual([['listen', 'play']]);
    expect(words.requires).toEqual([]);
    expect(words.requiresColumns).toEqual(['capacity', 'slot_id']);
    // 上限が数なら鍵だけ。
    expect(read(conditionWordsOf(trigger(), TABLE, domain({ kind: 'cardinality', keys: ['slot_id'], max: 3 }))).requiresColumns).toEqual(['slot_id']);
  });

  it('真偽・数・null・欄どうしの比較は語にせず、欄の名前を列として運ぶ(列挙の値に無い記号の比較も欄で照らす)', () => {
    const words = read(conditionWordsOf(trigger(), TABLE, domain({ kind: 'check', expr: 'slot.paid == true and item.count > 0 and item.show_id == slot.show_id and slot.state != nowhere and item.slot_id is not null' })));
    expect(words.requires).toEqual([]);
    expect(words.requiresColumns).toEqual(['count', 'paid', 'show_id', 'slot_id', 'state']);
  });

  it('前提の真偽の欄は前提の列に入る(前提を本文が落とせば照らしが赤にする。C21-4)', () => {
    const words = read(conditionWordsOf(trigger(), TABLE, domain({ kind: 'state_dependency', if: 'slot.paid == true', then: 'slot.state == confirmed' })));
    expect(words.premise).toEqual([]);
    expect(words.premiseColumns).toEqual(['paid']);
    expect(words.requires).toEqual([['confirmed', 'draft']]);
  });

  it('参照の欄を辿る(item.slot_id.state → 枠の状態)', () => {
    expect(read(conditionWordsOf(trigger(), TABLE, domain({ kind: 'check', expr: 'item.slot_id.state == confirmed' }))).requires).toEqual([['confirmed', 'draft']]);
  });

  it('範囲に不変条件が名指す集約の値も入る', () => {
    expect(read(conditionWordsOf(trigger(), TABLE, domain({ kind: 'check', expr: 'slot.state == confirmed' }, ['item', 'person']))).vocabulary).toEqual([...VOCABULARY, 'guest', 'host'].sort());
  });

  it('不変条件を名指さないトリガだけが null(照らす相手が無い)', () => {
    expect(conditionWordsOf(trigger(null), TABLE, domain({ kind: 'check', expr: 'slot.state == confirmed' }))).toBeNull();
  });

  it.each<[string, DataTriggerDecl, InvariantFormal | string | undefined, string]>([
    ['名指した不変条件が無い', trigger('INV-NONE-001'), { kind: 'check', expr: 'slot.state == confirmed' }, T17_REASONS.conditionMissingInvariant],
    ['形式定義も DSL の外である理由も無い(書けるのに書いていないと区別できない。点検 22 回目 C22-3)', trigger(), undefined, T17_REASONS.conditionFormalMissing],
    ['一意(語に割れない種類)', trigger(), { kind: 'uniqueness', keys: ['slot_id'] }, T17_REASONS.conditionKindOutside],
    ['読めない式', trigger(), { kind: 'check', expr: 'slot.state ==' }, T17_REASONS.conditionUnparsable],
    ['語も列も無い(予約語の 1 語のパスだけ)', trigger(), { kind: 'check', expr: 'now == now' }, T17_REASONS.conditionNoWords],
  ])('照らせない(理由つき。黙って外さない): %s', (_name, decl, formal, reason) => {
    expect(conditionWordsOf(decl, TABLE, domain(formal))).toEqual({ invariant: decl.invariant, unreadable: reason });
  });

  it('形式定義が無く DSL の外である理由(formal_outside)を宣言した不変条件だけが、仕組みの宿題の理由になり理由を運ぶ(点検 22 回目 C22-3)', () => {
    expect(conditionWordsOf(trigger(), TABLE, domain('件数の下限で、cardinality は上限だけを言う'))).toEqual({
      invariant: 'INV-ITEM-001',
      unreadable: T17_REASONS.conditionNoFormal,
      outside: '件数の下限で、cardinality は上限だけを言う',
    });
  });
});
