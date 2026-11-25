/**
 * 遷移 RPC の本文が持つ**セッションを終える呼び出し**(R11。ジョブカタログの `ends_sessions`)の配線と生成のユニットテスト。
 *
 * 見るのは次の点である。
 *   - 配線(`endSessionsWiringOf`): ジョブカタログの `ends_sessions` / `platform_call` と、状態機械の `effects` が効果を載せた
 *     イベントから導く。他の集約の効果・効果を載せるイベントが無い機械・機械が名前から決まらない遷移 RPC・呼び先の RPC 自身には配線しない
 *   - 生成: 効果を載せたイベント(`p_event_id` の `{機械}.{イベント}`)で遷移が確定したときだけ、同じトランザクションの中で
 *     `{スキーマ}.{呼び先}({対象の行の id})` を呼ぶ。位置は監査ログの後・効果の outbox への積み込みの前。配線が無ければ何も足さない
 *   - 生成物の字面に認証基盤の綴り(auth スキーマ・sessions)が出ない(呼び先の本文に閉じる)
 */

import { describe, expect, it } from 'vitest';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { endSessionsWiringOf } from '../../../lib/sql/rpc-end-sessions.js';
import { dataTable } from '../../helpers/data-builder.js';
import { aggregate, effect, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder.js';
import { outboxJob } from '../../helpers/job-builder.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import type { JobCatalogSpec, JobDecl } from '../../../lib/model/job/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { jobCatalog } from '../../helpers/job-builder.js';

/** アカウントの集約 `account`(状態機械 `account`。止める遷移 `suspend` と `close`、止めない `rename`)。 */
function domain(effects = [effect('suspend', ['end_account_sessions']), effect('close', ['end_account_sessions'])]): SpecModel {
  return specModel([
    aggregate('account', {
      entity: entitySpec('account', {
        label: 'アカウント',
        context: { account: 'account.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'account' })],
      }),
      stateMachines: [
        machine('account', {
          states: ['open', 'suspended', 'closed'],
          initial: 'open',
          events: [
            event('suspend', { from: ['open'], to: 'suspended', by: ['member'] }),
            event('close', { from: ['open', 'suspended'], to: 'closed', by: ['member'] }),
            event('rename', { from: ['open'], to: 'open', by: ['member'] }),
          ],
          effects,
        }),
      ],
    }),
  ]);
}

const END: JobDecl = outboxJob('end_account_sessions', { kind: 'end', endsSessions: 'account', platformCall: 'revoke_auth_sessions', inTransaction: true });

const catalog = (...jobs: JobDecl[]): JobCatalogSpec => jobCatalog(jobs);

const PARAMS = ['p_account_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'];
const ARGS = ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'];

/** 遷移 RPC を組み立てる(失敗なら理由を文字列にして返す)。 */
function build(endSessions: Parameters<typeof buildRpcBody>[0]['endSessions']): string {
  const result = buildRpcBody({
    name: 'apply_account_transition',
    params: PARAMS,
    args: ARGS,
    shape: 'transition',
    table: dataTable('accounts', { entity: 'account' }),
    domain: domain(),
    tableOf: (entity) => (entity === 'account' ? 'accounts' : null),
    actions: undefined,
    specFiles: [],
    entityLabel: 'アカウント',
    platform: TEST_PLATFORM,
    ...(endSessions === undefined ? {} : { endSessions }),
  });
  return result.ok ? result.sql : result.problems.map((problem) => problem.message).join('\n');
}

describe('endSessionsWiringOf: 配線の導出', () => {
  it('効果を載せたイベントを {機械}.{イベント} で並べ、呼び先とスキーマを運ぶ(止めない rename は含めない)', () => {
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain(), catalog(END), 'api')).toEqual({
      call: 'revoke_auth_sessions',
      schema: 'api',
      events: ['account.suspend', 'account.close'],
    });
  });

  it('カタログが無い・終える効果が無い・別の集約の効果なら配線は無い', () => {
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain(), null, 'api')).toBeUndefined();
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain(), undefined, 'api')).toBeUndefined();
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain(), catalog(outboxJob('x', { kind: 'plain' })), 'api')).toBeUndefined();
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain(), catalog({ ...END, endsSessions: 'other' }), 'api')).toBeUndefined();
  });

  it('機械が効果を載せるイベントを持たなければ配線は無い', () => {
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain([effect('rename', ['other'])]), catalog(END), 'api')).toBeUndefined();
  });

  it('動かす機械が関数名から決まらない遷移 RPC には配線しない(失敗の報告は遷移の導出の側が持つ)', () => {
    expect(endSessionsWiringOf('apply_unknown_transition', 'account', domain(), catalog(END), 'api')).toBeUndefined();
    expect(endSessionsWiringOf('do_something', 'account', domain(), catalog(END), 'api')).toBeUndefined();
  });

  it('呼び先の RPC 自身には配線しない(自分を呼ぶ再帰を作らない)', () => {
    const self = { ...END, platformCall: 'apply_account_transition' };
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain(), catalog(self), 'api')).toBeUndefined();
  });

  it('platform_call を持たない行は数えない', () => {
    const { platformCall: _call, ...bare } = END;
    expect(endSessionsWiringOf('apply_account_transition', 'account', domain(), catalog(bare), 'api')).toBeUndefined();
  });
});

describe('遷移 RPC の本文: セッションを終える呼び出し', () => {
  const wiring = { call: 'revoke_auth_sessions', schema: 'edge', events: ['account.suspend', 'account.close'] };

  it('効果を載せたイベントのときだけ、遷移と同じトランザクションの中で呼び先を呼ぶ', () => {
    const sql = build(wiring);

    expect(sql).toContain("if p_event_id in ('account.suspend', 'account.close') then");
    expect(sql).toContain('perform edge.revoke_auth_sessions(p_account_id);');
    expect(sql).toContain('セッションを終える効果(ends_sessions)を載せたイベント');
  });

  it('呼び出しは監査ログの後・効果の積み込みの前(更新が 0 行なら拒否の分岐で例外になり、ここへ来ない)', () => {
    const sql = build(wiring);
    const update = sql.indexOf('update public.accounts t');
    const refusal = sql.indexOf('raise exception');
    const audit = sql.indexOf('insert into public.domain_events');
    const call = sql.indexOf('perform edge.revoke_auth_sessions');
    const loop = sql.indexOf('foreach v_effect in array');

    expect(update).toBeGreaterThan(-1);
    expect(update).toBeLessThan(refusal);
    expect(refusal).toBeLessThan(audit);
    expect(audit).toBeLessThan(call);
    expect(call).toBeLessThan(loop);
  });

  it('配線が無い・イベントが空なら何も足さない(対照)', () => {
    expect(build(undefined)).not.toContain('revoke_auth_sessions');
    expect(build({ ...wiring, events: [] })).not.toContain('revoke_auth_sessions');
  });

  it('認証基盤の綴り(auth スキーマ・sessions)は生成物に出ない(呼び先の本文に閉じる)', () => {
    const sql = build(wiring);

    expect(sql).not.toMatch(/\bauth\.|\bsessions\b/);
  });

  it('呼び先の名前に外から来た文字列を混ぜない: 識別子はそのまま、イベントはリテラルとして引用する', () => {
    const sql = build({ call: 'revoke_auth_sessions', schema: 'edge', events: ["account.o'neil"] });

    expect(sql).toContain("('account.o''neil')");
  });
});
