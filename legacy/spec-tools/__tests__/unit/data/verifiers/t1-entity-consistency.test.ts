/**
 * T1(テーブル仕様 ⇔ ドメイン仕様の一貫性)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様):
 *   - entity が実在する entity_spec を指すこと
 *   - table が複数形化規則(+ entity_spec の table: 上書き)と一致すること
 *   - entity_spec があるのに data_table が無い欠落が落ちること
 *   - テーブル・関数の二重宣言が落ちること
 *   - トリガの関数が同じファイルに kind: trigger で帰属していること
 */

import { describe, expect, it } from 'vitest';
import { verifyEntityConsistency } from '../../../../lib/data/verifiers/t1-entity-consistency.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** entry と workshop の entity_spec を持つ最小ドメインモデル。 */
function domain() {
  return specModel([
    aggregate('entry', { entity: entitySpec('entry') }),
    aggregate('workshop', { entity: entitySpec('workshop') }),
  ]);
}

describe('T1: data_table ⇔ entity_spec の一貫性', () => {
  it('全 entity に正しい data_table が揃っていれば違反なし', () => {
    const tables = dataTableModel([
      dataTable('entries', { entity: 'entry' }),
      dataTable('workshops', { entity: 'workshop' }),
      dataTable('jobs', { internal: true }),
    ]);

    expect(verifyEntityConsistency(domain(), tables, TEST_ROOTS)).toEqual([]);
  });

  it('実在しない entity を指すとエラー', () => {
    const tables = dataTableModel([
      dataTable('entries', { entity: 'entryy' }),
      dataTable('workshops', { entity: 'workshop' }),
    ]);

    const findings = verifyEntityConsistency(domain(), tables, TEST_ROOTS);

    expect(findings.some((f) => f.message.includes('entryy'))).toBe(true);
  });

  it('テーブル名が複数形化規則から導いた名前と違うとエラー', () => {
    const tables = dataTableModel([
      dataTable('entry_rows', { entity: 'entry' }),
      dataTable('workshops', { entity: 'workshop' }),
    ]);

    const findings = verifyEntityConsistency(domain(), tables, TEST_ROOTS);

    expect(findings.some((f) => f.message.includes('entries'))).toBe(true);
  });

  it('entity_spec の table: 上書きがあればそちらが正になる', () => {
    const model = specModel([
      aggregate('entry', { entity: { ...entitySpec('entry'), table: 'entry_rows' } }),
    ]);
    const tables = dataTableModel([dataTable('entry_rows', { entity: 'entry' })]);

    expect(verifyEntityConsistency(model, tables, TEST_ROOTS)).toEqual([]);
  });

  it('entity_spec があるのに data_table が無いとエラー(specs 側の閉世界)', () => {
    const tables = dataTableModel([dataTable('entries', { entity: 'entry' })]);

    const findings = verifyEntityConsistency(domain(), tables, TEST_ROOTS);

    expect(findings.some((f) => f.message.includes('workshop に対応する data_table'))).toBe(true);
  });

  it('同じ関数を 2 つの表が帰属させるとエラー(閉世界の割り当てが割れる)', () => {
    const fn = { name: 'shared_fn', args: [], params: [], kind: 'rpc', alsoWrites: [] } as const;
    const tables = dataTableModel([
      dataTable('entries', { entity: 'entry', functions: [fn] }),
      dataTable('workshops', { entity: 'workshop', functions: [fn] }),
    ]);

    const findings = verifyEntityConsistency(domain(), tables, TEST_ROOTS);

    expect(findings.some((f) => f.message.includes('shared_fn'))).toBe(true);
  });

  it('トリガの関数が functions に kind: trigger で無いとエラー', () => {
    const tables = dataTableModel([
      dataTable('entries', {
        entity: 'entry',
        triggers: [{ name: 'check_x', functionName: 'check_x', deferred: false, supplies: [], params: {} }],
        functions: [{ name: 'check_x', args: [], params: [], kind: 'rpc', alsoWrites: [] }],
      }),
      dataTable('workshops', { entity: 'workshop' }),
    ]);

    const findings = verifyEntityConsistency(domain(), tables, TEST_ROOTS);

    expect(findings.some((f) => f.message.includes('kind: trigger'))).toBe(true);
  });

  it('kind: rpc の params が args と同じ長さなら通る', () => {
    const tables = dataTableModel([
      dataTable('entries', {
        entity: 'entry',
        functions: [
          {
            name: 'insert_entry',
            args: ['uuid', 'jsonb'],
            params: ['p_id', 'p_values'],
            kind: 'rpc',
            shape: 'create',
            alsoWrites: [],
          },
        ],
      }),
      dataTable('workshops', { entity: 'workshop' }),
    ]);

    expect(verifyEntityConsistency(domain(), tables, TEST_ROOTS)).toEqual([]);
  });

  it('params の数が args と違えばエラー(宣言し忘れもここで割れる)', () => {
    const tables = dataTableModel([
      dataTable('entries', {
        entity: 'entry',
        functions: [
          { name: 'insert_entry', args: ['uuid', 'jsonb'], params: [], kind: 'rpc', shape: 'create', alsoWrites: [] },
        ],
      }),
      dataTable('workshops', { entity: 'workshop' }),
    ]);

    const findings = verifyEntityConsistency(domain(), tables, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ function: 'insert_entry', params: '0', args: '2' });
  });

  it('p_ で始まらない引数名・重複した引数名はエラー', () => {
    const tables = dataTableModel([
      dataTable('entries', {
        entity: 'entry',
        functions: [
          {
            name: 'insert_entry',
            args: ['uuid', 'jsonb', 'uuid'],
            params: ['id', 'p_values', 'p_values'],
            kind: 'rpc',
            shape: 'create',
            alsoWrites: [],
          },
        ],
      }),
      dataTable('workshops', { entity: 'workshop' }),
    ]);

    const findings = verifyEntityConsistency(domain(), tables, TEST_ROOTS);

    expect(findings.some((f) => f.message.includes('p_ で始まる snake_case ではありません'))).toBe(true);
    expect(findings.some((f) => f.message.includes('重複しています'))).toBe(true);
  });

  it('kind: trigger / helper は params を持たない(空でも通る)', () => {
    const tables = dataTableModel([
      dataTable('entries', {
        entity: 'entry',
        functions: [{ name: 'check_x', args: [], params: [], kind: 'trigger', alsoWrites: [] }],
        triggers: [{ name: 'check_x', functionName: 'check_x', deferred: false, supplies: [], params: {} }],
      }),
      dataTable('workshops', { entity: 'workshop' }),
    ]);

    expect(verifyEntityConsistency(domain(), tables, TEST_ROOTS)).toEqual([]);
  });
});

describe('T1: 状態の欄の defaults(点検 12 回目 A12-1)', () => {
  const stateful = () =>
    specModel([
      aggregate('entry', { entity: entitySpec('entry', { fields: [field('state', { kind: 'state', machine: 'entry' }), field('note', { kind: 'string' })] }) }),
      aggregate('article', { entity: entitySpec('article') }),
    ]);
  const tables = (defaults: Readonly<Record<string, string>>) => dataTableModel([dataTable('entries', { entity: 'entry', defaults }), dataTable('articles', { entity: 'article' })]);

  it.each([
    { name: '初期状態と別の値', defaults: { state: "'paid'::text" } },
    { name: '初期状態と同じ値でも書かせない(片方を直した日に食い違いが戻る)', defaults: { state: "'draft'::text" } },
    { name: '読めない式', defaults: { state: "lower('PAID')" } },
  ])('赤: $name', ({ defaults }) => {
    expect(verifyEntityConsistency(stateful(), tables(defaults), TEST_ROOTS)).toEqual([
      expect.objectContaining({
        verifier: 'T1',
        severity: 'error',
        message: expect.stringContaining('状態機械 entry の initial を黙って上書きします'),
        location: expect.objectContaining({ pointer: 'defaults.state' }),
      }),
    ]);
  });

  it('緑: 状態でない欄の defaults と、entity を持たない表は見ない', () => {
    expect(verifyEntityConsistency(stateful(), tables({ note: "'x'::text" }), TEST_ROOTS)).toEqual([]);
    const internal = dataTableModel([...tables({}).tables, dataTable('jobs', { internal: true, defaults: { state: "'x'::text" } })]);
    expect(verifyEntityConsistency(stateful(), internal, TEST_ROOTS)).toEqual([]);
  });
});
