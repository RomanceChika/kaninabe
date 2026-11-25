/**
 * 持っていれば効く値(`bearer`)の欄は、作成の監査ログ(`domain_events.payload`)に値を載せない。
 *
 * 値を載せると、監査ログを読めた人がその値の権能を持つ。個人の欄と違って呼び手が送ってきた値ではなく(DB が決める)、
 * `redacted` にも載せない(送られていない値を「伏せた」と嘘をつかない)。ほかの欄は従来どおり載る。
 */

import { describe, expect, it } from 'vitest';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, create, entitySpec, field, loc, specModel } from '../../helpers/model-builder.js';
import type { FieldDef } from '../../../lib/model/types.js';
import { BEARER_DEFAULT_SQL } from '../../../lib/kernel/bearer.js';

const token: FieldDef = {
  ...field('token', { kind: 'string' }),
  maxLength: 43,
  suppliedBy: 'db',
  bearer: { kind: 'reusable', reason: '何人でも使える窓口', location: loc('pass/entity.md', 'fields[1].bearer') },
};
const label: FieldDef = { ...field('label', { kind: 'string' }), maxLength: 50, suppliedBy: 'db' };

function sqlFor(dbFields: readonly FieldDef[]): string {
  const model = specModel([
    aggregate('pass', {
      entity: entitySpec('pass', { context: { pass: 'pass.id' }, fields: [field('id', { kind: 'uuid' }, { auto: true }), ...dbFields] }),
      access: accessSpec('pass', { creates: [create('member')] }),
    }),
  ]);
  const result = buildRpcBody({
    name: 'insert_pass',
    params: ['p_id', 'p_actor_id', 'p_actor_roles'],
    args: ['uuid', 'uuid', 'text[]'],
    shape: 'create',
    table: dataTable('passes', {
      entity: 'pass',
      defaults: { token: BEARER_DEFAULT_SQL, label: "'x'::text" },
      resend: { returnsExisting: false, location: loc('tables/passes.md', 'resend') },
    }),
    domain: model,
    tableOf: (entity) => (entity === 'pass' ? 'passes' : null),
    actions: { unhandled: [], scans: [], unscanned: [], testTagBaseline: [], actions: [] },
    specFiles: ['tables/passes.md'],
    entityLabel: '通行証',
    platform: TEST_PLATFORM,
  });
  return result.ok ? result.sql : result.problems.map((problem) => problem.message).join('\n');
}

describe('作成の監査ログと bearer の欄', () => {
  it('bearer の欄の値は payload に載らず、redacted にも載らない', () => {
    const sql = sqlFor([token]);
    expect(sql).toContain('insert into public.domain_events');
    expect(sql).not.toContain('v_row.token');
    expect(sql).not.toContain("'token'");
    expect(sql).not.toContain('redacted');
  });

  it('対照: bearer でない DB 供給の欄は従来どおり payload に載る', () => {
    const sql = sqlFor([token, label]);
    expect(sql).toContain("'label', v_row.label");
    expect(sql).not.toContain('v_row.token');
  });
});
