/**
 * V18(計算値の接地)の規約網羅テスト。
 * 対象の要求(action-spec-writing.md §computes):
 *   `computes` の欄は (a) その操作の `input` に無い (b) entity_spec に実在する
 *   (c) どの `writes` の規則にも並ばない(人の行でも内部実行の行でも) (d) `supplied_by: db` ではない。
 *
 * (c) は 2026-10-20 の裁定で裏返した —— **計算で決まる値は入力として受け付けない**。書いてよい根拠は
 * computes の宣言そのものであり、`writes` に並べると編集の RPC がその列を変更集合で受ける経路ができる。
 * 判定は **`computes` が名指しした集約**で引く(別の集約の同名の欄で外れない)。
 */

import { describe, expect, it } from 'vitest';
import { computesVerifier } from '../../../../lib/verify/verifiers/v18-computes.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/**
 * 枠(entry)の遷移 1 本と、人の編集規則 1 本を持つモデル。
 *
 * `slot_fee_amount` はどの `writes` にも並ばない欄(= 計算で決まる列)であり、`note` は人(staff)が
 * 書ける欄である。`code` は DB が決める欄。
 *
 * **別の集約 `seat`** を並べてある —— `fee_amount` はどの `writes` にも並ばない欄、`label` は
 * 人だけが書ける欄、`legacy` は内部実行の行だけが並べる欄である。
 */
const MODEL = specModel({
  aggregates: [
    aggregate({
      name: 'entry',
      entity: entitySpec('entry', [
        field('state', { kind: 'state', machine: 'entry' }, { required: true }),
        field('slot_fee_amount', { kind: 'integer' }),
        field('note', { kind: 'string' }),
        field('code', { kind: 'string' }, { suppliedBy: 'db' }),
      ]),
      stateMachines: [
        machine({
          machine: 'entry',
          states: ['draft', 'confirmed'],
          initial: 'draft',
          events: [event({ id: 'confirm', from: ['draft'], to: 'confirmed', by: ['staff'] })],
        }),
      ],
      access: accessSpec('entry', { writes: [writeRule('staff', ['note'])] }),
    }),
    aggregate({
      name: 'seat',
      entity: entitySpec('seat', [
        field('fee_amount', { kind: 'integer' }),
        field('label', { kind: 'string' }),
        field('legacy', { kind: 'integer' }),
      ]),
      access: accessSpec('seat', {
        writes: [writeRule('staff', ['label']), writeRule('system', ['legacy'])],
      }),
    }),
  ],
});

/** `computes` を宣言した action_spec 1 本だけを持つ文脈。 */
function ctx(init: { computes: Readonly<Record<string, string>>; input?: readonly string[] }): VerifyContext {
  return {
    guards: undefined as never,
    roots: TEST_ROOTS,
    actions: loadedInput({
      actions: [
        actionSpec({ handles: 'entry.confirm', input: init.input ?? [], computes: init.computes }),
      ],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    }),
    dataTables: UNSELECTED,
  };
}

describe('V18 計算値の接地', () => {
  it('どの writes にも並ばない欄なら通す(書いてよい根拠は computes の宣言そのもの)', () => {
    expect(computesVerifier.verify(MODEL, ctx({ computes: { 'entry.slot_fee_amount': 'slotFee' } }))).toEqual([]);
  });

  it('computes を 1 つも書いていない操作は見ない', () => {
    expect(computesVerifier.verify(MODEL, ctx({ computes: {} }))).toEqual([]);
  });

  it('entity_spec に無い欄は落とす', () => {
    const findings = computesVerifier.verify(MODEL, ctx({ computes: { 'entry.nowhere': 'x' } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('entity_spec に実在しません');
  });

  it('同じ操作の input にも現れる欄は落とす(人が入れると同時に計算はできない)', () => {
    const findings = computesVerifier.verify(
      MODEL,
      ctx({ computes: { 'entry.slot_fee_amount': 'slotFee' }, input: ['entry.slot_fee_amount'] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('input にも現れます');
  });

  it('supplied_by: db の欄は落とす(DB が決める値を計算し直さない)', () => {
    const findings = computesVerifier.verify(MODEL, ctx({ computes: { 'entry.code': 'code' } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('supplied_by: db');
  });

  it('人の writes に並ぶ欄は落とす(人が計算値を直に書ける形)', () => {
    const findings = computesVerifier.verify(MODEL, ctx({ computes: { 'entry.note': 'note' } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('人が計算で決まる値を直に書ける形');
    expect(findings[0]?.counterexample).toEqual({ action: 'entry.confirm', field: 'entry.note', writer: 'staff' });
  });

  it('by: system の writes に並ぶ欄も落とす(内部実行が編集の RPC で計算値を直に書ける形。以前の許しの裏返し)', () => {
    const findings = computesVerifier.verify(MODEL, ctx({ computes: { 'seat.legacy': 'seatLegacy' } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('内部実行が編集の RPC で計算値を直に書ける形');
  });

  it('別の集約の欄でも、どの writes にも並ばなければ通す(1 イベントで複数集約が動く形)', () => {
    expect(computesVerifier.verify(MODEL, ctx({ computes: { 'seat.fee_amount': 'seatFee' } }))).toEqual([]);
  });

  it('別の集約の欄で、その集約の人の writes に並べば落とす', () => {
    const findings = computesVerifier.verify(MODEL, ctx({ computes: { 'seat.label': 'seatLabel' } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('seat の access.md の writes(by: staff)');
  });

  it('同じ欄を並べた規則が 2 つあれば 2 件とも名指す(1 件目を直しただけで黙らない)', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'seat',
          entity: entitySpec('seat', [field('amount', { kind: 'integer' })]),
          access: accessSpec('seat', { writes: [writeRule('staff', ['amount']), writeRule('system', ['amount'])] }),
        }),
      ],
    });
    const findings = computesVerifier.verify(model, ctx({ computes: { 'seat.amount': 'seatAmount' } }));

    expect(findings.map((found) => found.counterexample?.['writer'])).toEqual(['staff', 'system']);
  });

  it('欄は集約ごとに引く(別の集約の同名の欄が writes に並んでいても、名指した集約が並べていなければ通す)', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec('entry', [field('amount', { kind: 'integer' })]),
          access: accessSpec('entry', { writes: [writeRule('staff', ['amount'])] }),
        }),
        aggregate({
          name: 'seat',
          entity: entitySpec('seat', [field('amount', { kind: 'integer' })]),
        }),
      ],
    });

    expect(computesVerifier.verify(model, ctx({ computes: { 'seat.amount': 'seatAmount' } }))).toEqual([]);
    expect(computesVerifier.verify(model, ctx({ computes: { 'entry.amount': 'entryAmount' } }))).toHaveLength(1);
  });
});

describe('V18 入力の状態(action_spec が未選択 / 阻害)', () => {
  const unknownField = { computes: { 'entry.nowhere': 'x' } };

  it('未選択でも阻害でも、計算値の判定は出さない(読込済みなら出る)。未選択は計算値が事実として無く、阻害は分からない', () => {
    expect(computesVerifier.verify(MODEL, ctx(unknownField))).toHaveLength(1);
    for (const actions of [UNSELECTED, blockedInput<never>('missing')]) {
      expect(computesVerifier.verify(MODEL, { ...ctx(unknownField), actions })).toEqual([]);
    }
  });
});

