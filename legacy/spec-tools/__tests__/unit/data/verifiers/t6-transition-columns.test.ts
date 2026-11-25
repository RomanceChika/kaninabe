/**
 * T6 の続き(遷移の RPC が受ける列の引数は、その機械の宣言が名指す列だけ)のユニットテスト(点検 7 回目 A7-1)。
 *
 * 許すのは、その機械のイベントの `records_actor` / `clears` / `records_time` と、そのイベントを扱う
 * action_spec の `input` / `computes`(自集約の欄)に現れる列だけ。どの宣言も名指さない列を
 * data_table の `params` に足すと、全イベントの呼び手がその列を書ける口になる(以前は作成の自動補完が
 * そこに実行者を入れ、binding の根拠を遷移を起こした人に据え替えた)。
 */

import { describe, expect, it } from 'vitest';
import { verifyRpcMigration } from '../../../../lib/data/verifiers/t6-rpc-migration.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import type { EventDef, SpecModel } from '../../../../lib/model/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../../helpers/model-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';

/** 予約(hold)と利用者(patron)。hold.patron_id は binding の根拠になりうる実行者への参照。 */
function domain(events: readonly EventDef[]): SpecModel {
  return specModel([
    aggregate('hold', {
      entity: entitySpec('hold', {
        context: { hold: 'hold.id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('patron_id', { kind: 'ref', entity: 'patron' }, { required: true }),
          field('note', { kind: 'text' }),
          field('state', { kind: 'state', machine: 'hold' }),
        ],
      }),
      stateMachines: [machine('hold', { states: ['waiting', 'ready', 'done'], initial: 'waiting', events })],
    }),
    aggregate('patron', {
      entity: entitySpec('patron', {
        context: { patron: 'patron.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' }, { session: true })],
      }),
    }),
  ]);
}

/** 遷移の RPC(汎用の 7 引数 + 列の引数)。 */
function transitionFn(extra: readonly string[], overrides: Partial<DataFunctionDecl> = {}): DataFunctionDecl {
  return {
    name: 'apply_hold_transition',
    args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]', ...extra.map(() => 'uuid')],
    params: ['p_hold_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles', ...extra],
    kind: 'rpc',
    shape: 'transition',
    alsoWrites: [],
    migration: '20260912000003_rpc_apply_hold_transition.sql',
    ...overrides,
  };
}

/** action_spec(操作 ID → input / computes / runner)。 */
function actions(
  decls: Readonly<Record<string, { readonly input?: readonly string[]; readonly computes?: Readonly<Record<string, string>>; readonly manual?: boolean }>>,
): ActionSpecModel {
  return {
    actions: Object.entries(decls).map(([handles, decl]) =>
      actionSpec({
        handles,
        input: decl.input ?? [],
        ...(decl.computes === undefined ? {} : { computes: decl.computes }),
        ...(decl.manual === true ? { runner: { reason: '専用の照合が要るため' } } : {}),
      }),
    ),
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

const PREPARE = event('prepare', { from: ['waiting'], to: 'ready' });
const COLLECT = event('collect', { from: ['ready'], to: 'done' });

/** T6 の指摘のうち、この検査の文面のものだけ。 */
function undeclared(model: SpecModel, fn: DataFunctionDecl, declared: ActionSpecModel): readonly string[] {
  return verifyRpcMigration(model, dataTableModel([dataTable('holds', { entity: 'hold', functions: [fn] })]), declared)
    .filter((finding) => finding.message.includes('どの宣言も名指さない列'))
    .map((finding) => String(finding.counterexample?.['param'] ?? ''));
}

const BASE_ACTIONS = { 'hold.prepare': { input: ['hold.id'] }, 'hold.collect': { input: ['hold.id'] } };

describe('T6 遷移の RPC の列の引数は宣言が名指す列だけ', () => {
  it.each([
    {
      name: 'どの宣言も名指さない実行者への参照(探り台本 library の p_patron_id の形)は error',
      events: [PREPARE, COLLECT],
      extra: ['p_patron_id'],
      decls: BASE_ACTIONS,
      expected: ['p_patron_id'],
    },
    {
      name: 'records_actor で名指した列は許す',
      events: [event('prepare', { from: ['waiting'], to: 'ready', recordsActor: ['patron_id'] }), COLLECT],
      extra: ['p_patron_id'],
      decls: BASE_ACTIONS,
      expected: [],
    },
    {
      name: 'clears で名指した列は許す',
      events: [PREPARE, event('collect', { from: ['ready'], to: 'done', clears: ['note'] })],
      extra: ['p_note'],
      decls: BASE_ACTIONS,
      expected: [],
    },
    {
      name: 'その機械のイベントの input にある列は許す',
      events: [PREPARE, COLLECT],
      extra: ['p_note'],
      decls: { ...BASE_ACTIONS, 'hold.collect': { input: ['hold.id', 'hold.note'] } },
      expected: [],
    },
    {
      name: 'その機械のイベントの computes が書く列は許す',
      events: [PREPARE, COLLECT],
      extra: ['p_note'],
      decls: { ...BASE_ACTIONS, 'hold.collect': { input: ['hold.id'], computes: { 'hold.note': 'noteOf' } } },
      expected: [],
    },
    {
      name: 'runner: manual の遷移の input も宣言として数える(誰がその列を書くかは仕様にある)',
      events: [PREPARE, COLLECT],
      extra: ['p_note'],
      decls: { ...BASE_ACTIONS, 'hold.collect': { input: ['hold.id', 'hold.note'], manual: true } },
      expected: [],
    },
    {
      name: '作成の input は数えない(遷移の宣言ではない)',
      events: [PREPARE, COLLECT],
      extra: ['p_patron_id'],
      decls: { ...BASE_ACTIONS, 'hold.create': { input: ['hold.patron_id'] } },
      expected: ['p_patron_id'],
    },
    {
      name: '別の集約の同名の欄を input に持つ操作は数えない(自集約の欄だけ)',
      events: [PREPARE, COLLECT],
      extra: ['p_note'],
      decls: { ...BASE_ACTIONS, 'hold.collect': { input: ['hold.id', 'patron.note'] } },
      expected: ['p_note'],
    },
    {
      name: '1 本だけ名指されていれば、残りの名指されない列だけを名指す',
      events: [event('prepare', { from: ['waiting'], to: 'ready', recordsActor: ['patron_id'] }), COLLECT],
      extra: ['p_patron_id', 'p_note'],
      decls: BASE_ACTIONS,
      expected: ['p_note'],
    },
  ])('$name', ({ events, extra, decls, expected }) => {
    expect(undeclared(domain(events), transitionFn(extra), actions(decls))).toEqual(expected);
  });

  it('指摘は data_table の params を指し、records_actor / input / computes の 3 つの直し方を案内する', () => {
    const findings = verifyRpcMigration(
      domain([PREPARE, COLLECT]),
      dataTableModel([dataTable('holds', { entity: 'hold', functions: [transitionFn(['p_patron_id'])] })]),
      actions(BASE_ACTIONS),
    ).filter((finding) => finding.message.includes('どの宣言も名指さない列'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T6');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location?.pointer).toBe('functions.apply_hold_transition.params');
    expect(findings[0]?.suggestion).toContain('records_actor: [patron_id]');
    expect(findings[0]?.suggestion).toContain('input に hold.patron_id');
    expect(findings[0]?.suggestion).toContain('computes');
  });

  it('本文を生成しない遷移(手書き)は見ない', () => {
    const handwritten = transitionFn(['p_patron_id'], { handwritten: '本文に DSL 外の手順がある' });
    const { migration: _migration, ...rest } = handwritten;
    expect(undeclared(domain([PREPARE, COLLECT]), rest, actions(BASE_ACTIONS))).toEqual([]);
  });
});
