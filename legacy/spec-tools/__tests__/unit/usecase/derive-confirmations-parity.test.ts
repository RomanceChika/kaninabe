/**
 * 確認要否が、画面の生成(`deriveActionAttributes`)と Y5 の数え方(`deriveConfirmations`)で
 * 食い違わないことの再現テスト(外部レビュー C-④)。
 *
 * かつて Y5 は通知・ジョブ・テーブル仕様のカタログを持たない「軽量版」で確認要否を近似していたので、
 * **連鎖(複合 RPC の also_writes)だけが確認を要求する操作**を数え落とした。ここの 2 操作は
 * どちらも、軽量版が false・正式な導出が true になる形である:
 *
 * - `account.close` … 戻せない遷移だが実行者は所有者だけ(affectsOthers は遷移だけなら false)。
 *   遷移に伴う複合 RPC が personal 列を持つ表へ書く(destructive)。
 * - `ledger.freeze` … 戻せない遷移で実行者は所有者だけ。複合 RPC が別集約の表へ書く(affectsOthers)。
 */

import { describe, expect, it } from 'vitest';
import { deriveConfirmations } from '../../../lib/usecase/derive-effort.js';
import { deriveActionAttributes } from '../../../lib/generate/render/action-attributes-derive.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { JobCatalogSpec } from '../../../lib/model/job/types.js';
import type { GenerateContext } from '../../../lib/gen-kit/generator.js';
import { aggregate, entitySpec, event, field, loc, machine, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { GEN_CTX } from '../../helpers/generate-context.js';
import { testAuth, testScreens, usecaseInput } from './_fixtures.js';

const ROLES = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('member', undefined, undefined, 'authenticated_default'),
  role('account_owner', 'account.owner_id == actor.id', ['member']),
  role('ledger_owner', 'ledger.owner_id == actor.id', ['member']),
]);

/** 連鎖を起こす複合 RPC を持つ表(`entity` の集約が `alsoWrites` の表へ同じトランザクションで書く)。 */
function compositeTable(entity: string, table: string, alsoWrites: readonly string[]): DataTableSpec {
  return {
    id: `table-${table}`,
    table,
    entity,
    internal: false,
    indexes: [],
    sequences: [],
    exclusions: [],
    foreignKeys: [],
    triggers: [],
    defaults: {},
    functions: [
      { name: `${entity}_cascade`, args: ['uuid'], params: ['p_a'], kind: 'rpc', shape: 'composite', alsoWrites },
    ],
    checks: [],
    testCases: [],
    location: loc(),
    relPath: `${table}.md`,
  };
}

/** 書き込みと同じトランザクションで実行されるジョブだけを持つカタログ。 */
const JOBS: JobCatalogSpec = {
  id: 'job-catalog',
  vocabulary: { kind: [], on_failure: [] },
  jobs: [
    { id: 'cascade_account', event: 'account.close', rpc: 'account_cascade' },
    { id: 'cascade_ledger', event: 'ledger.freeze', rpc: 'ledger_cascade' },
  ].map(({ id, event, rpc }) => ({
    id,
    source: 'outbox' as const,
    kind: 'transaction_effect',
    inTransaction: true,
    realizedBy: { [event]: rpc },
    onFailure: 'wiring_error',
    summary: 'x',
    location: loc(),
  })),
  testCases: [],
  location: loc(),
};

const DOMAIN = specModel(
  [
    aggregate('account', {
      entity: entitySpec('account', { fields: [] }),
      stateMachines: [
        machine('account', {
          states: ['active', 'closed'],
          initial: 'active',
          final: ['closed'],
          events: [event('close', { from: ['active'], to: 'closed', by: ['account_owner'] })],
          effects: [{ on: 'close', do: ['cascade_account'], location: loc() }],
        }),
      ],
    }),
    aggregate('note', { entity: entitySpec('note', { fields: [field('body', { kind: 'text' }, { personal: true })] }) }),
    aggregate('ledger', {
      entity: entitySpec('ledger', { fields: [] }),
      stateMachines: [
        machine('ledger', {
          states: ['open', 'frozen'],
          initial: 'open',
          final: ['frozen'],
          events: [event('freeze', { from: ['open'], to: 'frozen', by: ['ledger_owner'] })],
          effects: [{ on: 'freeze', do: ['cascade_ledger'], location: loc() }],
        }),
      ],
    }),
    aggregate('room', { entity: entitySpec('room', { fields: [] }) }),
  ],
  ROLES,
);

const CATALOGS = {
  dataTables: {
    available: true as const,
    tables: [compositeTable('account', 'accounts', ['notes']), compositeTable('ledger', 'ledgers', ['rooms'])],
  },
  jobs: { available: true as const, catalog: JOBS },
};

describe('確認要否は画面の生成と Y5 で食い違わない', () => {
  it.each([
    ['account.close', 'destructive'],
    ['ledger.freeze', 'affectsOthers'],
  ] as const)('%s: 連鎖(%s)だけが確認を要求する操作を Y5 も数える', (op, cause) => {
    const action = actionSpec({ handles: op });
    const ctx: GenerateContext = { ...GEN_CTX, ...CATALOGS };
    const attrs = deriveActionAttributes(DOMAIN, ctx, action);
    const usecase = usecaseSpec({ saves: [usecaseSave('only', [usecaseStep(op)])] });
    const input = usecaseInput({
      usecases: { available: true, usecases: [usecase] },
      domain: DOMAIN,
      actions: { actions: [action], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      screens: testScreens(),
      auth: testAuth(),
      catalogs: CATALOGS,
    });

    // 前提: 画面の側は確認が要る(連鎖の事実だけが理由。遷移そのものは tone も settles も持たない)。
    expect(attrs[cause]).toBe(true);
    expect(attrs.negativeTone || attrs.settles).toBe(false);
    expect(attrs.confirmRequired).toBe(true);

    const result = deriveConfirmations(usecase, input);

    expect(result.flaggedOps).toEqual([op]);
    expect(result.total).toBe(1);
  });

  it.each([
    ['採っていない(置き場が無い)カタログは事実として連鎖なし → 確認は要らない', { dataTables: { available: false as const, tables: [] }, jobs: { available: false as const, catalog: null } }, false, 0],
    ['渡されないカタログは「分からない」→ 未検査として確認が要る', {}, true, 1],
  ] as const)('%s(入力が同じなら画面と Y5 の結果も同じ)', (_title, catalogs, confirm, total) => {
    const action = actionSpec({ handles: 'account.close' });
    const attrs = deriveActionAttributes(DOMAIN, { ...GEN_CTX, ...catalogs }, action);
    const usecase = usecaseSpec({ saves: [usecaseSave('only', [usecaseStep('account.close')])] });
    const input = usecaseInput({
      usecases: { available: true, usecases: [usecase] },
      domain: DOMAIN,
      actions: { actions: [action], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      catalogs,
    });

    expect(attrs.confirmRequired).toBe(confirm);
    expect(deriveConfirmations(usecase, input).total).toBe(total);
  });
});
