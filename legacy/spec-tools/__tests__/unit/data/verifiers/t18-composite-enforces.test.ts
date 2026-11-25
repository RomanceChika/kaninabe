/**
 * T18(`composite` の関数が執行点になる規則の宣言)の規約網羅テスト。
 * 対象の要求(ADR-0014 / ARCH-SP-BE-0001 §テーブル仕様):
 *   `enforces` を書けるのは `kind: rpc` + `shape: composite` の関数だけ。名指す `writes` のエンティティと
 *   その `by` の規則が access_spec に実在し、`test_case` が**同じ表の** `test_cases` に実在すること。
 *   同じ規則を 2 つの宣言が名指ししない(執行点は 1 つ)。形の欠落・余計なキーはパーサー(T0)の仕事。
 * 題材は架空の「枠(slot)」— 一括の並べ替えが `composite` の手書き RPC で、by が 2 つある。
 */

import { describe, expect, it } from 'vitest';
import { verifyCompositeEnforces } from '../../../../lib/data/verifiers/t18-composite-enforces.js';
import type { DataFunctionDecl, DataFunctionEnforces, DataTableSpec } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { accessSpec, aggregate, entitySpec, field, role, specModel, writeRule } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel, dataTestCase } from '../../../helpers/data-builder.js';

/** `slot` が organizer / staff の 2 つの writes の規則を持つドメイン(`note` は writes を持たない)。 */
function domain(): SpecModel {
  return specModel({
    roles: [role('organizer'), role('staff'), role('member')],
    aggregates: [
      aggregate({
        name: 'slot',
        entity: entitySpec('slot', [field('position', { kind: 'integer' })]),
        access: accessSpec('slot', {
          writes: [writeRule('organizer', ['position'], 'true'), writeRule('staff', ['position'], 'true')],
        }),
      }),
      aggregate({
        name: 'note',
        entity: entitySpec('note', [field('body', { kind: 'text' })]),
        access: accessSpec('note', {}),
      }),
    ],
  });
}

/** 関数 1 本(`enforces` と形を差し替えられる)。 */
function fn(name: string, enforces: readonly DataFunctionEnforces[], over: Partial<DataFunctionDecl> = {}): DataFunctionDecl {
  return { name, args: [], params: [], kind: 'rpc', shape: 'composite', alsoWrites: [], enforces, ...over };
}

/** 見張りテストの宣言を持つ表(`TC-TABLE-SLOTS-001` / `-002`)。 */
function table(name: string, functions: readonly DataFunctionDecl[]): DataTableSpec {
  return dataTable(name, {
    entity: 'slot',
    functions,
    testCases: [dataTestCase('TC-TABLE-SLOTS-001', name), dataTestCase('TC-TABLE-SLOTS-002', name)],
  });
}

/** 指摘の文面。 */
function messages(tables: readonly DataTableSpec[]): readonly string[] {
  return verifyCompositeEnforces(domain(), dataTableModel(tables)).map((finding) => finding.message);
}

const ORGANIZER: DataFunctionEnforces = { writes: 'slot', by: 'organizer', testCase: 'TC-TABLE-SLOTS-001' };
const STAFF: DataFunctionEnforces = { writes: 'slot', by: 'staff', testCase: 'TC-TABLE-SLOTS-002' };

describe('T18 composite の enforces', () => {
  it('正しい宣言(規則ごとに見張りテストを名指す)は何も言わない', () => {
    expect(messages([table('slots', [fn('reorder_slots', [ORGANIZER, STAFF])])])).toEqual([]);
  });

  it('宣言が無い構成は何も言わない(enforces は任意)', () => {
    expect(messages([table('slots', [fn('reorder_slots', [])])])).toEqual([]);
  });

  it('data_table を読めない構成では何も言わない', () => {
    expect(verifyCompositeEnforces(domain(), { available: false, tables: [] })).toEqual([]);
  });

  it('(a) shape: update の関数に書くと error(未知キーの黙殺にしない)', () => {
    const found = messages([table('slots', [fn('update_slot', [ORGANIZER], { shape: 'update' })])]);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('shape: update なので enforces を宣言できません');
  });

  it('(a) kind: trigger の関数に書いても error', () => {
    const trigger: DataFunctionDecl = { name: 'check_slot', args: [], params: [], kind: 'trigger', alsoWrites: [], enforces: [ORGANIZER] };
    const found = messages([table('slots', [trigger])]);

    expect(found[0]).toContain('kind: trigger なので enforces を宣言できません');
  });

  it('(b) 存在しないエンティティを名指すと error(writes を持たないエンティティも同じ)', () => {
    const ghost = messages([table('slots', [fn('reorder_slots', [{ ...ORGANIZER, writes: 'ghost' }])])]);
    const noWrites = messages([table('slots', [fn('reorder_slots', [{ ...ORGANIZER, writes: 'note' }])])]);

    expect(ghost[0]).toContain('ghost');
    expect(ghost[0]).toContain('access_spec にありません');
    expect(noWrites[0]).toContain('note');
  });

  it('(b) writes に無い by を名指すと error(いまある by を案内する)', () => {
    const verdict = verifyCompositeEnforces(
      domain(),
      dataTableModel([table('slots', [fn('reorder_slots', [{ ...ORGANIZER, by: 'member' }])])]),
    );

    expect(verdict).toHaveLength(1);
    expect(verdict[0]?.message).toContain('by: member の規則がありません');
    expect(verdict[0]?.suggestion).toContain('organizer / staff');
  });

  it('(c) 見張りテストの id がその表の test_cases に無ければ error', () => {
    const found = messages([table('slots', [fn('reorder_slots', [{ ...ORGANIZER, testCase: 'TC-TABLE-SLOTS-099' }])])]);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('TC-TABLE-SLOTS-099');
    expect(found[0]).toContain('test_cases にありません');
  });

  it('(c) 別の表の test_cases にある id は数えない(見張りは同じ表のもの)', () => {
    const other = dataTable('others', { entity: 'note', testCases: [dataTestCase('TC-TABLE-OTHERS-001', 'others')] });
    const found = messages([
      table('slots', [fn('reorder_slots', [{ ...ORGANIZER, testCase: 'TC-TABLE-OTHERS-001' }])]),
      other,
    ]);

    expect(found).toHaveLength(1);
  });

  it('(d) 同じ規則を 2 つの関数が名指すと error(執行点は 1 つ。後から来た宣言に出す)', () => {
    const verdict = verifyCompositeEnforces(
      domain(),
      dataTableModel([table('slots', [fn('reorder_slots', [ORGANIZER]), fn('shuffle_slots', [ORGANIZER])])]),
    );

    expect(verdict).toHaveLength(1);
    expect(verdict[0]?.severity).toBe('error');
    expect(verdict[0]?.verifier).toBe('T18');
    expect(verdict[0]?.message).toContain('shuffle_slots と reorder_slots が両方名指ししています');
    expect(verdict[0]?.location.pointer).toBe('functions.shuffle_slots.enforces[0]');
  });

  it('(d) 規則が別なら 2 つの関数が分け合ってよい', () => {
    expect(
      messages([table('slots', [fn('reorder_slots', [ORGANIZER]), fn('shuffle_slots', [STAFF])])]),
    ).toEqual([]);
  });
});
