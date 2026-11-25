/**
 * T21(削除から外部キーの連鎖で起きる書き込みも宣言に載る)のテスト。
 *
 * 題材は架空の予約(予約を消すと明細が cascade で消え、明細の下の添付も消え、メモの参照は set null で空になる)。
 */

import { describe, expect, it } from 'vitest';
import { impliedWrites, verifyCascadeClosure } from '../../../../lib/data/verifiers/t21-cascade-closure.js';
import type { DataForeignKeyDecl, DataFunctionDecl } from '../../../../lib/model/data/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

const fk = (column: string, references: string, onDelete: DataForeignKeyDecl['onDelete']): DataForeignKeyDecl => ({ column, references, onDelete });

/** 予約 → 明細(cascade)→ 添付(cascade)、予約 → メモ(set null)、予約 → 監査(no action)、利用者は別スキーマ。 */
function tables(functions: readonly DataFunctionDecl[]) {
  return dataTableModel([
    dataTable('bookings', { entity: 'booking', functions, foreignKeys: [fk('owner_id', 'auth.users', 'cascade')] }),
    dataTable('lines', { entity: 'line', foreignKeys: [fk('booking_id', 'bookings', 'cascade')] }),
    dataTable('attachments', { entity: 'attachment', foreignKeys: [fk('line_id', 'public.lines', 'cascade')] }),
    dataTable('notes', { entity: 'note', foreignKeys: [fk('booking_id', 'bookings', 'set_null')] }),
    dataTable('audits', { entity: 'audit', foreignKeys: [fk('booking_id', 'bookings', 'no_action')] }),
  ]);
}

/** 予約の削除 RPC(定型 delete)。 */
const deleteBooking = (alsoWriteKinds: NonNullable<DataFunctionDecl['alsoWriteKinds']> = {}): DataFunctionDecl => ({
  name: 'delete_booking',
  args: [],
  params: [],
  kind: 'rpc',
  shape: 'delete',
  alsoWrites: Object.keys(alsoWriteKinds),
  alsoWriteKinds,
});

describe('T21 外部キーの連鎖の閉包', () => {
  it('cascade は推移的に delete、set null は update、no action と別スキーマは書き込みなし', () => {
    const implied = impliedWrites(tables([]).tables, ['bookings']);
    expect(implied.map((write) => `${write.table}:${write.kind}`).sort()).toEqual(['attachments:delete', 'lines:delete', 'notes:update']);
    expect(implied.find((write) => write.table === 'attachments')?.path).toHaveLength(2);
  });

  it('閉包に入る表が宣言に無ければ、道筋つきで名指しする', () => {
    const findings = verifyCascadeClosure(tables([deleteBooking({ lines: ['delete'] })]));
    expect(findings.map((finding) => finding.counterexample?.['table']).sort()).toEqual(['attachments', 'notes']);
    expect(findings[0]?.severity).toBe('error');
    expect(findings.find((finding) => finding.counterexample?.['table'] === 'attachments')?.message).toContain('lines → attachments.line_id(on delete cascade)');
  });

  it('全部宣言していれば指摘は無い', () => {
    expect(verifyCascadeClosure(tables([deleteBooking({ lines: ['delete'], attachments: ['delete'], notes: ['update'] })]))).toEqual([]);
  });

  it('also_writes の削除(後始末)も起点になる', () => {
    const cleanup: DataFunctionDecl = {
      name: 'close_account',
      args: [],
      params: [],
      kind: 'rpc',
      shape: 'composite',
      alsoWrites: ['bookings'],
      alsoWriteKinds: { bookings: ['delete'] },
      selfWriteKinds: [],
    };
    const model = dataTableModel([...tables([]).tables, dataTable('accounts', { entity: 'account', functions: [cleanup] })]);
    expect(verifyCascadeClosure(model).map((finding) => finding.counterexample?.['table']).sort()).toEqual(['attachments', 'lines', 'notes']);
  });

  it('削除しない関数・data_table を採らない構成は何も言わない', () => {
    expect(verifyCascadeClosure(tables([{ ...deleteBooking(), shape: 'update' }]))).toEqual([]);
    expect(verifyCascadeClosure({ available: false, tables: [] })).toEqual([]);
  });
});
