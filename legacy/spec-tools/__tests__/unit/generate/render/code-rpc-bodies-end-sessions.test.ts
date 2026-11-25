/**
 * code-rpc-bodies(定型 RPC の本文の生成)のうち、**セッションを終える効果**(R11。ジョブカタログの `ends_sessions`)の配線のテスト。
 *
 * 生成器が文脈のジョブカタログから配線を導き、効果を載せたイベントの遷移 RPC にだけ呼び出しを足すこと、
 * ほかの形(編集・作成・削除)や、効果を持たない製品の遷移 RPC は字面が変わらないことを見る。
 * 配線の導出と本文の位置の細部は `rpc-end-sessions.test.ts`(SQL 層)が持ち、ここは生成器の入口(文脈 → 配線)を固定する。
 */

import { describe, expect, it } from 'vitest';
import { rpcBodiesGenerator } from '../../../../lib/generate/render/code-rpc-bodies.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { aggregate, effect, entitySpec, event, field, machine, specModel } from '../../../helpers/model-builder.js';
import { jobModel, outboxJob } from '../../../helpers/job-builder.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';

const MIGRATION = '20261023000700_apply_account_transition.sql';

const FN: DataFunctionDecl = {
  name: 'apply_account_transition',
  args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'],
  params: ['p_account_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'],
  kind: 'rpc',
  shape: 'transition',
  migration: MIGRATION,
  alsoWrites: [],
};

const DOMAIN = specModel([
  aggregate('account', {
    entity: entitySpec('account', {
      label: 'アカウント',
      context: { account: 'account.id' },
      fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'account' })],
    }),
    stateMachines: [
      machine('account', {
        states: ['open', 'closed'],
        initial: 'open',
        events: [event('close', { from: ['open'], to: 'closed', by: ['member'] })],
        effects: [effect('close', ['end_account_sessions'])],
      }),
    ],
  }),
]);

const END = outboxJob('end_account_sessions', { kind: 'end', endsSessions: 'account', platformCall: 'revoke_auth_sessions', inTransaction: true });

/** 生成器に渡す文脈。 */
function context(jobs: ReturnType<typeof jobModel> | undefined): GenerateContext {
  return {
    ...GEN_CTX,
    dataTables: dataTableModel([dataTable('accounts', { entity: 'account', functions: [FN] })]),
    ...(jobs === undefined ? {} : { jobs }),
  };
}

/** 生成した migration の本文(1 本)。 */
function render(ctx: GenerateContext): string {
  const sections = rpcBodiesGenerator.generate(DOMAIN, ctx);
  expect(sections).toHaveLength(1);
  expect(sections[0]?.file.endsWith(MIGRATION)).toBe(true);
  return sections[0]?.content ?? '';
}

describe('code-rpc-bodies: セッションを終える効果の配線', () => {
  it('文脈のジョブカタログに ends_sessions の効果があれば、効果を載せたイベントの遷移 RPC に呼び先の呼び出しが入る', () => {
    const sql = render(context(jobModel([END])));

    expect(sql).toContain("if p_event_id in ('account.close') then");
    expect(sql).toContain(`perform ${GEN_CTX.platform.exposedSchema}.revoke_auth_sessions(p_account_id);`);
  });

  it('ジョブカタログが無い・終える効果が無い製品の遷移 RPC には何も足さない(字面が変わらない)', () => {
    const without = render(context(undefined));

    expect(without).not.toContain('revoke_auth_sessions');
    expect(render(context(jobModel([outboxJob('notify_x', { kind: 'plain' })])))).toBe(without);
  });

  it('効果が宣言されていても、遷移の RPC でない形(編集)には足さない', () => {
    const update: DataFunctionDecl = {
      name: 'update_account',
      args: ['uuid', 'text', 'jsonb', 'uuid', 'text[]', 'text[]'],
      params: ['p_account_id', 'p_expected_state', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'],
      kind: 'rpc',
      shape: 'update',
      migration: '20261023000701_update_account.sql',
      alsoWrites: [],
    };
    const ctx: GenerateContext = {
      ...GEN_CTX,
      dataTables: dataTableModel([dataTable('accounts', { entity: 'account', functions: [update] })]),
      jobs: jobModel([END]),
    };
    const sections = rpcBodiesGenerator.generate(DOMAIN, ctx);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.content).not.toContain('revoke_auth_sessions');
  });
});
