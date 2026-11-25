/**
 * 別の集約の列との等式の制約トリガ(参照される側の端)が要求する索引(`crossIndexRequests`)のテスト。
 *
 * 参照される側(担当者)の行が更新されたとき、本文は「その行を指す行」を参照の欄で引く。その欄に索引が無いと全件走査になる。
 * 固定するのは、要求が不変条件の住む表の参照の欄になること・行を持つ側の端は要求しないこと・形が読めない宣言は要求しないこと・
 * 外部キーの索引が既にあれば期待から外れること(= 索引名を増やさない)。
 */

import { describe, expect, it } from 'vitest';
import { crossIndexRequests } from '../../../../lib/relations/index-requirements/index-lookup.js';
import { deriveIndexRequirements } from '../../../../lib/relations/index-requirements/index.js';
import { availableLoad, catalogInput } from '../../../../lib/kernel/input-state.js';
import { dataTableModel } from '../../../helpers/data-builder.js';
import { QUERY_CTX } from '../../../helpers/query-builder.js';
import { agentTable, crossDomain, hostTrigger, referencedTrigger, ticketTable } from '../../../helpers/cross-equality-fixture.js';

describe('crossIndexRequests', () => {
  it('参照される側のトリガは、不変条件が住む表の参照の欄の索引を要求する(行を持つ側の端は要求しない)', () => {
    const tables = dataTableModel([ticketTable(), agentTable()]);
    const requests = crossIndexRequests(tables, crossDomain());

    expect(requests.map((request) => ({ table: request.table, columns: request.columns, function: request.function }))).toEqual([
      { table: 'tickets', columns: ['agent_id'], function: 'check_ticket_agent_org_on_agent' },
    ]);
    expect(requests[0]?.location.pointer).toBe('triggers.check_ticket_agent_org_on_agent');
  });

  it('形が読めない宣言(参照の欄が空にできる・context に相手が無い)・別の集約の等式でない宣言は要求しない', () => {
    const tables = dataTableModel([ticketTable(), agentTable()]);
    expect(crossIndexRequests(tables, crossDomain({ required: false }))).toEqual([]);
    expect(crossIndexRequests(tables, crossDomain({ withContext: false }))).toEqual([]);
    expect(crossIndexRequests(tables, crossDomain({ expr: 'ticket.org_id == ticket.org_id' }))).toEqual([]);
    const undeclared = dataTableModel([ticketTable(), agentTable([referencedTrigger({ invariant: undefined as never })])]);
    expect(crossIndexRequests(undeclared, crossDomain())).toEqual([]);
    expect(crossIndexRequests(dataTableModel([ticketTable([hostTrigger()])]), crossDomain())).toEqual([]);
  });

  it('導出の入口に載り、外部キーの索引が既にあれば期待から外れる(索引名を増やさない)', () => {
    const input = (tables: ReturnType<typeof dataTableModel>) => ({
      domain: crossDomain(),
      guards: QUERY_CTX.guards,
      queries: catalogInput('selected', availableLoad({ available: true, queries: [] })),
      dataTables: catalogInput('selected', availableLoad(tables)),
    });
    const missing = deriveIndexRequirements(input(dataTableModel([ticketTable(), agentTable()])));
    expect(missing.requirements.expected.map((entry) => `${entry.table}(${entry.columns.join(',')})`)).toEqual(['tickets(agent_id)']);
    expect(missing.requirements.candidates[0]?.lookups).toEqual(['check_ticket_agent_org_on_agent']);

    // 参照の欄に外部キーの索引(列がちょうど一致)があれば、新たに宣言を要求しない。
    const covered = dataTableModel([
      {
        ...ticketTable(),
        indexes: [{ name: 'tickets_agent_id_idx', on: ['agent_id'], unique: false }],
        foreignKeys: [{ column: 'agent_id', references: 'agents', onDelete: 'restrict' }],
      },
      agentTable(),
    ]);
    expect(deriveIndexRequirements(input(covered)).requirements.expected).toEqual([]);
  });
});
