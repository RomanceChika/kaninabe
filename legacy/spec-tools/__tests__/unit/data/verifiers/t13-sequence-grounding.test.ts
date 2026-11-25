/**
 * T13(採番の器の接地)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様の `sequences`):
 *   - `defaults` の `nextval('{名前}')` が名指す器が宣言されていること(無ければ error)
 *   - 宣言した器をどの列も名指していないこと(誰も使わなければ warning)
 *   - 名指しは**表をまたいで**照合すること(連番を共有する列が別の表にあることは起こる)
 *   - `pg_get_expr` の印字(スキーマ修飾・`::regclass`)でも同じ名前として照合できること
 *   - **同じ名前を 2 表が宣言したら error**(宣言は 1 か所。`if not exists` が食い違いを黙らせる)
 *   - `start` が整数でないは error(生成 SQL が構文エラーになる)
 */

import { describe, expect, it } from 'vitest';
import { verifySequenceGrounding } from '../../../../lib/data/verifiers/t13-sequence-grounding.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

describe('T13 採番の器の接地', () => {
  it('宣言された器を名指していれば健全', () => {
    const findings = verifySequenceGrounding(
      dataTableModel([
        dataTable('bookings', {
          entity: 'booking',
          sequences: [{ name: 'bookings_reference_seq' }],
          defaults: { reference_no: "('BK-'::text || nextval('bookings_reference_seq'))" },
        }),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('名指した器の宣言が無ければ error(空の DB に当たらない)', () => {
    const findings = verifySequenceGrounding(
      dataTableModel([
        dataTable('bookings', {
          entity: 'booking',
          defaults: { reference_no: "nextval('bookings_reference_seq')" },
        }),
      ]),
    );
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T13', 'error']]);
    expect(findings[0]?.message).toContain('bookings_reference_seq');
  });

  it('宣言したのに誰も名指さなければ warning(誰も読まない器が DB に残る)', () => {
    const findings = verifySequenceGrounding(
      dataTableModel([dataTable('bookings', { entity: 'booking', sequences: [{ name: 'unused_seq' }] })]),
    );
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T13', 'warning']]);
    expect(findings[0]?.message).toContain('unused_seq');
  });

  it('別の表が宣言した器でも名指しは通る(連番は表をまたいで共有できる)', () => {
    const findings = verifySequenceGrounding(
      dataTableModel([
        dataTable('bookings', { entity: 'booking', defaults: { no: "nextval('shared_seq')" } }),
        dataTable('rooms', { entity: 'room', sequences: [{ name: 'shared_seq' }] }),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('スキーマ修飾と ::regclass が付いた印字でも同じ器として照合する', () => {
    const findings = verifySequenceGrounding(
      dataTableModel([
        dataTable('bookings', {
          entity: 'booking',
          sequences: [{ name: 'bookings_reference_seq', start: 1000 }],
          defaults: { reference_no: "nextval('public.bookings_reference_seq'::regclass)" },
        }),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('同じ名前を 2 表が宣言したら error(start が一致していても)', () => {
    const findings = verifySequenceGrounding(
      dataTableModel([
        dataTable('bookings', {
          entity: 'booking',
          sequences: [{ name: 'shared_seq', start: 1 }],
          defaults: { no: "nextval('shared_seq')" },
        }),
        dataTable('rooms', { entity: 'room', sequences: [{ name: 'shared_seq', start: 1 }] }),
      ]),
    );
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T13', 'error']]);
    expect(findings[0]?.message).toContain('2 つの表が宣言しています');
  });

  it('start が整数でなければ error(生成 SQL の start with が構文エラーになる)', () => {
    const findings = verifySequenceGrounding(
      dataTableModel([
        dataTable('bookings', {
          entity: 'booking',
          sequences: [{ name: 'a_seq', start: 1.5 }],
          defaults: { no: "nextval('a_seq')" },
        }),
      ]),
    );
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T13', 'error']]);
    expect(findings[0]?.message).toContain('start が整数ではありません');
  });
});
