/**
 * 保証 fw_bearer_value の見張り: 生成する作成の RPC は `bearer` の欄の値を監査ログ(`domain_events.payload`)に載せない。
 * 本文の組み立ての表は `unit/sql/rpc-body-bearer.test.ts` が持ち、ここは台帳の見張りとして最小の一対を固定する。
 */

import { describe, expect, it } from 'vitest';
import { BEARER_DEFAULT_SQL } from '../../lib/kernel/bearer.js';
import { buildRpcBody } from '../../lib/sql/rpc-body.js';
import type { FieldDef } from '../../lib/model/types.js';
import { dataTable } from '../helpers/data-builder.js';
import { accessSpec, aggregate, create, entitySpec, field, loc, specModel } from '../helpers/model-builder.js';
import { TEST_PLATFORM } from '../helpers/platform.js';

const withBearer = (bearer: boolean): string => {
  const token: FieldDef = {
    ...field('token', { kind: 'string' }),
    maxLength: 43,
    suppliedBy: 'db',
    ...(bearer ? { bearer: { kind: 'reusable' as const, reason: '何人でも使える窓口', location: loc('pass/entity.md', 'fields[1].bearer') } } : {}),
  };
  const result = buildRpcBody({
    name: 'insert_pass',
    params: ['p_id', 'p_actor_id', 'p_actor_roles'],
    args: ['uuid', 'uuid', 'text[]'],
    shape: 'create',
    table: dataTable('passes', {
      entity: 'pass',
      defaults: { token: BEARER_DEFAULT_SQL },
      resend: { returnsExisting: false, location: loc('tables/passes.md', 'resend') },
    }),
    domain: specModel([
      aggregate('pass', {
        entity: entitySpec('pass', { context: { pass: 'pass.id' }, fields: [field('id', { kind: 'uuid' }, { auto: true }), token] }),
        access: accessSpec('pass', { creates: [create('member')] }),
      }),
    ]),
    tableOf: (entity) => (entity === 'pass' ? 'passes' : null),
    actions: { unhandled: [], scans: [], unscanned: [], testTagBaseline: [], actions: [] },
    specFiles: ['tables/passes.md'],
    entityLabel: '通行証',
    platform: TEST_PLATFORM,
  });
  return result.ok ? result.sql : result.problems.map((problem) => problem.message).join('\n');
};

describe('作成の監査ログと bearer の欄', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BEARER-003
  it('作成の監査ログに bearer の欄の値は載らない', () => {
    // 対照: bearer の宣言が無ければ、DB が決めた列は従来どおり payload に載る。
    expect(withBearer(false)).toContain('v_row.token');
    expect(withBearer(true)).not.toContain('v_row.token');
    expect(withBearer(true)).not.toContain('redacted');
  });
});
