/**
 * 作成 RPC が監査ログを引く索引の要求(`recreateIndexRequests`。点検 23 回目 O23-2)のテスト。
 *
 * 作成は行を入れた後に、同じ鍵の作成が監査ログに既にあるか(1 回目の行が消された後の押し直し)を引く。固定するのは、要求が監査ログの表の
 * `(entity_id, event_id)` になること・作成でない関数と監査ログの無い製品は要求しないこと・列の並びが生成の本文の字面と同じであること。
 */

import { describe, expect, it } from 'vitest';
import { RECREATE_AUDIT_LOOKUP, recreateIndexRequests } from '../../../../lib/relations/index-requirements/index-lookup.js';
import { refuseRecreated } from '../../../../lib/sql/rpc-resend.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';

const fn = (name: string, shape: DataFunctionDecl['shape']): DataFunctionDecl => ({ name, args: [], kind: 'rpc', shape }) as unknown as DataFunctionDecl;
const audit = dataTable('domain_events', { framework: 'domain_events', internal: true });

describe('recreateIndexRequests', () => {
  it('作成 RPC ごとに、監査ログの表の (entity_id, event_id) を要求する(作成でない関数は要求しない)', () => {
    const tables = dataTableModel([audit, dataTable('boxes', { functions: [fn('insert_box', 'create'), fn('update_box', 'update')] })]);
    expect(recreateIndexRequests(tables).map((request) => ({ table: request.table, columns: request.columns, function: request.function }))).toEqual([
      { table: 'domain_events', columns: ['entity_id', 'event_id'], function: 'insert_box' },
    ]);
  });

  it('監査ログの表が無ければ要求しない', () => {
    expect(recreateIndexRequests(dataTableModel([dataTable('boxes', { functions: [fn('insert_box', 'create')] })]))).toEqual([]);
  });

  it('列の並びは作成の本文が引く字面と同じ(r.entity_id = p_id and r.event_id = …)', () => {
    const sql = refuseRecreated({ event: "'box.create'", operation: "'box.create'", hasActor: false, conflict: '', indent: '' }).join('\n');
    expect(sql).toContain(`r.${RECREATE_AUDIT_LOOKUP[0]} = p_id and r.${RECREATE_AUDIT_LOOKUP[1]} = 'box.create'`);
  });
});
