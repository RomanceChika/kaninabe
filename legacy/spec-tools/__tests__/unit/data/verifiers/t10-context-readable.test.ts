/**
 * T10(`context(X)` を与えるロールは X も読める)のテスト。
 *
 * 製品と 4 題材には**破れた実例が無い**(文脈依存ロールが `implies` で既定のログインロールを
 * 含み、そのロールが中継表を全件読める)。だから破れた宣言はここで作って固定する —— 実例が
 * 無い検査は、書いたつもりで何も見ていないことがある。
 *
 * 固定するのは 4 つ: 直接読めるなら言わない / `implies` で読めるなら言わない /
 * `none` なら warning / `context` でない scope には言わない。
 */

import { describe, expect, it } from 'vitest';
import { verifyContextReadable } from '../../../../lib/data/verifiers/t10-context-readable.js';
import type { ReadScope, SpecModel } from '../../../../lib/model/types.js';
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
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 中継の受け手(シート)の scope と、中継表(催し)が世話役に与える scope を振る。 */
interface Options {
  /** シートが世話役に与える読み取り(既定は `context(workshop)`)。 */
  readonly sheetScope?: ReadScope;
  /** 催しが世話役に与える読み取り(既定は `none` = 破れた宣言)。 */
  readonly workshopByOrganizer?: ReadScope;
  /** 催しがメンバーに与える読み取り(世話役は implies でメンバーである)。 */
  readonly workshopByMember?: ReadScope;
}

/** 題材: 催し(workshop)を中継してシート(sheet)を見る世話役(organizer)。 */
function domain(options: Options = {}): SpecModel {
  return specModel(
    [
      aggregate('sheet', {
        entity: entitySpec('sheet', {
          context: { sheet: 'sheet.id', workshop: 'sheet.workshop_id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('workshop_id', { kind: 'ref', entity: 'workshop' }, { required: true }),
          ],
        }),
        access: accessSpec('sheet', {
          reads: [read('organizer', options.sheetScope ?? { kind: 'context', entity: 'workshop' })],
        }),
      }),
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          context: { workshop: 'workshop.id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('organizer_id', { kind: 'ref', entity: 'member' }, { required: true }),
          ],
        }),
        access: accessSpec('workshop', {
          reads: [
            read('organizer', options.workshopByOrganizer ?? { kind: 'none' }),
            read('member', options.workshopByMember ?? { kind: 'none' }),
          ],
        }),
      }),
      aggregate('member', {
        entity: entitySpec('member', {
          context: { member: 'member.id' },
          fields: [field('id', { kind: 'uuid' }, { auto: true })],
        }),
      }),
    ],
    roleSpec([
      role('member', undefined, undefined, 'authenticated_default'),
      role('organizer', 'workshop.organizer_id == actor.id', ['member']),
    ]),
  );
}

/** シートだけがポリシーを生成する 2 表。 */
function tables(): ReturnType<typeof dataTableModel> {
  return dataTableModel([
    dataTable('sheets', { entity: 'sheet', policiesMigration: '20260101000001_policies_sheets.sql' }),
    dataTable('workshops', { entity: 'workshop', policiesMigration: '20260101000002_policies_workshops.sql' }),
  ]);
}

describe('T10 context(X) の中継表が読めること', () => {
  it('中継表を読めない宣言は warning で「行が 1 つも返らない」ことを報告する', () => {
    const findings = verifyContextReadable(domain(), tables());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T10');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('1 行も返りません');
    expect(findings[0]?.counterexample?.['relay']).toBe('workshop');
  });

  it('そのロール自身が中継表を読めるなら言わない', () => {
    expect(verifyContextReadable(domain({ workshopByOrganizer: { kind: 'own' } }), tables())).toEqual([]);
  });

  it('implies で必ず持つロールが読めるなら言わない(題材の製品がこの形である)', () => {
    expect(verifyContextReadable(domain({ workshopByMember: { kind: 'all' } }), tables())).toEqual([]);
  });

  it('context でない scope には言わない', () => {
    expect(verifyContextReadable(domain({ sheetScope: { kind: 'all' } }), tables())).toEqual([]);
  });
});
