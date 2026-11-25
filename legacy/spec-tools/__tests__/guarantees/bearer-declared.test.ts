/**
 * 保証 fw_bearer_value の見張り: 持っていれば効く値(`bearer`)は、UUID の式・値を渡す口・URL のパスに載る route・欠けた寿命の宣言が R16 に止められる。
 * 検査の表(止める形・受け入れる形の全部)は `unit/risk/r16-bearer.test.ts` が持ち、ここは台帳の見張りとして最小の一対を固定する。
 */

import { describe, expect, it } from 'vitest';
import { BEARER_DEFAULT_SQL } from '../../lib/kernel/bearer.js';
import { verifyBearer } from '../../lib/risk/verifiers/r16-bearer.js';
import type { FieldDef } from '../../lib/model/types.js';
import { dataTable } from '../helpers/data-builder.js';
import { aggregate, entitySpec, field, loc, specModel } from '../helpers/model-builder.js';

const code: FieldDef = {
  ...field('code', { kind: 'string' }),
  maxLength: 43,
  suppliedBy: 'db',
  bearer: { kind: 'reusable', reason: '何人でも入れる窓口', location: loc('invite/entity.md', 'fields[0].bearer') },
};
const model = specModel([aggregate('invite', { entity: entitySpec('invite', { fields: [code] }) })]);
const table = (expression: string) => dataTable('invites', { entity: 'invite', defaults: { code: expression } });
const route = (path: string) => ({ id: 'screen-invite', route: path, location: loc('screens/invite.md') });
const errors = (tables: ReturnType<typeof table>[], screens: ReturnType<typeof route>[]) =>
  verifyBearer({ model, tables, screens }).filter((finding) => finding.severity === 'error');

describe('持っていれば効く値の取り扱い(R16)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BEARER-001
  it('UUID の式・値を渡す口・URL のパスに載る route・欠けた寿命の宣言は R16 が止める', () => {
    // 正しい形は通る(受け入れた危険の warning は error ではない)。
    expect(errors([table(BEARER_DEFAULT_SQL)], [route('/invite')])).toEqual([]);
    // UUID の式。
    expect(errors([table("replace((gen_random_uuid())::text, '-'::text, ''::text)")], [])).toHaveLength(1);
    // URL のパス。
    expect(errors([table(BEARER_DEFAULT_SQL)], [route('/invite/:code')])).toHaveLength(1);
    // 寿命の宣言が名指す欄が実在しない。
    const expiring: FieldDef = { ...code, bearer: { kind: 'expiring', expiresAt: 'gone_at', usedAt: 'gone_too', location: loc('invite/entity.md', 'fields[0].bearer') } };
    const broken = specModel([aggregate('invite', { entity: entitySpec('invite', { fields: [expiring] }) })]);
    expect(verifyBearer({ model: broken, tables: null, screens: null }).filter((finding) => finding.severity === 'error')).toHaveLength(2);
  });
});
