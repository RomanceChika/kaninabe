/**
 * ガード変数の軸(lib/world/eq-placements.ts の `guardAxes`)のテスト。
 *
 * 行の参照・uuid の列は軸にしない(候補の記号 'a' / 'b' を uuid の列へ置けない。参照の先は world の木が決める)。
 * 作成の入力へ置く参照の欄と、記号が置ける型の列は従来どおり軸になる。
 */

import { describe, expect, it } from 'vitest';
import { guardAxes } from '../../../lib/world/eq-placements.js';
import { specModel } from '../../helpers/model-builder-v8plus.js';
import type { FieldType } from '../../../lib/model/types.js';
import type { ScenarioVariableRef } from '../../../lib/usecase/plan-scenario-rows.js';

/** 変数 1 本(`{集約}.{列}`)。 */
function variable(ref: string, type: FieldType | null, states: readonly string[] = []): ScenarioVariableRef {
  return { key: ref, ref, type, states, bounds: {} };
}

const COMPANY: FieldType = { kind: 'ref', entity: 'company' };

describe('guardAxes — 行へ置く軸の型による振り分け', () => {
  const ROWS: readonly { readonly name: string; readonly type: FieldType; readonly axis: boolean }[] = [
    { name: '参照(行の外部キー)', type: COMPANY, axis: false },
    { name: 'uuid', type: { kind: 'uuid' }, axis: false },
    { name: '文字列', type: { kind: 'string' }, axis: true },
    { name: 'boolean', type: { kind: 'boolean' }, axis: true },
    { name: 'enum', type: { kind: 'enum', values: ['x', 'y'] }, axis: true },
  ];

  for (const row of ROWS) {
    it(`行の列(${row.name}): 軸${row.axis ? 'になる' : 'にしない(world の木が参照の先を決める)'}`, () => {
      const axes = guardAxes({
        domain: specModel({}),
        variables: [variable('parent.col', row.type)],
        excluded: [],
        inputEntity: null,
        seeds: [],
      });

      expect(axes.length).toBe(row.axis ? 1 : 0);
    });
  }

  it('作成の入力へ置く参照の欄は軸になる(入力の記号は RPC の権限の判定が先に読む)', () => {
    const axes = guardAxes({
      domain: specModel({}),
      variables: [variable('child.parent_id', COMPANY)],
      excluded: [],
      inputEntity: 'child',
      seeds: [],
    });

    expect(axes).toHaveLength(1);
    expect(axes[0]?.values.map((value) => value.placements[0]?.into)).toEqual(['input', 'input']);
    expect(axes[0]?.values.map((value) => value.label)).toEqual(['a', 'b']);
  });

  it('同じ列でも、入力の集約の列は軸・親の集約の列(行)は軸にしない', () => {
    const axes = guardAxes({
      domain: specModel({}),
      variables: [variable('child.parent_id', COMPANY), variable('parent.company_id', COMPANY)],
      excluded: [],
      inputEntity: 'child',
      seeds: [],
    });

    expect(axes.map((axis) => axis.key)).toEqual(['child.parent_id']);
  });
});
