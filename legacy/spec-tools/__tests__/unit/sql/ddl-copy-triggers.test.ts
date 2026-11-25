/**
 * 祖先の列の写しを埋めるトリガの生成(`ddl-copy-triggers.ts`)のユニットテスト。
 *
 * 固定するのは 4 つである:
 *   - 1 段の写しは `select … from {親表} a1 where a1.id = new.{参照列}` になる
 *   - 2 段の写しは join でたどる(別名は `a1` / `a2`。最後の別名から列を取る)
 *   - `supplies` に 1 つでも導出できない列が混じったら**本文を出さない**(手書きと衝突する)
 *   - `fires` が表名まで書いている宣言では出さない(生成が `on {表}` を付ける)
 */

import { describe, expect, it } from 'vitest';
import { copyTriggersIn } from '../../../lib/sql/ddl-copy-triggers.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 参照の欄 1 本。 */
function ref(name: string, entity: string) {
  return field(name, { kind: 'ref', entity }, { required: true });
}

/** 題材: 会社 → 店舗 → 売場 → 棚 → 伝票 の木。 */
function domain(expr: string): SpecModel {
  return specModel(
    [
      aggregate('company', { entity: entitySpec('company', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }) }),
      aggregate('store', {
        entity: entitySpec('store', { fields: [field('id', { kind: 'uuid' }, { auto: true }), ref('company_id', 'company')] }),
      }),
      aggregate('section', {
        entity: entitySpec('section', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), ref('company_id', 'company'), ref('store_id', 'store')],
        }),
      }),
      aggregate('shelf', {
        entity: entitySpec('shelf', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), ref('company_id', 'company'), ref('section_id', 'section')],
        }),
      }),
      aggregate('stock_receipt', {
        entity: entitySpec('stock_receipt', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            ref('company_id', 'company'),
            ref('store_id', 'store'),
            ref('shelf_id', 'shelf'),
          ],
        }),
        invariants: invariantSpec([
          invariant({ id: 'INV-R-001', entities: ['stock_receipt'], formal: { kind: 'check', expr } }),
        ]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

/** 写しのトリガ 1 本。 */
function trigger(supplies: readonly string[], fires = 'before insert or update of shelf_id'): DataTriggerDecl {
  return {
    name: 'sync_stock_receipt_placement',
    functionName: 'sync_stock_receipt_placement',
    fires,
    deferred: false,
    supplies: [...supplies],
    params: {},
    invariant: 'INV-R-001',
  };
}

/** 伝票の表と、道にある表。 */
function tables(triggers: readonly DataTriggerDecl[]): readonly DataTableSpec[] {
  return [
    dataTable('companies', { entity: 'company' }),
    dataTable('stores', { entity: 'store' }),
    dataTable('sections', { entity: 'section' }),
    dataTable('shelves', { entity: 'shelf' }),
    dataTable('stock_receipts', { entity: 'stock_receipt', triggers: [...triggers] }),
  ];
}

/** 伝票の表のトリガ計画。 */
function planned(expr: string, triggers: readonly DataTriggerDecl[]) {
  const all = tables(triggers);
  const receipts = all[all.length - 1];
  return receipts === undefined ? [] : copyTriggersIn(receipts, domain(expr), all);
}

describe('祖先の列の写しのトリガ生成', () => {
  it('1 段の写しは親の表を 1 枚引くだけの本文になる', () => {
    const [copy] = planned('stock_receipt.company_id == shelf.company_id', [trigger(['company_id'])]);
    expect(copy?.function.body).toEqual([
      'select a1.company_id into new.company_id',
      'from public.shelves a1',
      'where a1.id = new.shelf_id;',
      'return new;',
    ]);
    expect(copy?.name).toBe('sync_stock_receipt_placement');
    expect(copy?.fires).toBe('before insert or update of shelf_id');
  });

  it('2 段の写しは join でたどる(最後の別名から列を取る)', () => {
    const [copy] = planned('stock_receipt.store_id == section.store_id', [trigger(['store_id'])]);
    expect(copy?.function.body).toEqual([
      'select a2.store_id into new.store_id',
      'from public.shelves a1',
      'join public.sections a2 on a2.id = a1.section_id',
      'where a1.id = new.shelf_id;',
      'return new;',
    ]);
  });

  it('複数の写しは 1 列 1 文で並ぶ(説明に写し元が全部出る)', () => {
    const [copy] = planned(
      'stock_receipt.company_id == shelf.company_id and stock_receipt.store_id == section.store_id',
      [trigger(['company_id', 'store_id'])],
    );
    expect(copy?.function.body.filter((line) => line.startsWith('select'))).toEqual([
      'select a1.company_id into new.company_id',
      'select a2.store_id into new.store_id',
    ]);
    expect(copy?.function.comment).toContain('company_id = shelf.company_id / store_id = section.store_id');
  });

  it('導出できない列が混じったら本文を出さない(手書きの本文と衝突する)', () => {
    expect(planned('stock_receipt.company_id == shelf.company_id', [trigger(['company_id', 'note'])])).toEqual([]);
  });

  it('値を供給しないトリガは対象外である', () => {
    expect(planned('stock_receipt.company_id == shelf.company_id', [trigger([])])).toEqual([]);
  });

  it('fires が表名まで書いていたら出さない(生成が on {表} を付ける)', () => {
    const plans = planned('stock_receipt.company_id == shelf.company_id', [
      trigger(['company_id'], 'before insert on stock_receipts'),
    ]);
    expect(plans).toEqual([]);
  });
});
