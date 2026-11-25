/**
 * T9(トリガが供給する列は `supplied_by: db` を宣言する)のテスト。
 *
 * V17 は `supplied_by: db` の側から機構を見る。T9 はその逆で、data_table が
 * `triggers[].supplies` に載せた列が entity_spec でも「DB が決める値」と宣言しているかを見る ——
 * 片側にしか宣言が無いと、同じ列について「人が入れる値」と「DB が決める値」の 2 つの読みが
 * 同時に立つ。固定するのは 3 つ: 宣言していれば何も言わない / 宣言していなければ error /
 * 供給していない列には何も言わない。
 */

import { describe, expect, it } from 'vitest';
import { verifySuppliesDeclared } from '../../../../lib/data/verifiers/t9-supplies-declared.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import type { FieldDef, SpecModel } from '../../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 題材: 棚(shelf)。`company_id` は売場から写す列である。 */
function domain(suppliedBy: 'db' | undefined): SpecModel {
  const company: FieldDef = {
    ...field('company_id', { kind: 'ref', entity: 'company' }, { required: true }),
    ...(suppliedBy === undefined ? {} : { suppliedBy }),
  };
  return specModel(
    [
      aggregate('shelf', {
        entity: entitySpec('shelf', {
          context: { shelf: 'shelf.id' },
          fields: [field('id', { kind: 'uuid' }, { auto: true }), company],
        }),
      }),
    ],
    roleSpec([]),
  );
}

/** 写しの列をトリガが供給する data_table。 */
function tables(supplies: readonly string[]): readonly DataTableSpec[] {
  return [
    dataTable('shelves', {
      entity: 'shelf',
      triggers: [
        {
          name: 'sync_shelf_company',
          functionName: 'sync_shelf_company',
          fires: 'before insert or update of section_id',
          deferred: false,
          supplies: [...supplies],
          params: {},
          invariant: 'INV-SHELF-002',
        },
      ],
    }),
  ];
}

describe('T9 トリガが供給する列の宣言', () => {
  it('entity_spec が supplied_by: db を宣言していれば何も言わない', () => {
    expect(verifySuppliesDeclared(domain('db'), dataTableModel(tables(['company_id'])))).toEqual([]);
  });

  it('宣言していなければ error で両側の直し方を出す', () => {
    const findings = verifySuppliesDeclared(domain(undefined), dataTableModel(tables(['company_id'])));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T9');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('supplied_by: db を宣言していません');
    expect(findings[0]?.suggestion).toContain('supplies から外す');
    expect(findings[0]?.location.pointer).toBe('triggers.sync_shelf_company.supplies');
  });

  it('供給する列が無いトリガには何も言わない', () => {
    expect(verifySuppliesDeclared(domain(undefined), dataTableModel(tables([])))).toEqual([]);
  });
});
