/**
 * 「祖先の列の写し」の判定(`copied-columns.ts`)のユニットテスト。
 *
 * この 1 本が world の組み立て(値を置かない)と表の DDL(トリガ本文を出す)の両方の根拠になる
 * ので、固定するのは**どこまでを写しと認めるか**の線である:
 *   - `{自集約}.{列} == {別の集約}.{列}` は写し(左右どちらに自集約が来ても同じ)
 *   - 道は参照列の連鎖でたどる(1 段でも 2 段でも)
 *   - 同じ長さの道が 2 本あれば**導出しない**(どちらの祖先から写すかが宣言から決まらない)
 *   - `formal` が無い / `check` でない / 自集約どうしの比較は写しではない
 *   - `and` で並べた複数の写しは全部解く
 *   - **解けなかった写しは黙って消えない**(理由つきで `unresolved` に出る)
 */

import { describe, expect, it } from 'vitest';
import { copiedColumnsOf, copyDeclarationsOf } from '../../../lib/world/copied-columns.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';

/** 参照の欄 1 本。 */
function ref(name: string, entity: string) {
  return field(name, { kind: 'ref', entity }, { required: true });
}

/**
 * 題材: 会社 → 店舗 → 売場 → 棚 → 伝票 の木。
 * 伝票は棚を指し、会社は 1 段(棚から)、店舗は 2 段(棚 → 売場)で届く。
 */
function domain(formal: string | undefined, extra: readonly ReturnType<typeof ref>[] = []): SpecModel {
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
            ...extra,
          ],
        }),
        invariants:
          formal === undefined
            ? invariantSpec([invariant({ id: 'INV-R-001', entities: ['stock_receipt'] })])
            : invariantSpec([
                invariant({ id: 'INV-R-001', entities: ['stock_receipt'], formal: { kind: 'check', expr: formal } }),
              ]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

describe('祖先の列の写しの判定', () => {
  it('1 段の写しを解く(自表の参照列をたどる)', () => {
    const copies = copiedColumnsOf(domain('stock_receipt.company_id == shelf.company_id'), 'stock_receipt', 'INV-R-001');
    expect(copies).toEqual([
      {
        column: 'company_id',
        fromEntity: 'shelf',
        fromColumn: 'company_id',
        path: [{ refColumn: 'shelf_id', entity: 'shelf' }],
      },
    ]);
  });

  it('2 段の写しを解く(棚 → 売場)', () => {
    const copies = copiedColumnsOf(domain('stock_receipt.store_id == section.store_id'), 'stock_receipt', 'INV-R-001');
    expect(copies[0]?.path).toEqual([
      { refColumn: 'shelf_id', entity: 'shelf' },
      { refColumn: 'section_id', entity: 'section' },
    ]);
  });

  it('and で並べた写しを全部解く', () => {
    const copies = copiedColumnsOf(
      domain('stock_receipt.company_id == shelf.company_id and stock_receipt.store_id == section.store_id'),
      'stock_receipt',
      'INV-R-001',
    );
    expect(copies.map((copy) => copy.column)).toEqual(['company_id', 'store_id']);
  });

  it('左右が逆でも同じ写しとして解く', () => {
    const copies = copiedColumnsOf(domain('shelf.company_id == stock_receipt.company_id'), 'stock_receipt', 'INV-R-001');
    expect(copies.map((copy) => [copy.column, copy.fromEntity])).toEqual([['company_id', 'shelf']]);
  });

  it('同じ長さの道が 2 本あれば導出しない(どちらの祖先から写すか決まらない)', () => {
    // 伝票に 2 本目の棚への参照を足すと、棚へ 1 段で届く道が 2 本になる。
    const copies = copiedColumnsOf(
      domain('stock_receipt.company_id == shelf.company_id', [ref('backup_shelf_id', 'shelf')]),
      'stock_receipt',
      'INV-R-001',
    );
    expect(copies).toEqual([]);
  });

  it('道が 2 本のときは「宣言はあるが解けない」として理由つきで残る(黙って消さない)', () => {
    const declarations = copyDeclarationsOf(
      domain('stock_receipt.company_id == shelf.company_id', [ref('backup_shelf_id', 'shelf')]),
      'stock_receipt',
      'INV-R-001',
    );
    expect(declarations.resolved).toEqual([]);
    expect(declarations.unresolved).toEqual([
      { column: 'company_id', fromEntity: 'shelf', fromColumn: 'company_id', reason: 'ambiguous' },
    ]);
  });

  it('参照列で届かない写し元は unreachable として残る', () => {
    // 伝票から「会社の親」のような存在しない集約へは、参照列をたどっても届かない。
    const declarations = copyDeclarationsOf(
      domain('stock_receipt.company_id == holding.company_id'),
      'stock_receipt',
      'INV-R-001',
    );
    expect(declarations.resolved).toEqual([]);
    expect(declarations.unresolved.map((copy) => [copy.column, copy.reason])).toEqual([
      ['company_id', 'unreachable'],
    ]);
  });

  it('形式定義が無い不変条件は写しを 1 つも宣言していない', () => {
    expect(copiedColumnsOf(domain(undefined), 'stock_receipt', 'INV-R-001')).toEqual([]);
  });

  it('宣言する不変条件が無ければ写しは無い', () => {
    expect(copiedColumnsOf(domain('stock_receipt.company_id == shelf.company_id'), 'stock_receipt', undefined)).toEqual([]);
  });

  it('自集約どうしの比較は写しではない', () => {
    expect(
      copiedColumnsOf(domain('stock_receipt.company_id == stock_receipt.store_id'), 'stock_receipt', 'INV-R-001'),
    ).toEqual([]);
  });

  it('等値でない比較は写しではない', () => {
    expect(copiedColumnsOf(domain('stock_receipt.company_id != shelf.company_id'), 'stock_receipt', 'INV-R-001')).toEqual([]);
  });
});
