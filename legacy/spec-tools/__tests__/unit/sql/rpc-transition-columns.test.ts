/**
 * 遷移 RPC が**状態のほかにどの列へ何を書くか**(`rpc-transition-columns.ts`)のユニットテスト。
 *
 * 見るのは 3 語の分担が SQL の式にそのまま出ることである:
 *   - `records_actor` —— 引数の値を代入(値の口が要る)
 *   - `records_time` —— **引数を持たず** `now()` を書く(束 ㉖)
 *   - `clears` —— 空にする。引数があればその値、無ければ直の `null`
 *
 * 同じ列に複数の宣言が同居する機械(保管が時刻を書き、復元が空に戻す)は 1 つの `case` が
 * `p_event_id` で分岐する —— 列単位に潰すと、触れないはずの遷移がその列を静かに動かす。
 */

import { describe, expect, it } from 'vitest';
import { transitionColumns } from '../../../lib/sql/rpc-transition-columns.js';
import type { RpcFactsInput } from '../../../lib/sql/rpc-facts.js';
import { classifyRpcParams } from '../../../lib/sql/rpc-params.js';
import { transitionTargetOf } from '../../../lib/sql/rpc-transition-machine.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, entitySpec, event, field, machine, specModel, write } from '../../helpers/model-builder.js';
import type { EventDef, SpecModel } from '../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** 文書(document)1 集約。`archived_at` は時刻、`archived_by` は実行者への参照である。 */
function domain(events: readonly EventDef[]): SpecModel {
  return specModel([
    aggregate('document', {
      entity: entitySpec('document', {
        label: '文書',
        context: { document: 'document.id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('state', { kind: 'state', machine: 'document' }),
          field('archived_at', { kind: 'datetime' }),
          field('archived_by', { kind: 'ref', entity: 'member' }),
        ],
      }),
      access: accessSpec('document', { writes: [write('system', ['archived_at', 'archived_by'])] }),
      stateMachines: [
        machine('document', { states: ['circulating', 'archived'], initial: 'circulating', events }),
      ],
    }),
    aggregate('member', {
      entity: entitySpec('member', {
        label: 'メンバー',
        context: { member: 'member.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true })],
      }),
    }),
  ]);
}

/** その機械とその引数で、列ごとに出る式。 */
function columns(
  events: readonly EventDef[],
  params: readonly string[],
  args: readonly string[],
): Readonly<Record<string, string>> {
  return built(events, params, args, undefined).expressions;
}

/** 列ごとの式と、書き込みの前に引数を縛る代入文(`records_actor` の列だけ)。 */
function built(
  events: readonly EventDef[],
  params: readonly string[],
  args: readonly string[],
  actions: ActionSpecModel | undefined,
): { readonly expressions: Readonly<Record<string, string>>; readonly binds: Readonly<Record<string, string>> } {
  const table = dataTable('documents', { entity: 'document' });
  const input: RpcFactsInput = {
    name: 'apply_document_transition',
    params,
    args,
    shape: 'transition',
    table,
    domain: domain(events),
    tableOf: (entity) => (entity === 'document' ? 'documents' : 'members'),
    actions,
  };
  const stateFieldOfTransition = (fn: string, model: RpcFactsInput['domain']) => {
    const resolved = transitionTargetOf(fn, 'document', model);
    return resolved.ok ? resolved.target.field : null;
  };
  const classified = classifyRpcParams(params, args, {
    fn: input.name,
    entity: 'document',
    domain: input.domain,
    stateField: stateFieldOfTransition(input.name, input.domain),
  });
  if (!classified.ok) throw new Error(classified.problems.map((problem) => problem.message).join('\n'));
  const expressions: Record<string, string> = {};
  const binds: Record<string, string> = {};
  for (const column of transitionColumns(input, 'document', classified.params)) {
    expressions[column.name] = column.expression;
    if (column.bind !== undefined) binds[column.name] = column.bind;
  }
  return { expressions, binds };
}

/** 遷移を扱う action_spec(イベント ID → input)。 */
function actionsOf(inputs: Readonly<Record<string, readonly string[]>>): ActionSpecModel {
  return {
    actions: Object.entries(inputs).map(([handles, input]) => actionSpec({ handles, input })),
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

/** 汎用の 7 引数(状態遷移の定型)。 */
const BASE_PARAMS = [
  'p_document_id',
  'p_expected_state',
  'p_next_state',
  'p_effects',
  'p_event_id',
  'p_actor_id',
  'p_actor_roles',
];

/** 汎用の 7 引数の型。 */
const BASE_ARGS = ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'];

describe('遷移が状態のほかに書く列', () => {
  it('records_time は引数を持たず v_now(ロック後の時刻)を書く', () => {
    const found = columns(
      [
        event('circulate', { from: ['archived'], to: 'circulating' }),
        event('archive', { from: ['circulating'], to: 'archived', recordsTime: ['archived_at'] }),
      ],
      BASE_PARAMS,
      BASE_ARGS,
    );

    expect(found['archived_at']).toBe(
      "case when p_event_id in ('document.archive') then v_now else t.archived_at end",
    );
  });

  it('同じ列に records_time と clears が同居すると 1 つの case が 2 通りに分岐する', () => {
    const found = columns(
      [
        event('archive', { from: ['circulating'], to: 'archived', recordsTime: ['archived_at'] }),
        event('restore', { from: ['archived'], to: 'circulating', clears: ['archived_at'] }),
      ],
      BASE_PARAMS,
      BASE_ARGS,
    );

    // 全イベントが書くが値の種類が 2 つあるので、分岐そのものは残る(`else` は届かない枝)。
    expect(found['archived_at']).toBe(
      "case when p_event_id in ('document.archive') then v_now" +
        " when p_event_id in ('document.restore') then null else t.archived_at end",
    );
  });

  it('同じ値を書くイベントは 1 つの when にまとまる', () => {
    const found = columns(
      [
        event('archive', { from: ['circulating'], to: 'archived', recordsTime: ['archived_at'] }),
        event('rearchive', { from: ['archived'], to: 'archived', recordsTime: ['archived_at'] }),
        event('restore', { from: ['archived'], to: 'circulating' }),
      ],
      BASE_PARAMS,
      BASE_ARGS,
    );

    expect(found['archived_at']).toBe(
      "case when p_event_id in ('document.archive', 'document.rearchive') then v_now else t.archived_at end",
    );
  });

  it('全イベントが同じ値を書くなら分岐は要らない', () => {
    const found = columns(
      [
        event('archive', { from: ['circulating'], to: 'archived', recordsTime: ['archived_at'] }),
        event('rearchive', { from: ['archived'], to: 'archived', recordsTime: ['archived_at'] }),
      ],
      BASE_PARAMS,
      BASE_ARGS,
    );

    expect(found['archived_at']).toBe('v_now');
  });

  it('引数を持つ列は clears でその引数の値を代入し、それ以外の遷移では触れない', () => {
    const found = columns(
      [
        event('archive', { from: ['circulating'], to: 'archived', recordsActor: ['archived_by'] }),
        event('restore', { from: ['archived'], to: 'circulating', clears: ['archived_by'] }),
      ],
      [...BASE_PARAMS, 'p_archived_by'],
      [...BASE_ARGS, 'uuid'],
    );

    expect(found['archived_by']).toBe(
      "case when p_event_id in ('document.restore') then p_archived_by" +
        ' else coalesce(p_archived_by, t.archived_by) end',
    );
  });

  it('何も宣言しない機械では状態以外の列が 1 つも出ない', () => {
    const found = columns(
      [event('archive', { from: ['circulating'], to: 'archived' })],
      BASE_PARAMS,
      BASE_ARGS,
    );

    expect(Object.keys(found)).toEqual([]);
  });
});

describe('records_actor の列の引数は、書き込みの前にイベントで縛る(点検 7 回目 A7-1)', () => {
  const ARCHIVE = event('archive', { from: ['circulating'], to: 'archived', recordsActor: ['archived_by'] });
  const RESTORE = event('restore', { from: ['archived'], to: 'circulating', clears: ['archived_by'] });
  const HANDOVER = event('handover', { from: ['archived'], to: 'archived' });

  it.each([
    {
      name: '記録するイベントだけ実行者、それ以外の遷移では引数を使わない',
      events: [ARCHIVE, RESTORE],
      actions: undefined,
      bind: "p_archived_by := case when p_event_id in ('document.archive') then p_actor_id else null end",
    },
    {
      name: 'input でその欄を受けるイベントは引数をそのまま使う',
      events: [ARCHIVE, RESTORE, HANDOVER],
      actions: actionsOf({ 'document.handover': ['document.id', 'document.archived_by'] }),
      bind:
        "p_archived_by := case when p_event_id in ('document.archive') then p_actor_id" +
        " when p_event_id in ('document.handover') then p_archived_by else null end",
    },
    {
      name: '別の集約の同名の欄を input に持つ操作は数えない',
      events: [ARCHIVE, HANDOVER],
      actions: actionsOf({ 'document.handover': ['member.archived_by'] }),
      bind: "p_archived_by := case when p_event_id in ('document.archive') then p_actor_id else null end",
    },
    {
      name: '記録するイベントの input にあっても実行者が勝つ(縛りの最初の枝)',
      events: [ARCHIVE],
      actions: actionsOf({ 'document.archive': ['document.archived_by'] }),
      bind: "p_archived_by := case when p_event_id in ('document.archive') then p_actor_id else null end",
    },
  ])('$name', ({ events, actions, bind }) => {
    const result = built(events, [...BASE_PARAMS, 'p_archived_by'], [...BASE_ARGS, 'uuid'], actions);
    expect(result.binds).toEqual({ archived_by: bind });
  });

  it('records_actor が無い列(input で受けるだけ)は縛らない', () => {
    const result = built([HANDOVER], [...BASE_PARAMS, 'p_archived_by'], [...BASE_ARGS, 'uuid'], actionsOf({ 'document.handover': ['document.archived_by'] }));
    expect(result.binds).toEqual({});
    expect(result.expressions['archived_by']).toBe('coalesce(p_archived_by, t.archived_by)');
  });

  it('引数の無い列(records_time / clears だけ)は縛らない', () => {
    const result = built(
      [event('archive', { from: ['circulating'], to: 'archived', recordsTime: ['archived_at'] })],
      BASE_PARAMS,
      BASE_ARGS,
      undefined,
    );
    expect(result.binds).toEqual({});
  });
});
