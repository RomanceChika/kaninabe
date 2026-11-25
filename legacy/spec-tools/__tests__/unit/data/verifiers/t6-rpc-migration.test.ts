/**
 * T6(定型 RPC の本文の出どころ)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §書き込み RPC の形 / migrations.md §生成 migration):
 *   - 定型 5 形は `migration`(生成物)か `handwritten`(理由つきの手書き)の**どちらか一方**
 *   - `shape: composite` はどちらも宣言できない
 *   - `migration` は `{14 桁}_rpc_{関数名}.sql` の形で、全 data_table を通して一意
 *   - **生成の前提**(表が entity を持つ / 引数の役目が規約から決まる / 条件にする集約まで
 *     参照が辿れる)—— 生成器が `preconditionFailure('T6')` で報告する前提を、verify の段で落とす
 */

import { describe, expect, it } from 'vitest';
import { verifyRpcMigration } from '../../../../lib/data/verifiers/t6-rpc-migration.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../../helpers/model-builder.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';

/** 予約(booking)と会議室(room)の 2 集約(rpc-body.test.ts と同じ題材)。 */
function domain(): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('room_id', { kind: 'ref', entity: 'room' }, { required: true }),
          field('state', { kind: 'state', machine: 'booking' }),
          field('purpose', { kind: 'string' }, { required: true }),
        ],
      }),
      stateMachines: [
        machine('booking', { states: ['held', 'done'], initial: 'held', events: [event('finish', { from: ['held'], to: 'done' })] }),
      ],
    }),
    aggregate('room', {
      entity: entitySpec('room', {
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'room' })],
      }),
      stateMachines: [
        machine('room', { states: ['open', 'closed'], initial: 'open', events: [event('close', { from: ['open'], to: 'closed' })] }),
      ],
    }),
  ]);
}

/** 定型の作成 RPC 1 本(既定は健全 = 生成物を宣言する)。`migration: null` で宣言を落とす。 */
function fn(
  overrides: Omit<Partial<DataFunctionDecl>, 'migration'> & { readonly migration?: string | null } = {},
): DataFunctionDecl {
  const { migration: declared, ...rest } = overrides;
  const migration = declared === undefined ? '20260912000001_rpc_insert_booking.sql' : declared;
  return {
    name: 'insert_booking',
    args: ['uuid', 'jsonb', 'uuid'],
    params: ['p_id', 'p_values', 'p_actor_id'],
    kind: 'rpc',
    shape: 'create',
    alsoWrites: [],
    ...rest,
    ...(migration === null ? {} : { migration }),
  };
}

/** その関数だけを持つ 1 表のモデル(会議室の表も並べる = 条件にする集約の表名が引ける)。 */
function model(...functions: readonly DataFunctionDecl[]) {
  return dataTableModel([
    dataTable('bookings', { entity: 'booking', functions }),
    dataTable('rooms', { entity: 'room' }),
  ]);
}

/** 指摘の文面(先頭 1 件)。 */
function messages(findings: readonly { readonly message: string }[]): readonly string[] {
  return findings.map((finding) => finding.message);
}

describe('T6 定型 RPC の本文の出どころ', () => {
  it('生成物を宣言する定型 RPC は健全', () => {
    expect(verifyRpcMigration(domain(), model(fn()))).toEqual([]);
  });

  it('理由つきの手書きを宣言する定型 RPC は健全', () => {
    const declared = fn({ migration: null, handwritten: 'DSL 外の不変条件の連鎖を本文が持つ' });
    expect(verifyRpcMigration(domain(), model(declared))).toEqual([]);
  });

  it('どちらも宣言しない定型 RPC は落ちる', () => {
    const findings = verifyRpcMigration(domain(), model(fn({ migration: null })));
    expect(messages(findings)).toEqual([
      'insert_booking は定型 create ですが本文の出どころ(migration / handwritten)の宣言がありません',
    ]);
  });

  it('両方を宣言する定型 RPC は落ちる(本文の正が 2 つになる)', () => {
    const findings = verifyRpcMigration(domain(), model(fn({ handwritten: '念のため' })));
    expect(messages(findings)).toEqual(['insert_booking が migration と handwritten の両方を宣言しています']);
  });

  it('composite が出どころを宣言すると落ちる(本文は最初から手書きである)', () => {
    const findings = verifyRpcMigration(domain(), model(fn({ shape: 'composite' })));
    expect(messages(findings)).toEqual([
      'insert_booking は shape: composite なので migration を宣言できません',
    ]);
  });

  it('関数名から導けない migration は落ちる', () => {
    const findings = verifyRpcMigration(domain(), model(fn({ migration: '20260912000001_insert_booking.sql' })));
    expect(messages(findings)).toEqual([
      'migration 20260912000001_insert_booking.sql が関数 insert_booking から導かれる名前になっていません',
    ]);
  });

  it('連番が 14 桁でない migration は落ちる', () => {
    const findings = verifyRpcMigration(domain(), model(fn({ migration: '1_rpc_insert_booking.sql' })));
    expect(messages(findings)).toEqual([
      'migration 1_rpc_insert_booking.sql が関数 insert_booking から導かれる名前になっていません',
    ]);
  });

  it('同じ migration を 2 本が取り合うと落ちる', () => {
    const second = fn({ name: 'delete_booking', shape: 'delete' });
    const findings = verifyRpcMigration(domain(), model(fn(), second));
    expect(messages(findings)).toContain(
      'migration 20260912000001_rpc_insert_booking.sql が insert_booking と重複しています',
    );
  });

  // --- 生成の前提(生成器が preconditionFailure('T6') で報告するもの) ---

  it('規約から役目の決まらない引数を持つ定型 RPC は落ちる(生成器の前提)', () => {
    const findings = verifyRpcMigration(domain(), model(fn({ params: ['p_id', 'p_whatever', 'p_actor_id'] })));
    expect(messages(findings)).toEqual(['insert_booking の引数 p_whatever の役目が規約から決まりません']);
  });

  it('参照が辿れない集約を条件にする定型 RPC は落ちる(生成器の前提)', () => {
    const findings = verifyRpcMigration(
      domain(),
      model(fn({ params: ['p_id', 'p_expected_room_state', 'p_values', 'p_actor_id'], args: ['uuid', 'text', 'jsonb', 'uuid'] })),
    );
    expect(messages(findings)).toEqual([
      'insert_booking の引数 p_expected_room_state が条件にする room まで参照が辿れません',
    ]);
  });

  it('entity を持たない表の定型 RPC は落ちる(生成器の前提)', () => {
    const findings = verifyRpcMigration(
      domain(),
      dataTableModel([dataTable('jobs', { internal: true, functions: [fn()] })]),
    );
    expect(messages(findings)).toEqual(['insert_booking の表 jobs は entity を持ちません']);
  });

  it('トリガ関数は出どころの宣言を持たない(本文は生成の対象外)', () => {
    const trigger: DataFunctionDecl = {
      name: 'touch_booking',
      args: [],
      params: [],
      kind: 'trigger',
      alsoWrites: [],
    };
    expect(verifyRpcMigration(domain(), model(trigger))).toEqual([]);
  });
});
