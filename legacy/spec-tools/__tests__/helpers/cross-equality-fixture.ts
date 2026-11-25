/**
 * 「別の集約の列との等式」の不変条件を持つ最小の題材(トリガの計画・本文・T17 のテストが共有する)。
 *
 * 題材: チケット(`ticket`)の担当者(`agent`)は、チケットと同じ組織の人でなければならない。
 * 行を持つ側が `ticket`(参照の欄 `agent_id`・組織の列 `org_id`)、参照される側が `agent`(`org_id`)。
 * `org_id` を別のトリガが書き換える形(`ticket.org_id` は `queue_id` の更新で写される)も作れる。
 */

import type { DataFunctionDecl, DataTableSpec, DataTriggerDecl } from '../../lib/model/data/types.js';
import type { InvariantDef, SpecModel } from '../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from './model-builder.js';
import { invariant, invariantSpec } from './model-builder-v8plus.js';
import { dataTable } from './data-builder.js';

/** 題材の不変条件 ID。 */
export const CROSS_INVARIANT = 'INV-TICKET-001';

/** 題材の不変条件の文言。 */
export const CROSS_STATEMENT = '担当者はチケットと同じ組織の人でなければならない(100% 他組織を担当させない)';

/** 題材の式(行を持つ側 = ticket から、context の agent で相手に届く)。 */
export const CROSS_EXPR = 'ticket.org_id == agent.org_id';

/** 題材の変形。 */
export interface CrossDomainOptions {
  /** 式(既定は CROSS_EXPR)。 */
  readonly expr?: string;
  /** 担当者の参照の欄を required にするか(既定 true)。 */
  readonly required?: boolean;
  /** `context` に agent を宣言するか(既定 true)。 */
  readonly withContext?: boolean;
  /** 第三の集約(`team`)の欄も `context` で届くようにするか。 */
  readonly withTeam?: boolean;
}

/** 不変条件に、両端のトリガ関数を執行点として名指す `enforced_by` を足す(位置は不変条件の位置を使う)。 */
function withEnforcement(base: InvariantDef): InvariantDef {
  return {
    ...base,
    enforcedBy: ['check_ticket_agent_org', 'check_ticket_agent_org_on_agent'].map((ref) => ({
      kind: 'trigger' as const,
      ref,
      location: base.location,
    })),
  };
}

/** 題材のドメイン仕様。 */
export function crossDomain(opts: CrossDomainOptions = {}): SpecModel {
  const required = opts.required ?? true;
  return specModel(
    [
      aggregate('team', {
        entity: entitySpec('team', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('org_id', { kind: 'uuid' }, { required: true })],
        }),
      }),
      aggregate('agent', {
        entity: entitySpec('agent', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('org_id', { kind: 'uuid' }, { required: true })],
        }),
      }),
      aggregate('ticket', {
        entity: entitySpec('ticket', {
          context: {
            ...(opts.withContext === false ? {} : { agent: 'ticket.agent_id' }),
            ...(opts.withTeam === true ? { team: 'ticket.team_id' } : {}),
          },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('org_id', { kind: 'uuid' }, { required: true }),
            field('queue_id', { kind: 'uuid' }),
            field('agent_id', { kind: 'ref', entity: 'agent' }, { required }),
            field('team_id', { kind: 'ref', entity: 'team' }, { required: true }),
          ],
        }),
        invariants: invariantSpec([
          withEnforcement(
            invariant({
              id: CROSS_INVARIANT,
              entities: ['ticket', 'agent'],
              statement: CROSS_STATEMENT,
              formal: { kind: 'check', expr: opts.expr ?? CROSS_EXPR },
            }),
          ),
        ]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

/** 行を持つ側のトリガ宣言。 */
export function hostTrigger(init: Partial<DataTriggerDecl> = {}): DataTriggerDecl {
  return {
    name: 'check_ticket_agent_org',
    functionName: 'check_ticket_agent_org',
    fires: 'after insert or update of org_id, agent_id (constraint trigger, deferrable initially deferred)',
    deferred: true,
    supplies: [],
    params: {},
    invariant: CROSS_INVARIANT,
    ...init,
  };
}

/** 参照される側のトリガ宣言。 */
export function referencedTrigger(init: Partial<DataTriggerDecl> = {}): DataTriggerDecl {
  return {
    name: 'check_ticket_agent_org_on_agent',
    functionName: 'check_ticket_agent_org_on_agent',
    fires: 'after update of org_id (constraint trigger, deferrable initially deferred)',
    deferred: true,
    supplies: [],
    params: {},
    invariant: CROSS_INVARIANT,
    ...init,
  };
}

/** `kind: trigger` の関数宣言。 */
export function triggerFn(name: string): DataFunctionDecl {
  return { name, args: [], params: [], kind: 'trigger', alsoWrites: [] };
}

/** 行を持つ側の表。 */
export function ticketTable(triggers: readonly DataTriggerDecl[] = [hostTrigger()]): DataTableSpec {
  return dataTable('tickets', {
    entity: 'ticket',
    triggers: [...triggers],
    functions: triggers.map((trigger) => triggerFn(trigger.functionName)),
  });
}

/** 参照される側の表。 */
export function agentTable(triggers: readonly DataTriggerDecl[] = [referencedTrigger()]): DataTableSpec {
  return dataTable('agents', {
    entity: 'agent',
    triggers: [...triggers],
    functions: triggers.map((trigger) => triggerFn(trigger.functionName)),
  });
}
