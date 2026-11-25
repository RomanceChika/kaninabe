/**
 * data_table の `parity_accepts`(構造の突合の照らしの、理由と試験の ID つきの受け入れ。点検 26 回目 A26-1)の読み取りのユニットテスト。
 *
 * 規約網羅:
 *   - 3 つの照らし(invariant_edge / trigger_advisory / isolation_gate)が、表の宣言の欄として読めること(書かなければ欄ごと省く)
 *   - check は閉じた値域であること
 *   - invariant_edge は edge だけを、ほかは function だけを名指すこと(逆・欠けは落ちる)
 *   - invariant / test の形・空の reason・知らないキーは落ちること(行は採らない)
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseDataTableSpec } from '../../../../lib/model/data/parse-data-table.js';

/** 最小の表の宣言に parity_accepts を足したもの。 */
function data(accepts: unknown): Record<string, unknown> {
  return {
    doc_type: 'data_table',
    scope: 'backend',
    id: 'table-items',
    table: 'items',
    entity: 'item',
    ...(accepts === undefined ? {} : { parity_accepts: accepts }),
    test_cases: [{ id: 'TC-TABLE-ITEMS-001', type: 'integration', covers: ['success'], spec_ids: ['table-items', 'INV-ITEM-001'], implementation: 'a.test.ts::x' }],
  };
}

/** 読んだ結果(受け入れの欄と、parity_accepts の違反の文面)。 */
function parse(accepts: unknown): { readonly accepts: unknown; readonly errors: readonly string[] } {
  const result = parseDataTableSpec(data(accepts), 'items.md', new SpecReporter('docs/specs/backend/data/tables/items.md'));
  return {
    accepts: result.value?.parityAccepts,
    errors: result.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message),
  };
}

const EDGE = { check: 'invariant_edge', invariant: 'INV-ITEM-001', edge: 'update of parent_id', reason: '変える口が無い', test: 'TC-TABLE-ITEMS-001' };
const ADVISORY = { check: 'trigger_advisory', function: 'check_item_floor', invariant: 'INV-ITEM-001', reason: '鍵は 1 つ', test: 'TC-TABLE-ITEMS-001' };
const GATE = { check: 'isolation_gate', function: 'check_item_new', invariant: 'INV-ITEM-001', reason: 'NEW しか読まない', test: 'TC-TABLE-ITEMS-001' };

describe('parity_accepts の読み取り', () => {
  it('3 つの照らしの行が宣言の順に読める', () => {
    const parsed = parse([EDGE, ADVISORY, GATE]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.accepts).toEqual([EDGE, ADVISORY, GATE]);
  });

  it('書かなければ欄ごと省く(空の並びを持たせない)', () => {
    const parsed = parse(undefined);
    expect(parsed.errors).toEqual([]);
    expect(parsed.accepts).toBeUndefined();
  });

  it.each([
    ['check の値域の外', { ...EDGE, check: 'lock_order' }, 'check lock_order は値域'],
    ['invariant_edge が function を持つ', { ...EDGE, function: 'f' }, 'function は書けません'],
    ['invariant_edge に edge が無い', { check: 'invariant_edge', invariant: 'INV-ITEM-001', reason: 'r', test: 'TC-TABLE-ITEMS-001' }, 'edge がありません'],
    ['trigger_advisory が edge を持つ', { ...ADVISORY, edge: 'insert' }, 'edge は書けません'],
    ['isolation_gate に function が無い', { check: 'isolation_gate', invariant: 'INV-ITEM-001', reason: 'r', test: 'TC-TABLE-ITEMS-001' }, 'function がありません'],
    ['invariant の形が違う', { ...EDGE, invariant: 'table-items' }, '不変条件 ID の形'],
    ['test の形が違う', { ...EDGE, test: 'items-001' }, '試験の ID の形'],
    ['reason が空', { ...EDGE, reason: '  ' }, 'reason が空'],
    ['reason が無い', { check: 'invariant_edge', invariant: 'INV-ITEM-001', edge: 'insert', test: 'TC-TABLE-ITEMS-001' }, 'reason'],
  ])('%s は落ちて行を採らない', (_label, row, message) => {
    const parsed = parse([row]);
    expect(parsed.errors.some((error) => error.includes(message)), parsed.errors.join('\n')).toBe(true);
    expect(parsed.accepts).toBeUndefined();
  });

  it('知らないキーは落ちる(綴り違いの受け入れを黙って読まない)', () => {
    const parsed = parse([{ ...EDGE, tables: 'items' }]);
    expect(parsed.errors.some((error) => error.includes('tables'))).toBe(true);
  });

  it('関数名は識別子として読む(SQL の断片は通さない)', () => {
    const parsed = parse([{ ...ADVISORY, function: 'f; drop table items' }]);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.accepts).toBeUndefined();
  });
});
