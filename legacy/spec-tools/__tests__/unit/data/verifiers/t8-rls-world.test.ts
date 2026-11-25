/**
 * T8(RLS の挙動テストの生成可否)のテスト。
 *
 * T8 は**生成しないことを報告する**検査器である —— 生成器が黙って飛ばすと「実行されていない表」が
 * 理由も無く増えるので、同じ判定(`rlsWorldCatalog`)から warning の Finding を出す。
 * したがってここで固定するのは 3 つ: 作れる表には何も言わない / 作れない表には理由つきで言う /
 * ポリシーを生成していない表は対象にしない。
 */

import { describe, expect, it } from 'vitest';
import { verifyRlsWorlds } from '../../../../lib/data/verifiers/t8-rls-world.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  read,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 題材: 本(book)と、実行者の集約 patron。 */
function domain(): SpecModel {
  return specModel(
    [
      aggregate('book', {
        entity: entitySpec('book', {
          context: { book: 'book.id' },
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('title', { kind: 'string' }, { required: true })],
        }),
        access: accessSpec('book', {
          reads: [
            read('anonymous', { kind: 'none' }),
            read('patron', { kind: 'all' }),
            read('system', { kind: 'all' }),
          ],
        }),
        invariants: invariantSpec([invariant({ id: 'INV-BOOK-001', entities: ['book'] })]),
      }),
      aggregate('patron', {
        entity: entitySpec('patron', {
          context: { patron: 'patron.id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('name', { kind: 'string' }, { required: true, session: true }),
          ],
        }),
      }),
    ],
    roleSpec([
      role('anonymous', undefined, undefined, 'anonymous'),
      role('patron', undefined, undefined, 'authenticated_default'),
      role('system', undefined, undefined, 'system'),
    ]),
  );
}

/** 本と利用者の 2 表(本だけがポリシーを生成する)。 */
function tables(extra: Partial<DataTableSpec> = {}): readonly DataTableSpec[] {
  return [
    dataTable('books', { entity: 'book', policiesMigration: '20260101000001_policies_books.sql', ...extra }),
    dataTable('patrons', { entity: 'patron' }),
  ];
}

describe('T8 RLS の挙動テストの生成可否', () => {
  it('world を作れる表には何も言わない', () => {
    expect(verifyRlsWorlds(domain(), dataTableModel(tables()))).toEqual([]);
  });

  it('作れない表は warning で理由を報告する(場所は policies_migration)', () => {
    const findings = verifyRlsWorlds(
      domain(),
      dataTableModel(
        tables({
          triggers: [
            {
              name: 'check_book_title',
              functionName: 'check_book_title',
              fires: 'before insert on books',
              deferred: false,
              supplies: [],
              params: {},
              invariant: 'INV-BOOK-001',
            },
          ],
        }),
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T8');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('形式定義(formal)を持たない');
    expect(findings[0]?.location.pointer).toBe('policies_migration');
    expect(findings[0]?.suggestion).toContain('手書きの RLS テスト');
  });

  it('ポリシーを生成していない表(policies_migration が無い)は対象にしない', () => {
    const withoutPolicies = [
      dataTable('books', { entity: 'book' }),
      dataTable('patrons', { entity: 'patron' }),
    ];
    expect(verifyRlsWorlds(domain(), dataTableModel(withoutPolicies))).toEqual([]);
  });
});
