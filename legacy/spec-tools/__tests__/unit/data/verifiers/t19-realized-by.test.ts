/**
 * T19（同一トランザクションで実現される効果が、実現する RPC を名指しする `realized_by`）の規約網羅テスト。
 *
 * 要求:
 *   - 同一トランザクションで実現される効果は `realized_by` を必ず持つ（無い = 連鎖が推測になる）
 *   - キーは、その効果を `effects` に宣言している全部のイベントと過不足なく一致する
 *   - 名指した RPC は data_table の `kind: rpc` に実在する
 *   - キューに積まれる効果・ジョブカタログの無い構成は何も言わない
 *   - セッションを終える効果（ends_sessions）の platform_call: 実在する RPC（引数は uuid 1 つ）で、realized_by の RPC がそれ自身であるか
 *     calls に宣言して呼ぶ（R11）
 * 題材は架空のメンバー（退会・無効化で後始末を同一トランザクションで行う）。
 */

import { describe, expect, it } from 'vitest';
import { verifyRealizedBy } from '../../../../lib/data/verifiers/t19-realized-by.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import type { JobDecl } from '../../../../lib/model/job/types.js';
import { aggregate, effect, entitySpec, event, machine, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { jobModel, outboxJob } from '../../../helpers/job-builder.js';

/** leave と disable が、効果 `end_sessions` と `notify_left` を起こすメンバー。 */
const DOMAIN = specModel([
  aggregate('member', {
    entity: entitySpec('member', { fields: [] }),
    stateMachines: [
      machine('membership', {
        states: ['active', 'left', 'disabled'],
        initial: 'active',
        final: ['left', 'disabled'],
        events: [event('leave', { from: ['active'], to: 'left', by: ['staff'] }), event('disable', { from: ['active'], to: 'disabled', by: ['staff'] })],
        effects: [effect('leave', ['end_sessions', 'notify_left']), effect('disable', ['end_sessions'])],
      }),
    ],
  }),
]);

/** RPC の宣言。 */
const rpc = (name: string): DataFunctionDecl => ({ name, args: [], params: [], kind: 'rpc', shape: 'composite', alsoWrites: [] });

const TABLES = dataTableModel([dataTable('members', { entity: 'member', functions: [rpc('apply_transition'), { ...rpc('is_member'), kind: 'helper' }] })]);

/** 同一トランザクションで実現される効果の行。 */
const inTx = (realizedBy?: Record<string, string>): JobDecl =>
  outboxJob('end_sessions', { kind: 'transaction_effect', inTransaction: true, ...(realizedBy === undefined ? {} : { realizedBy }) });

/** 指摘の文面。 */
function messages(job: JobDecl, tables = TABLES): readonly string[] {
  return verifyRealizedBy(DOMAIN, tables, jobModel([job, outboxJob('notify_left')])).map((finding) => finding.message);
}

describe('T19 realized_by', () => {
  it('過不足なく実在する RPC を名指ししていれば指摘は無い', () => {
    expect(messages(inTx({ 'membership.leave': 'apply_transition', 'membership.disable': 'apply_transition' }))).toEqual([]);
  });

  it('realized_by が無い行は名指しで error（どのイベントを書けばよいかも示す）', () => {
    const findings = verifyRealizedBy(DOMAIN, TABLES, jobModel([inTx(), outboxJob('notify_left')]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T19');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('end_sessions');
    expect(findings[0]?.suggestion).toContain('membership.leave');
    expect(findings[0]?.suggestion).toContain('membership.disable');
  });

  it('効果を宣言しているイベントの名指しが足りなければ、そのイベントを名指しで error', () => {
    const result = messages(inTx({ 'membership.leave': 'apply_transition' }));

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('membership.disable がありません');
  });

  it('効果を宣言していないイベントのキーは error（存在しない発火元を名指している）', () => {
    const result = messages(inTx({ 'membership.leave': 'apply_transition', 'membership.disable': 'apply_transition', 'membership.erase': 'apply_transition' }));

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('membership.erase');
    expect(result[0]).toContain('effects に宣言しているイベントではありません');
  });

  it('data_table に実在しない RPC・RPC でない関数の名指しは error', () => {
    const result = messages(inTx({ 'membership.leave': 'no_such_rpc', 'membership.disable': 'is_member' }));

    expect(result).toHaveLength(2);
    expect(result[0]).toContain('no_such_rpc');
    expect(result[1]).toContain('is_member');
  });

  it('キューに積まれる効果（in_transaction でない行）は名指しを要らない', () => {
    expect(verifyRealizedBy(DOMAIN, TABLES, jobModel([outboxJob('end_sessions'), outboxJob('notify_left')]))).toEqual([]);
  });

  it('ジョブカタログが無い構成・data_table が無い構成では（実在の確認を除き）黙って緑にならない範囲だけ見る', () => {
    expect(verifyRealizedBy(DOMAIN, TABLES, undefined)).toEqual([]);
    expect(verifyRealizedBy(DOMAIN, TABLES, jobModel([], false))).toEqual([]);
    // data_table を採らない構成でも、名指しの有無・キーの過不足は見る（RPC の実在だけ見られない）。
    const noTables = { available: false as const, tables: [] };
    expect(verifyRealizedBy(DOMAIN, noTables, jobModel([inTx({ 'membership.leave': 'x_rpc', 'membership.disable': 'x_rpc' })]))).toEqual([]);
    expect(verifyRealizedBy(DOMAIN, noTables, jobModel([inTx()]))).toHaveLength(1);
  });
});

describe('T19 platform_call(セッションを終える効果の認証基盤の呼び出し)', () => {
  /** 認証基盤の呼び出しを本文に持つ RPC（uuid 1 つ）。 */
  const platform = (args: readonly string[] = ['uuid']): DataFunctionDecl => ({ ...rpc('revoke_auth_sessions'), args, params: args.map((_, i) => `p_${i}`) });
  /** `calls` を宣言した遷移の RPC。 */
  const calling = (calls?: readonly string[]): DataFunctionDecl => ({ ...rpc('apply_transition'), ...(calls === undefined ? {} : { calls }) });
  const tables = (...functions: readonly DataFunctionDecl[]) => dataTableModel([dataTable('members', { entity: 'member', functions })]);
  const ending = (call = 'revoke_auth_sessions', realized: Record<string, string> = { 'membership.leave': 'apply_transition', 'membership.disable': 'apply_transition' }): JobDecl =>
    outboxJob('end_sessions', { kind: 'end', inTransaction: true, endsSessions: 'member', platformCall: call, realizedBy: realized });
  const run = (job: JobDecl, model = tables(calling(['revoke_auth_sessions']), platform())) => verifyRealizedBy(DOMAIN, model, jobModel([job, outboxJob('notify_left')]));

  it('実在する RPC（uuid 1 つ）を名指しし、realized_by の RPC がそれを calls に宣言していれば指摘は無い', () => {
    expect(run(ending())).toEqual([]);
  });

  it('realized_by の RPC が platform_call 自身なら calls を要らない（自分で呼び出しを持つ）', () => {
    const self = ending('apply_transition');
    expect(run(self, tables({ ...calling(), args: ['uuid'], params: ['p_0'] }, platform()))).toEqual([]);
  });

  it('platform_call が data_table に実在する書き込み RPC でなければ error（RPC でない関数・実在しない名前）', () => {
    const missing = run(ending('no_such'));
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('platform_call no_such は、data_table に実在する書き込み RPC');
    expect(missing[0]?.location.pointer).toBe('jobs.end_sessions.platform_call');
    const helper = run(ending('is_member'), tables(calling(['is_member']), { ...rpc('is_member'), kind: 'helper' }));
    expect(helper.map((f) => f.message).join('\n')).toContain('is_member は、data_table に実在する書き込み RPC');
  });

  it('platform_call の引数が uuid 1 つでなければ error（終える相手のアカウントだけを受ける）', () => {
    const two = run(ending(), tables(calling(['revoke_auth_sessions']), platform(['uuid', 'uuid'])));
    expect(two).toHaveLength(1);
    expect(two[0]?.message).toContain('引数が uuid 1 つではありません');
    const text = run(ending(), tables(calling(['revoke_auth_sessions']), platform(['text'])));
    expect(text[0]?.message).toContain('引数が uuid 1 つではありません（text）');
    const none = run(ending(), tables(calling(['revoke_auth_sessions']), platform([])));
    expect(none[0]?.message).toContain('引数なし');
  });

  it('realized_by の RPC が platform_call を calls に宣言していなければ、そのイベントを名指しで error', () => {
    const findings = run(ending(), tables(calling(['something_else']), platform()));

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.location.pointer).sort()).toEqual(['jobs.end_sessions.realized_by.membership.disable', 'jobs.end_sessions.realized_by.membership.leave']);
    expect(findings[0]?.message).toContain('platform_call の revoke_auth_sessions を calls に宣言していません');
    expect(findings[0]?.suggestion).toContain('calls: [revoke_auth_sessions]');
    // calls を宣言していない RPC も同じ。
    expect(run(ending(), tables(calling(), platform()))).toHaveLength(2);
  });

  it('一部のイベントだけ別の RPC が実現していて、その RPC が呼ばなければ、そのイベントだけ error', () => {
    const split = ending('revoke_auth_sessions', { 'membership.leave': 'apply_transition', 'membership.disable': 'other_rpc' });
    const model = tables(calling(['revoke_auth_sessions']), platform(), rpc('other_rpc'));

    const findings = run(split, model);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.pointer).toBe('jobs.end_sessions.realized_by.membership.disable');
  });

  it('platform_call を持たない行・data_table を採らない構成では platform_call の接地を見ない', () => {
    expect(run(outboxJob('end_sessions', { kind: 'end', inTransaction: true, realizedBy: { 'membership.leave': 'apply_transition', 'membership.disable': 'apply_transition' } }))).toEqual([]);
    const noTables = { available: false as const, tables: [] };
    expect(verifyRealizedBy(DOMAIN, noTables, jobModel([ending(), outboxJob('notify_left')]))).toEqual([]);
  });
});
